import { runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../identity";
import { connect, createRoom, join, nextMessage, registerIdentity } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

function roomStub(room: string) {
  const { LIVE_ROOM } = env as unknown as Env;
  return LIVE_ROOM.get(LIVE_ROOM.idFromName(room));
}

async function backdateActivity(room: string, byMs: number): Promise<void> {
  await runInDurableObject(roomStub(room), async (_instance, state) => {
    const s = await state.storage.get<{ lastActivity: number }>("room");
    await state.storage.put("room", { ...s, lastActivity: Date.now() - byMs });
  });
}

const HOST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PEER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("room join", () => {
  it("unknown room closes the websocket with 4004 so the client stops retrying", async () => {
    const res = await SELF.fetch("https://example.com/api/live/room/zzzzzzzz/ws", {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const closed = new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve));
    ws.accept();
    expect((await closed).code).toBe(4004);
  });

  it("idle alarm with a follower still connected reschedules a day out instead of refiring", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    await join(room, PEER_ID, "Listener");
    await backdateActivity(room, 2 * DAY_MS);
    expect(await runDurableObjectAlarm(roomStub(room))).toBe(true);
    const next = await runInDurableObject(roomStub(room), (_instance, state) => state.storage.getAlarm());
    expect(next).toBeGreaterThan(Date.now() + DAY_MS - 60_000);
    const late = await join(room, HOST_ID, "Ahmad");
    expect(late.snapshot.type).toBe("snapshot");
  });

  it("a socket that never said hello does not keep an idle room alive", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    await connect(room);
    await backdateActivity(room, 2 * DAY_MS);
    expect(await runDurableObjectAlarm(roomStub(room))).toBe(true);
    const stored = await runInDurableObject(roomStub(room), (_instance, state) => state.storage.get("room"));
    expect(stored).toBeUndefined();
  });

  it("POST /room with an oversized body is rejected with 413", async () => {
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await registerIdentity(id, "Ahmad");
    const res = await SELF.fetch("https://example.com/api/live/room", {
      method: "POST",
      headers: { Authorization: `Bearer ${id}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(5000) }),
    });
    expect(res.status).toBe(413);
  });

  it("creator joins own room and is leader in snapshot", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const { snapshot } = await join(room, HOST_ID, "Ahmad");
    expect(snapshot.leader).toBe(snapshot.you);
    expect(snapshot.hosts).toEqual([snapshot.you]);
    expect(snapshot.roster.map((p) => p.publicId)).toContain(snapshot.you);
  });

  it("second peer gets roster containing both, first peer gets peer-joined", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    const joinedPromise = nextMessage(host.ws);
    const peer = await join(room, PEER_ID, "Listener");
    expect(peer.snapshot.roster).toHaveLength(2);
    expect(peer.snapshot.hosts).toEqual([host.snapshot.you]);
    const joined = await joinedPromise;
    expect(joined.type).toBe("peer-joined");
  });

  it("non-hello first message closes the socket", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const ws = await connect(room);
    const closed = new Promise<void>((resolve) =>
      ws.addEventListener("close", () => resolve()),
    );
    ws.send(JSON.stringify({ type: "position", position: { section: "verses", group: 0 } }));
    await closed;
  });

  it("hello without an id closes the socket instead of minting an identity", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const ws = await connect(room);
    const closed = new Promise<void>((resolve) =>
      ws.addEventListener("close", () => resolve()),
    );
    ws.send(JSON.stringify({ type: "hello", name: "NoId" }));
    await closed;
  });

  it("hello with an oversized id closes the socket", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const ws = await connect(room);
    const closed = new Promise<void>((resolve) =>
      ws.addEventListener("close", () => resolve()),
    );
    ws.send(JSON.stringify({ type: "hello", id: "a".repeat(300), name: "TooLong" }));
    await closed;
  });

  it("same identity on two sockets dedupes roster and defers peer-left to the last close", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    const first = await join(room, PEER_ID, "Phone");
    const second = await join(room, PEER_ID, "Phone");
    expect(second.snapshot.roster).toHaveLength(2);
    expect((await nextMessage(host.ws)).type).toBe("peer-joined");
    expect((await nextMessage(host.ws)).type).toBe("peer-joined");

    // workerd fires no local close event for a client-initiated close, so the
    // close/chorus order is unenforced: this pins "no peer-left" only in the
    // interleaving where the close is processed first.
    const atSecond = nextMessage(second.ws);
    first.ws.close();
    host.ws.send(JSON.stringify({ type: "chorus" }));
    expect((await atSecond).type).toBe("chorus");

    const leftAtHost = nextMessage(host.ws);
    second.ws.close();
    expect(await leftAtHost).toMatchObject({ type: "peer-left" });
  });

  it("malformed input from an authenticated socket is ignored, not closed", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    host.ws.send("not json");
    const reply = nextMessage(host.ws);
    host.ws.send(JSON.stringify({ type: "follow-me" }));
    expect(await reply).toMatchObject({ type: "hosts" });
  });
});

describe("room name and metadata", () => {
  it("a room created with a name carries it in the snapshot", async () => {
    const room = await createRoom(HOST_ID, "Ahmad", "Thursday mawlid");
    const { snapshot } = await join(room, PEER_ID, "Listener");
    expect(snapshot.roomName).toBe("Thursday mawlid");
  });

  it("a room created without a name defaults to the host's room", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const { snapshot } = await join(room, PEER_ID, "Listener");
    expect(snapshot.roomName).toBe("Ahmad's room");
  });

  it("an oversized room name is clamped to 64 code points", async () => {
    const room = await createRoom(HOST_ID, "Ahmad", "\u{1F319}".repeat(100));
    const { snapshot } = await join(room, PEER_ID, "Listener");
    expect(snapshot.roomName).toBe("\u{1F319}".repeat(64));
  });

  it("a non-string room name falls back to the default", async () => {
    const room = await createRoom(HOST_ID, "Ahmad", 42);
    const { snapshot } = await join(room, PEER_ID, "Listener");
    expect(snapshot.roomName).toBe("Ahmad's room");
  });

  it("a stored room without a name snapshots an empty name", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    await runInDurableObject(roomStub(room), async (_instance, state) => {
      const s = await state.storage.get<Record<string, unknown>>("room");
      delete s!.roomName;
      delete s!.hostName;
      await state.storage.put("room", s);
    });
    const { snapshot } = await join(room, PEER_ID, "Listener");
    expect(snapshot.roomName).toBe("");
  });

  it("the host's display name is stored with the room", async () => {
    const room = await createRoom(HOST_ID, "Ahmad", "Thursday mawlid");
    const stored = await runInDurableObject(roomStub(room), (_instance, state) =>
      state.storage.get<{ hostName: string }>("room"),
    );
    expect(stored!.hostName).toBe("Ahmad");
  });

  it("/meta returns the name and setlist summary and no identity data", async () => {
    const room = await createRoom(HOST_ID, "Ahmad", "Thursday mawlid");
    const host = await join(room, HOST_ID, "Ahmad");
    await join(room, PEER_ID, "Listener");
    host.ws.send(
      JSON.stringify({
        type: "setlist",
        setlist: { id: "s1", name: "Mawlid set", items: ["a", "b"], updatedAt: "2026-10-16T00:00:00Z" },
      }),
    );
    host.ws.send(JSON.stringify({ type: "follow-me" }));
    while ((await nextMessage(host.ws)).type !== "hosts");

    const res = await roomStub(room).fetch("https://do/meta");
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(JSON.parse(raw)).toStrictEqual({ name: "Thursday mawlid", setlistName: "Mawlid set", trackCount: 2 });
    expect(raw).not.toContain(host.snapshot.you);
    expect(raw).not.toContain("Ahmad");
    expect(raw).not.toContain("Listener");
  });

  it("/meta without a setlist reports none", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const res = await roomStub(room).fetch("https://do/meta");
    expect(await res.json()).toStrictEqual({ name: "Ahmad's room", setlistName: null, trackCount: 0 });
  });

  it("/meta on an unknown room is 404", async () => {
    const res = await roomStub("zzzzzzzz").fetch("https://do/meta");
    expect(res.status).toBe(404);
    expect(await res.json()).toStrictEqual({ error: "not found" });
  });

  it("/meta is not exposed on the public API", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const res = await SELF.fetch(`https://example.com/api/live/room/${room}/meta`);
    expect(res.status).toBe(404);
  });
});
