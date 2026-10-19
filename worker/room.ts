import { DurableObject } from "cloudflare:workers";
import { normalizeName, publicIdOf } from "./identity";
import {
  parseClientMessage,
  type ClientMessage,
  type PeerInfo,
  type ServerMessage,
  type Setlist,
  type VersePosition,
} from "../site/assets/live/messages";

interface RoomState {
  hosts: string[];
  leader: string;
  currentSlug: string | null;
  currentIndex?: number | null;
  position: VersePosition | null;
  setlist: Setlist | null;
  chorus?: boolean;
  roomName?: string;
  hostName?: string;
  lastActivity: number;
}

interface Attachment {
  publicId: string;
  name: string;
}

const IDLE_EXPIRY_MS = 24 * 60 * 60 * 1000;
const HELLO_TIMEOUT_MS = 10_000;
const POSITION_WRITE_INTERVAL_MS = 2000;
// Enough for scroll-derived positions at the 300ms client debounce, with margin.
const RATE_LIMIT_PER_10S = 60;

// follow-me is how a host takes the baton, so it is not leader-gated;
// the other broadcast-shaped messages only the current leader may send.
const LEADER_ONLY: ReadonlySet<ClientMessage["type"]> = new Set<
  Exclude<ClientMessage["type"], "hello" | "follow-me" | "promote" | "end-event">
>(["position", "navigate", "chorus", "setlist"]);

const HOST_ONLY_TYPES: ReadonlySet<ClientMessage["type"]> = new Set<
  Exclude<ClientMessage["type"], "hello">
>(["position", "navigate", "chorus", "follow-me", "promote", "setlist", "end-event"]);

export class LiveRoom extends DurableObject {
  // In-memory only: resets on hibernation wake, which just refills the bucket.
  private rate = new Map<WebSocket, { count: number; windowStart: number; warned: boolean }>();
  // In-memory like `rate`: reset on hibernation wake is harmless.
  private lastPositionWrite = 0;
  private pendingPosition: VersePosition | null = null;
  private positionFlush: ReturnType<typeof setTimeout> | null = null;
  private ending = false;

  private async state(): Promise<RoomState | undefined> {
    return this.ctx.storage.get<RoomState>("room");
  }

  private async saveState(s: RoomState): Promise<void> {
    s.lastActivity = Date.now();
    await this.ctx.storage.put("room", s);
  }

  private async armIdleAlarm(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + IDLE_EXPIRY_MS);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      if (await this.state()) {
        return Response.json({ error: "room exists" }, { status: 409 });
      }
      this.ending = false;
      const body = (await request.json()) as { creator: string; name: string; roomName?: unknown };
      const s: RoomState = {
        hosts: [body.creator],
        leader: body.creator,
        currentSlug: null,
        currentIndex: null,
        position: null,
        setlist: null,
        chorus: false,
        roomName: typeof body.roomName === "string" ? body.roomName : "",
        hostName: body.name,
        lastActivity: Date.now(),
      };
      await this.saveState(s);
      await this.armIdleAlarm();
      return Response.json({ ok: true });
    }

    if (url.pathname === "/meta" && request.method === "GET") {
      const s = await this.state();
      if (!s) return Response.json({ error: "not found" }, { status: 404 });
      // Served to unauthenticated link-preview crawlers: no identity data.
      return Response.json({
        name: s.roomName ?? "",
        setlistName: s.setlist?.name ?? null,
        trackCount: s.setlist?.items.length ?? 0,
      });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      const s = await this.state();
      if (!s) return Response.json({ exists: false });
      // Public and unauthenticated: counts only, never names or publicIds.
      const roster = this.roster(s.hosts);
      return Response.json({
        exists: true,
        name: s.roomName ?? "",
        people: roster.length,
        live: roster.some((p) => p.publicId === s.leader),
        lastActive: new Date(s.lastActivity).toISOString(),
      });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return Response.json({ error: "expected websocket" }, { status: 426 });
      }
      const pair = new WebSocketPair();
      const server = pair[1];
      if (!(await this.state())) {
        // A rejected upgrade reaches the browser as close code 1006, which the
        // client retries forever; 4004 tells it the room is gone.
        server.accept();
        server.close(4004, "room ended");
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      this.ctx.acceptWebSocket(server);
      setTimeout(() => {
        if (!this.attachment(server)) server.close(4001, "hello required");
      }, HELLO_TIMEOUT_MS);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }

  private attachment(ws: WebSocket): Attachment | null {
    return (ws.deserializeAttachment() as Attachment | null) ?? null;
  }

  private roster(hosts: string[]): PeerInfo[] {
    const seen = new Map<string, PeerInfo>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.attachment(ws);
      if (a && !seen.has(a.publicId)) {
        seen.set(a.publicId, { publicId: a.publicId, name: a.name, isHost: hosts.includes(a.publicId) });
      }
    }
    return [...seen.values()];
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    const raw = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except && this.attachment(ws)) {
        try {
          ws.send(raw);
        } catch {
          // Peer gone between getWebSockets and send; close event will clean up.
        }
      }
    }
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    ws.send(JSON.stringify({ type: "error", code, message } satisfies ServerMessage));
  }

  private overRateLimit(ws: WebSocket): boolean {
    const now = Date.now();
    const entry = this.rate.get(ws);
    if (!entry || now - entry.windowStart > 10_000) {
      this.rate.set(ws, { count: 1, windowStart: now, warned: false });
      return false;
    }
    entry.count += 1;
    if (entry.count > RATE_LIMIT_PER_10S) {
      if (!entry.warned) {
        entry.warned = true;
        this.sendError(ws, "rate-limited", "message rate exceeded");
      }
      return true;
    }
    return false;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    if (this.overRateLimit(ws)) return;
    const msg = parseClientMessage(raw);
    const attached = this.attachment(ws);
    if (!msg) {
      // An unauthenticated socket gets no second chance after malformed input.
      if (!attached) ws.close(4001, "hello required");
      return;
    }
    if (!attached) {
      if (msg.type !== "hello") {
        ws.close(4001, "hello required");
        return;
      }
      await this.handleHello(ws, msg);
      return;
    }
    if (msg.type === "hello") return; // duplicate hello is a no-op

    const s = await this.state();
    if (!s) {
      ws.close(4004, "room ended");
      return;
    }

    if (HOST_ONLY_TYPES.has(msg.type) && !s.hosts.includes(attached.publicId)) {
      this.sendError(ws, "not-host", "hosts only");
      return;
    }

    if (LEADER_ONLY.has(msg.type) && s.leader !== attached.publicId) {
      this.sendError(ws, "not-leader", "only the leader broadcasts");
      return;
    }

    await this.handleHostMessage(ws, attached, msg, s);
  }

  private async handleHello(
    ws: WebSocket,
    msg: Extract<ClientMessage, { type: "hello" }>,
  ): Promise<void> {
    // Hash before reading state: a non-storage await between storage.get and
    // .put opens the DO input gate and lets another event interleave.
    const publicId = await publicIdOf(msg.id);
    const name = normalizeName(msg.name, "Listener");
    const s = await this.state();
    if (!s) {
      ws.close(4004, "room ended");
      return;
    }
    ws.serializeAttachment({ publicId, name } satisfies Attachment);

    const roster = this.roster(s.hosts);
    const snapshot: ServerMessage = {
      type: "snapshot",
      you: publicId,
      leader: s.leader,
      hosts: s.hosts,
      roster,
      currentSlug: s.currentSlug,
      currentIndex: s.currentIndex ?? null,
      position: s.position,
      setlist: s.setlist,
      chorus: s.chorus === true,
      roomName: s.roomName ?? "",
    };
    ws.send(JSON.stringify(snapshot));
    this.broadcast(
      { type: "peer-joined", peer: { publicId, name, isHost: s.hosts.includes(publicId) } },
      ws,
    );
    await this.saveState(s);
    await this.armIdleAlarm();
  }

  private async handleHostMessage(
    ws: WebSocket,
    from: Attachment,
    msg: Exclude<ClientMessage, { type: "hello" }>,
    s: RoomState,
  ): Promise<void> {
    switch (msg.type) {
      case "position": {
        this.broadcast({ type: "position", from: from.publicId, position: msg.position }, ws);
        // Persist only for late-joiner snapshots, at most every 2s, with a
        // trailing write so the snapshot ends on the host's last position:
        // per-message writes would burn the free plan's daily row budget in
        // one long event.
        const sinceWrite = Date.now() - this.lastPositionWrite;
        if (sinceWrite > POSITION_WRITE_INTERVAL_MS) {
          this.cancelPositionFlush();
          this.lastPositionWrite = Date.now();
          s.position = msg.position;
          await this.saveState(s);
        } else {
          this.pendingPosition = msg.position;
          this.positionFlush ??= setTimeout(
            () => void this.flushPosition(),
            POSITION_WRITE_INTERVAL_MS - sinceWrite,
          );
        }
        break;
      }
      case "navigate":
        this.broadcast(
          msg.index === undefined
            ? { type: "navigate", from: from.publicId, slug: msg.slug }
            : { type: "navigate", from: from.publicId, slug: msg.slug, index: msg.index },
          ws,
        );
        s.currentSlug = msg.slug;
        s.currentIndex = msg.index ?? null;
        s.position = null;
        s.chorus = false;
        // Let the first position on the new qasida persist immediately.
        this.cancelPositionFlush();
        this.lastPositionWrite = 0;
        await this.saveState(s);
        break;
      case "chorus":
        this.broadcast({ type: "chorus", from: from.publicId, on: msg.on !== false }, ws);
        s.chorus = msg.on !== false;
        await this.saveState(s);
        break;
      case "follow-me":
        s.leader = from.publicId;
        await this.saveState(s);
        this.broadcast({ type: "hosts", hosts: s.hosts, leader: s.leader });
        break;
      case "promote": {
        const present = this.roster(s.hosts).some((p) => p.publicId === msg.target);
        if (!present) {
          this.sendError(ws, "unknown-target", "target not in room");
          break;
        }
        if (!s.hosts.includes(msg.target)) {
          s.hosts.push(msg.target);
          await this.saveState(s);
          this.broadcast({ type: "hosts", hosts: s.hosts, leader: s.leader });
        }
        break;
      }
      case "setlist":
        this.broadcast({ type: "setlist", from: from.publicId, setlist: msg.setlist }, ws);
        s.setlist = msg.setlist;
        await this.saveState(s);
        break;
      case "end-event":
        this.ending = true;
        this.cancelPositionFlush();
        this.broadcast({ type: "ended" });
        for (const socket of this.ctx.getWebSockets()) socket.close(4000, "ended");
        this.rate.clear();
        await this.ctx.storage.deleteAll();
        await this.ctx.storage.deleteAlarm();
        break;
      default: {
        const exhaustive: never = msg;
        void exhaustive;
      }
    }
  }

  private cancelPositionFlush(): void {
    if (this.positionFlush) clearTimeout(this.positionFlush);
    this.positionFlush = null;
    this.pendingPosition = null;
  }

  private async flushPosition(): Promise<void> {
    const position = this.pendingPosition;
    this.positionFlush = null;
    this.pendingPosition = null;
    if (!position || this.ending) return;
    const s = await this.state();
    if (!s) return;
    this.lastPositionWrite = Date.now();
    s.position = position;
    await this.saveState(s);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.rate.delete(ws);
    if (this.ending) return;
    const a = this.attachment(ws);
    if (!a) return;
    ws.serializeAttachment(null);
    const stillPresent = this.ctx
      .getWebSockets()
      .some((other) => other !== ws && this.attachment(other)?.publicId === a.publicId);
    if (!stillPresent) {
      this.broadcast({ type: "peer-left", publicId: a.publicId }, ws);
    }
    await this.armIdleAlarm();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    const s = await this.state();
    if (!s) return;
    // Sockets that never said hello don't keep a room alive.
    const present = this.ctx.getWebSockets().some((ws) => this.attachment(ws));
    if (Date.now() - s.lastActivity >= IDLE_EXPIRY_MS && !present) {
      await this.ctx.storage.deleteAll();
    } else {
      // Followers send nothing, so lastActivity can be a day old while they are
      // still connected; scheduling from it would refire the alarm immediately.
      await this.ctx.storage.setAlarm(Math.max(s.lastActivity, Date.now()) + IDLE_EXPIRY_MS);
    }
  }
}
