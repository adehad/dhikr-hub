import { publicIdOf, normalizeName, IdentityRegistry } from "./identity";
import type { Env } from "./identity";
import { LiveRoom } from "./room";
import { injectPreview, type RoomMeta } from "./preview";

export { IdentityRegistry, LiveRoom };
export { injectPreview };

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function bearerId(request: Request): string | null {
  const auth = (request.headers.get("Authorization") ?? "").trim();
  const m = /^bearer (.+)$/i.exec(auth);
  return m && m[1]!.length <= 256 ? m[1]! : null;
}

// Unambiguous alphabet: no 0/o/1/l, readable aloud at a gathering.
// Its length must divide 256, or the modulo below stops being uniform.
const ROOM_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function newRoomHash(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join("");
}

function identityStub(env: Env, publicId: string): DurableObjectStub {
  return env.IDENTITY.get(env.IDENTITY.idFromName(publicId));
}

const MAX_BODY_BYTES = 4096;

// Buffers and bounds a client body so no unbounded stream reaches a DO.
async function boundedBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}

function roomStub(env: Env, room: string): DurableObjectStub {
  return env.LIVE_ROOM.get(env.LIVE_ROOM.idFromName(room));
}

const PREVIEW_CACHE_CONTROL = "public, max-age=30";

// Link-preview crawlers do not run the client, so the invite page carries the
// room's title in its static HTML. Any failure falls back to the plain page.
async function invitePage(request: Request, env: Env, ctx: ExecutionContext, room: string): Promise<Response> {
  const cache = caches.default;
  try {
    const cached = await cache.match(request.url);
    if (cached) return cached;
    const metaRes = await roomStub(env, room).fetch("https://do/meta");
    if (metaRes.status !== 200) return env.ASSETS.fetch(request);
    const meta = (await metaRes.json()) as RoomMeta;
    const asset = await env.ASSETS.fetch(request);
    if (!asset.ok || !(asset.headers.get("Content-Type") ?? "").includes("text/html")) return asset;
    const page = injectPreview(asset, meta, request.url);
    // The host's own first load arrives before the setlist does; caching that
    // would pin "0 qasidas" on the first shares of a fresh room.
    if (meta.trackCount > 0) {
      page.headers.set("Cache-Control", PREVIEW_CACHE_CONTROL);
      ctx.waitUntil(cache.put(request.url, page.clone()).catch(() => {}));
    }
    return page;
  } catch {
    return env.ASSETS.fetch(request);
  }
}

async function roomStatus(env: Env, room: string): Promise<Response> {
  let body: unknown = { exists: false };
  if (/^[a-z2-9]{8}$/.test(room)) {
    try {
      const res = await roomStub(env, room).fetch("https://do/status");
      if (res.ok) body = await res.json();
    } catch {
      // A failed lookup reads as an absent room rather than a 500.
    }
  }
  const res = json(body);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const inviteRoom = url.searchParams.get("room");
    if (
      request.method === "GET" &&
      (path === "/live/" || path === "/live/index.html") &&
      inviteRoom !== null &&
      /^[a-z2-9]{8}$/.test(inviteRoom)
    ) {
      return invitePage(request, env, ctx, inviteRoom);
    }

    if (!path.startsWith("/api/live/")) {
      return env.ASSETS.fetch(request);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" },
      });
    }

    if (path === "/api/live/health") {
      return json({ ok: true });
    }

    if (path.startsWith("/api/live/identity/")) {
      const fullId = bearerId(request);
      if (!fullId) return json({ error: "missing bearer id" }, 401);
      // The secret never crosses another API boundary: the DO is addressed by
      // the derived publicId and receives only that.
      const publicId = await publicIdOf(fullId);
      let body: string | null = null;
      if (request.method === "POST") {
        body = await boundedBody(request);
        if (body === null) return json({ error: "body too large" }, 413);
      }
      const forwarded = new Request(
        new URL(path.replace("/api/live/identity", ""), "https://do"),
        {
          method: request.method,
          headers: { "Content-Type": "application/json", "X-Public-Id": publicId },
          body,
        },
      );
      const res = await identityStub(env, publicId).fetch(forwarded);
      return new Response(res.body, {
        status: res.status,
        headers: {
          "Content-Type": res.headers.get("Content-Type") ?? "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    if (path === "/api/live/room" && request.method === "POST") {
      const fullId = bearerId(request);
      if (!fullId) return json({ error: "missing bearer id" }, 401);
      const publicId = await publicIdOf(fullId);
      const profile = await identityStub(env, publicId).fetch(
        new Request("https://do/profile", { headers: { "X-Public-Id": publicId } }),
      );
      if (!profile.ok) return json({ error: "unregistered identity" }, 403);

      const rawBody = await boundedBody(request);
      if (rawBody === null) return json({ error: "body too large" }, 413);
      let parsedBody: { name?: unknown; roomName?: unknown };
      try {
        parsedBody = JSON.parse(rawBody || "{}") as { name?: unknown; roomName?: unknown };
      } catch {
        parsedBody = {};
      }
      const name = normalizeName(parsedBody.name, "Listener");
      const roomName = normalizeName(parsedBody.roomName, `${name}'s room`);

      for (let attempt = 0; attempt < 3; attempt++) {
        const room = newRoomHash();
        const res = await roomStub(env, room).fetch(
          new Request("https://do/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ creator: publicId, name, roomName }),
          }),
        );
        if (res.status === 409) continue;
        if (!res.ok) return json({ error: "room init failed" }, 500);
        return json({ room });
      }
      return json({ error: "room init failed" }, 500);
    }

    const statusMatch = /^\/api\/live\/room\/([^/]+)\/status$/.exec(path);
    if (statusMatch && request.method === "GET") {
      return roomStatus(env, statusMatch[1]!);
    }

    const wsMatch = /^\/api\/live\/room\/([a-z2-9]{8})\/ws$/.exec(path);
    if (wsMatch) {
      return roomStub(env, wsMatch[1]!).fetch(new Request("https://do/ws", request));
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
