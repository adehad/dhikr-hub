import { describe, expect, it } from "vitest";
import { LiveStore } from "../storage";
import type { Setlist } from "../messages";

function fakeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("LiveStore", () => {
  it("generates identity once and persists it", () => {
    const ls = fakeLocalStorage();
    const a = new LiveStore(ls).ensureIdentity();
    const b = new LiveStore(ls).ensureIdentity();
    expect(a.id).toBe(b.id);
    expect(a.name).toBe("Listener");
  });

  it("adoptIdentity replaces the local identity", () => {
    const ls = fakeLocalStorage();
    const store = new LiveStore(ls);
    store.ensureIdentity();
    store.adoptIdentity("pasted-full-id", "Ahmad", "pubid123");
    expect(store.ensureIdentity()).toMatchObject({ id: "pasted-full-id", name: "Ahmad" });
  });

  it("saveSetlist upserts by id and lists newest first", () => {
    const ls = fakeLocalStorage();
    const store = new LiveStore(ls);
    const s1: Setlist = { id: "1", name: "A", items: ["x"], updatedAt: "2026-01-01T00:00:00Z" };
    store.saveSetlist(s1);
    store.saveSetlist({ ...s1, name: "A2", updatedAt: "2026-02-01T00:00:00Z" });
    store.saveSetlist({ id: "2", name: "B", items: [], updatedAt: "2026-03-01T00:00:00Z" });
    const lists = store.setlists();
    expect(lists).toHaveLength(2);
    expect(lists[0]!.id).toBe("2");
    expect(lists[1]!.name).toBe("A2");
  });

  it("trust toggles and survives reload", () => {
    const ls = fakeLocalStorage();
    const store = new LiveStore(ls);
    store.setTrusted("pub1", true);
    expect(new LiveStore(ls).isTrusted("pub1")).toBe(true);
    store.setTrusted("pub1", false);
    expect(store.isTrusted("pub1")).toBe(false);
  });

  it("corrupt blob resets instead of throwing", () => {
    const ls = fakeLocalStorage();
    ls.setItem("dhikr-hub-live", "{not json");
    const store = new LiveStore(ls);
    expect(store.setlists()).toEqual([]);
    expect(store.ensureIdentity().id).toBeTruthy();
  });

  it("deleteSetlist removes only the matching id", () => {
    const ls = fakeLocalStorage();
    const store = new LiveStore(ls);
    store.saveSetlist({ id: "1", name: "A", items: ["x"], updatedAt: "2026-01-01T00:00:00Z" });
    store.saveSetlist({ id: "2", name: "B", items: ["y"], updatedAt: "2026-02-01T00:00:00Z" });
    store.deleteSetlist("1");
    expect(store.setlists().map((s) => s.id)).toEqual(["2"]);
  });

  it("updateIdentity merges a patch and creates the identity when missing", () => {
    const ls = fakeLocalStorage();
    const store = new LiveStore(ls);
    const created = store.updateIdentity({ publicId: "pub" });
    expect(created.publicId).toBe("pub");
    expect(created.id).toBeTruthy();
    const renamed = store.updateIdentity({ name: "Ahmad" });
    expect(renamed).toMatchObject({ id: created.id, publicId: "pub", name: "Ahmad" });
  });

  it("drops malformed setlist entries instead of crashing", () => {
    const ls = fakeLocalStorage();
    ls.setItem(
      "dhikr-hub-live",
      JSON.stringify({ setlists: [{ id: "1" }, { id: "2", name: "B", items: ["y"], updatedAt: "2026-01-01T00:00:00Z" }] }),
    );
    expect(new LiveStore(ls).setlists().map((s) => s.id)).toEqual(["2"]);
  });

  it("regenerates a tampered identity", () => {
    const ls = fakeLocalStorage();
    ls.setItem("dhikr-hub-live", JSON.stringify({ identity: 42 }));
    const identity = new LiveStore(ls).ensureIdentity();
    expect(typeof identity.id).toBe("string");
    expect(identity.name).toBe("Listener");
  });

  it("keeps one identity for the page's life when localStorage refuses writes", () => {
    const ls = fakeLocalStorage();
    ls.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const store = new LiveStore(ls);
    const first = store.ensureIdentity();
    expect(store.ensureIdentity().id).toBe(first.id);
    const renamed = store.updateIdentity({ name: "Ahmad" });
    expect(renamed.id).toBe(first.id);
    expect(store.ensureIdentity()).toMatchObject({ id: first.id, name: "Ahmad" });
  });

  it("remembers and forgets recent rooms across reloads, dropping bad entries", () => {
    const ls = fakeLocalStorage();
    const store = new LiveStore(ls);
    store.rememberRoom({ code: "abcdefgh", name: "Majlis", lastSeen: "2026-01-01T00:00:00Z" });
    store.rememberRoom({ code: "hgfedcba", name: "", lastSeen: "2026-01-02T00:00:00Z" });
    expect(new LiveStore(ls).recentRooms().map((r) => r.code)).toEqual(["hgfedcba", "abcdefgh"]);
    store.forgetRoom("hgfedcba");
    expect(store.recentRooms().map((r) => r.code)).toEqual(["abcdefgh"]);

    const blob = JSON.parse(ls.getItem("dhikr-hub-live")!) as { recentRooms: unknown[] };
    blob.recentRooms.push({ code: 5 }, "junk");
    ls.setItem("dhikr-hub-live", JSON.stringify(blob));
    expect(new LiveStore(ls).recentRooms()).toHaveLength(1);
  });
});
