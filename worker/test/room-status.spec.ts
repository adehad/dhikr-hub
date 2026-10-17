import { runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../identity";
import { createRoom, join, nextMessage } from "./helpers";

const HOST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PEER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface Status {
  exists: boolean;
  name?: string;
  people?: number;
  live?: boolean;
  lastActive?: string;
}

async function status(room: string): Promise<{ res: Response; body: Status }> {
  const res = await SELF.fetch(`https://example.com/api/live/room/${room}/status`);
  return { res, body: (await res.json()) as Status };
}

// The server sees a client-initiated close asynchronously.
async function statusUntil(room: string, done: (s: Status) => boolean): Promise<Status> {
  for (let i = 0; i < 50; i++) {
    const { body } = await status(room);
    if (done(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return (await status(room)).body;
}

function roomStub(room: string) {
  const { LIVE_ROOM } = env as unknown as Env;
  return LIVE_ROOM.get(LIVE_ROOM.idFromName(room));
}

async function storageOf(room: string): Promise<{ entries: Map<string, unknown>; alarm: number | null }> {
  return runInDurableObject(roomStub(room), async (_instance, state) => ({
    entries: await state.storage.list(),
    alarm: await state.storage.getAlarm(),
  }));
}

async function expectStatusLeavesStorage(room: string): Promise<void> {
  const before = await storageOf(room);
  await status(room);
  expect(await storageOf(room)).toStrictEqual(before);
}

describe("room status", () => {
  it("an unknown room does not exist", async () => {
    const { res, body } = await status("zzzzzzzz");
    expect(res.status).toBe(200);
    expect(body).toStrictEqual({ exists: false });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("a malformed code does not exist", async () => {
    const { res, body } = await status("zz");
    expect(res.status).toBe(200);
    expect(body).toStrictEqual({ exists: false });
  });

  it("a fresh room with nobody connected is not live", async () => {
    const room = await createRoom(HOST_ID, "Ahmad", "Thursday mawlid");
    const { res, body } = await status(room);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({ exists: true, name: "Thursday mawlid", people: 0, live: false });
    expect(Number.isNaN(Date.parse(body.lastActive!))).toBe(false);
  });

  it("the host joining makes the room live", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    await join(room, HOST_ID, "Ahmad");
    expect((await status(room)).body).toMatchObject({ people: 1, live: true });
  });

  it("people dedupes one identity across sockets", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    await join(room, HOST_ID, "Ahmad");
    await join(room, PEER_ID, "Listener");
    expect((await status(room)).body).toMatchObject({ people: 2, live: true });
    await join(room, PEER_ID, "Listener");
    expect((await status(room)).body).toMatchObject({ people: 2, live: true });
  });

  it("the leader leaving takes the room off live while the follower stays counted", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    await join(room, PEER_ID, "Listener");
    host.ws.close();
    expect(await statusUntil(room, (b) => b.live === false)).toMatchObject({ exists: true, people: 1, live: false });
  });

  it("an ended room does not exist", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    const ended = nextMessage(host.ws);
    host.ws.send(JSON.stringify({ type: "end-event" }));
    expect((await ended).type).toBe("ended");
    expect((await status(room)).body).toStrictEqual({ exists: false });
  });

  it("never writes to room storage", async () => {
    const live = await createRoom(HOST_ID, "Ahmad", "Thursday mawlid");
    await join(live, HOST_ID, "Ahmad");
    await expectStatusLeavesStorage(live);

    await expectStatusLeavesStorage("zzzzzzzz");
    await expectStatusLeavesStorage("zz");

    const ended = await createRoom(HOST_ID, "Ahmad");
    const host = await join(ended, HOST_ID, "Ahmad");
    const endedMsg = nextMessage(host.ws);
    host.ws.send(JSON.stringify({ type: "end-event" }));
    expect((await endedMsg).type).toBe("ended");
    for (let i = 0; i < 50; i++) {
      const s = await storageOf(ended);
      if (s.entries.size === 0 && s.alarm === null) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await expectStatusLeavesStorage(ended);
  });

  it("carries no identity data", async () => {
    const room = await createRoom(HOST_ID, "Ahmad", "Thursday mawlid");
    const host = await join(room, HOST_ID, "Ahmad");
    await join(room, PEER_ID, "Listener");
    const { body } = await status(room);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(host.snapshot.you);
    expect(raw).not.toContain("Ahmad");
    expect(raw).not.toContain("Listener");
    expect(Object.keys(body).sort()).toStrictEqual(["exists", "lastActive", "live", "name", "people"]);
  });
});
