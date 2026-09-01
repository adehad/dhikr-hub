import { publicIdOf, normalizeName, IdentityRegistry } from "./identity";
import type { Env } from "./identity";
import { LiveRoom } from "./room";

export { IdentityRegistry, LiveRoom };

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

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
      let parsedBody: { name?: unknown };
      try {
        parsedBody = JSON.parse(rawBody || "{}") as { name?: unknown };
      } catch {
        parsedBody = {};
      }
      const name = normalizeName(parsedBody.name, "Listener");

      for (let attempt = 0; attempt < 3; attempt++) {
        const room = newRoomHash();
        const stub = env.LIVE_ROOM.get(env.LIVE_ROOM.idFromName(room));
        const res = await stub.fetch(
          new Request("https://do/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ creator: publicId, name }),
          }),
        );
        if (res.status === 409) continue;
        if (!res.ok) return json({ error: "room init failed" }, 500);
        return json({ room });
      }
      return json({ error: "room init failed" }, 500);
    }

    const wsMatch = /^\/api\/live\/room\/([a-z2-9]{8})\/ws$/.exec(path);
    if (wsMatch) {
      const stub = env.LIVE_ROOM.get(env.LIVE_ROOM.idFromName(wsMatch[1]!));
      return stub.fetch(new Request("https://do/ws", request));
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
