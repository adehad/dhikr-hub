import type { ClientMessage, ServerMessage } from "./messages";

export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 15000);
}

export type LiveStatus = "connecting" | "open" | "closed" | "ended";

export interface LiveSocketHandlers {
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: LiveStatus) => void;
}

export class LiveSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private reconnectTimer: number | undefined;

  constructor(
    private wsUrl: string,
    private hello: { id: string; name: string },
    private handlers: LiveSocketHandlers,
    private makeWebSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {}

  connect(): void {
    this.stopped = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const previous = this.ws;
    this.ws = null;
    previous?.close(1000);

    this.handlers.onStatus("connecting");
    const ws = this.makeWebSocket(this.wsUrl);
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.send({ type: "hello", id: this.hello.id, name: this.hello.name });
      this.handlers.onStatus("open");
    });
    ws.addEventListener("message", (event) => {
      if (this.ws !== ws) return;
      let msg: ServerMessage;
      try {
        // The server (worker/room.ts) validates every field; its messages are
        // trusted without re-validation here.
        msg = JSON.parse((event as MessageEvent).data as string) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "ended") {
        // "ended" arrives twice on a host-ended event (message, then close 4000);
        // stop() makes the second path a no-op, and the app must treat status
        // "ended" as idempotent.
        this.stop();
        this.handlers.onStatus("ended");
      }
      this.handlers.onMessage(msg);
    });
    ws.addEventListener("close", (event) => {
      if (this.stopped || this.ws !== ws) return;
      // 4000: event ended by a host; 4004: the room no longer exists.
      if ((event as CloseEvent).code === 4000 || (event as CloseEvent).code === 4004) {
        this.stop();
        this.handlers.onStatus("ended");
        return;
      }
      this.handlers.onStatus("closed");
      this.reconnectTimer = setTimeout(
        () => this.connect(),
        // ±20% jitter so a worker restart doesn't reconnect a whole room in
        // lockstep; clamped to keep the documented 15s ceiling.
        Math.min(backoffMs(this.attempt++) * (0.8 + Math.random() * 0.4), 15000),
      ) as unknown as number;
    });
  }

  send(msg: ClientMessage): boolean {
    // 1 = WebSocket.OPEN; the global may be absent in tests.
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.ws?.close(1000);
    this.ws = null;
  }
}
