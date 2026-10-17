import { SELF } from "cloudflare:test";
import { expect } from "vitest";
import type { ServerMessage } from "../../site/assets/live/messages";

export async function registerIdentity(id: string, name: string): Promise<void> {
  const res = await SELF.fetch("https://example.com/api/live/identity/register", {
    method: "POST",
    headers: { Authorization: `Bearer ${id}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(200);
}

// Room creation requires a registered identity (the worker 403s otherwise).
export async function createRoom(id: string, name: string, roomName?: unknown): Promise<string> {
  await registerIdentity(id, name);
  const res = await SELF.fetch("https://example.com/api/live/room", {
    method: "POST",
    headers: { Authorization: `Bearer ${id}`, "Content-Type": "application/json" },
    body: JSON.stringify(roomName === undefined ? { name } : { name, roomName }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { room: string };
  return body.room;
}

interface Queue {
  buffer: ServerMessage[];
  waiters: ((m: ServerMessage) => void)[];
}

const queues = new WeakMap<WebSocket, Queue>();

export async function connect(room: string): Promise<WebSocket> {
  const res = await SELF.fetch(`https://example.com/api/live/room/${room}/ws`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const q: Queue = { buffer: [], waiters: [] };
  queues.set(ws, q);
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data as string) as ServerMessage;
    const waiter = q.waiters.shift();
    if (waiter) waiter(msg);
    else q.buffer.push(msg);
  });
  return ws;
}

export function nextMessage(ws: WebSocket): Promise<ServerMessage> {
  const q = queues.get(ws)!;
  const buffered = q.buffer.shift();
  if (buffered) return Promise.resolve(buffered);
  return new Promise((resolve) => q.waiters.push(resolve));
}

export async function join(room: string, id: string, name: string) {
  const ws = await connect(room);
  const snapshotPromise = nextMessage(ws);
  ws.send(JSON.stringify({ type: "hello", id, name }));
  const snapshot = await snapshotPromise;
  expect(snapshot.type).toBe("snapshot");
  return { ws, snapshot: snapshot as Extract<ServerMessage, { type: "snapshot" }> };
}
