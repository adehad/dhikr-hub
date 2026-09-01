import { DurableObject } from "cloudflare:workers";

export interface Env {
  LIVE_ROOM: DurableObjectNamespace;
  IDENTITY: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export async function publicIdOf(fullId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(fullId),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Shared rule for user-supplied display names: trimmed, clamped to 64 code
// points (not UTF-16 units — Arabic names with harakat or emoji must not be
// cut mid-character), falling back when empty or non-string.
export function normalizeName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  // Strip controls and bidi overrides (roster spoofing), keeping ZWJ/ZWNJ so
  // emoji sequences and Arabic joining behavior survive.
  const cleaned = value.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/gu, "");
  const clamped = Array.from(cleaned.trim()).slice(0, 64).join("").trim();
  return clamped || fallback;
}

interface Profile {
  publicId: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
}

export const IDENTITY_TTL_MS = 365 * 24 * 60 * 60 * 1000;

// A read refreshes liveness at most once a day; finer precision would turn
// every profile GET into two billable writes for a 1-year TTL.
const TOUCH_STALE_MS = 24 * 60 * 60 * 1000;

export function identityExpired(lastSeenAt: string, now: number, ttlMs = IDENTITY_TTL_MS): boolean {
  const seen = Date.parse(lastSeenAt);
  return Number.isFinite(seen) ? now - seen >= ttlMs : true;
}

export class IdentityRegistry extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const publicId = request.headers.get("X-Public-Id");
    if (!publicId) return Response.json({ error: "missing public id" }, { status: 400 });

    // Parse the body before touching storage: workerd throws "Can't read from
    // request stream after response has been sent" if a POST body is unread at
    // response time, and a non-storage await between storage.get and .put
    // opens the input gate, letting a concurrent request interleave the
    // read-modify-write.
    const body =
      request.method === "POST"
        ? ((await request.json().catch(() => ({}))) as { name?: unknown })
        : {};

    const existing = await this.ctx.storage.get<Profile>("profile");

    // Any touch of an existing profile is a liveness signal: refresh
    // lastSeenAt and re-arm the TTL alarm alongside the stored fields, but
    // only once a day is elapsed (see TOUCH_STALE_MS above).
    const touch = async (profile: Profile): Promise<Profile> => {
      if (Date.now() - Date.parse(profile.lastSeenAt) < TOUCH_STALE_MS) return profile;
      const refreshed: Profile = { ...profile, lastSeenAt: new Date().toISOString() };
      await this.ctx.storage.put("profile", refreshed);
      await this.ctx.storage.setAlarm(Date.now() + IDENTITY_TTL_MS);
      return refreshed;
    };

    if (url.pathname === "/profile" && request.method === "GET") {
      if (!existing) return Response.json({ error: "unknown identity" }, { status: 404 });
      return Response.json(await touch(existing));
    }

    if (url.pathname === "/register" && request.method === "POST") {
      if (existing) return Response.json(await touch(existing));
      const now = new Date().toISOString();
      const profile: Profile = {
        publicId,
        name: normalizeName(body.name, "Listener"),
        createdAt: now,
        lastSeenAt: now,
      };
      await this.ctx.storage.put("profile", profile);
      await this.ctx.storage.setAlarm(Date.now() + IDENTITY_TTL_MS);
      return Response.json(profile);
    }

    if (url.pathname === "/name" && request.method === "POST") {
      if (!existing) return Response.json({ error: "unknown identity" }, { status: 404 });
      // A rename always writes; lastSeenAt and the alarm move only past the
      // staleness gate, as for any other touch.
      const stale = Date.now() - Date.parse(existing.lastSeenAt) >= TOUCH_STALE_MS;
      const profile: Profile = {
        ...existing,
        name: normalizeName(body.name, existing.name),
        lastSeenAt: stale ? new Date().toISOString() : existing.lastSeenAt,
      };
      await this.ctx.storage.put("profile", profile);
      if (stale) await this.ctx.storage.setAlarm(Date.now() + IDENTITY_TTL_MS);
      return Response.json(profile);
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    const profile = await this.ctx.storage.get<Profile>("profile");
    if (!profile) return;
    if (identityExpired(profile.lastSeenAt, Date.now())) {
      await this.ctx.storage.deleteAll();
    } else {
      await this.ctx.storage.setAlarm(Date.parse(profile.lastSeenAt) + IDENTITY_TTL_MS);
    }
  }
}
