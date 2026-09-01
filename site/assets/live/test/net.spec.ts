import { describe, expect, it, vi } from "vitest";
import { backoffMs, LiveSocket, type LiveStatus } from "../net";
import type { ServerMessage } from "../messages";

describe("backoffMs", () => {
  it("grows exponentially from 1s and caps at 15s", () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(4)).toBe(15000);
    expect(backoffMs(10)).toBe(15000);
  });
});

class FakeWS {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  private listeners = new Map<string, ((event: never) => void)[]>();
  addEventListener(type: string, fn: (event: never) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(): void {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(code = 1000): void {
    this.readyState = 3;
    this.fire("close", { code });
  }
  fire(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event as never);
  }
}

describe("LiveSocket", () => {
  function setup() {
    const sockets: FakeWS[] = [];
    const statuses: LiveStatus[] = [];
    const messages: ServerMessage[] = [];
    const socket = new LiveSocket(
      "wss://example/ws",
      { id: "secret", name: "Ahmad" },
      { onMessage: (m) => messages.push(m), onStatus: (s) => statuses.push(s) },
      () => {
        const ws = new FakeWS();
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
    );
    return { socket, sockets, statuses, messages };
  }

  it("sends hello on open and reports status", () => {
    const { socket, sockets, statuses } = setup();
    socket.connect();
    const ws = sockets[0]!;
    ws.readyState = FakeWS.OPEN;
    ws.fire("open", {});
    expect(JSON.parse(ws.sent[0]!)).toMatchObject({ type: "hello", id: "secret" });
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("reconnects with backoff after an abnormal close and re-sends hello", () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { socket, sockets, statuses } = setup();
    socket.connect();
    sockets[0]!.fire("close", { code: 1006 });
    expect(statuses).toContain("closed");
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    const ws2 = sockets[1]!;
    ws2.readyState = FakeWS.OPEN;
    ws2.fire("open", {});
    expect(JSON.parse(ws2.sent[0]!)).toMatchObject({ type: "hello" });
    randomSpy.mockRestore();
    vi.useRealTimers();
  });

  it("does not reconnect after the ended close codes", () => {
    vi.useFakeTimers();
    const { socket, sockets, statuses } = setup();
    socket.connect();
    sockets[0]!.fire("close", { code: 4000 });
    expect(statuses).toContain("ended");
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1);
    vi.useRealTimers();
  });

  it("stop() prevents any further reconnects", () => {
    vi.useFakeTimers();
    const { socket, sockets } = setup();
    socket.connect();
    socket.stop();
    sockets[0]!.fire("close", { code: 1006 });
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1);
    vi.useRealTimers();
  });

  it("connect() supersedes a previous socket: a belated close from the old one (async WebSocket dispatch) triggers no extra reconnect", () => {
    vi.useFakeTimers();
    const { socket, sockets } = setup();
    socket.connect();
    sockets[0]!.readyState = FakeWS.OPEN;
    sockets[0]!.fire("open", {});
    socket.stop();
    socket.connect();
    // The browser dispatches WebSocket close events asynchronously, so ws1's
    // close can still arrive after stop() + connect() already moved on to ws2.
    sockets[0]!.fire("close", { code: 1006 });
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(2);
    vi.useRealTimers();
  });

  it("dispatches valid messages and swallows malformed JSON without throwing", () => {
    const { socket, sockets, messages } = setup();
    socket.connect();
    const ws = sockets[0]!;
    ws.readyState = FakeWS.OPEN;
    ws.fire("open", {});
    ws.fire("message", { data: JSON.stringify({ type: "chorus", from: "x" }) });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "chorus", from: "x" });
    expect(() => ws.fire("message", { data: "not json" })).not.toThrow();
    expect(messages).toHaveLength(1);
  });

  it("treats an 'ended' message as idempotent with the subsequent close and does not reconnect", () => {
    vi.useFakeTimers();
    const { socket, sockets, statuses } = setup();
    socket.connect();
    const ws = sockets[0]!;
    ws.readyState = FakeWS.OPEN;
    ws.fire("open", {});
    ws.fire("message", { data: JSON.stringify({ type: "ended" }) });
    ws.fire("close", { code: 4000 });
    expect(statuses.filter((s) => s === "ended")).toHaveLength(1);
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1);
    vi.useRealTimers();
  });

  it("send() returns false while connecting and delivers nothing", () => {
    const { socket, sockets } = setup();
    socket.connect();
    const ws = sockets[0]!;
    expect(socket.send({ type: "chorus" })).toBe(false);
    expect(ws.sent).toHaveLength(0);
  });

  it("escalates backoff across repeated abnormal closes and resets it after a stable open", () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { socket, sockets } = setup();
    socket.connect();

    sockets[0]!.fire("close", { code: 1006 });
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);

    sockets[1]!.fire("close", { code: 1006 });
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);

    sockets[2]!.readyState = FakeWS.OPEN;
    sockets[2]!.fire("open", {});
    sockets[2]!.fire("close", { code: 1006 });
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(4);

    randomSpy.mockRestore();
    vi.useRealTimers();
  });
});
