import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { identityExpired } from "../identity";

// Durable Object storage is shared by every test in this file, so each test
// uses its own identity ID.
function uid(n: number): string {
  return `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`;
}

function req(path: string, id: string, init?: RequestInit) {
  return SELF.fetch(`https://example.com/api/live/identity${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${id}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

describe("identity registry", () => {
  it("profile 404 before registration", async () => {
    const res = await req("/profile", uid(1));
    expect(res.status).toBe(404);
  });

  it("register creates and returns profile with derived publicId", async () => {
    const res = await req("/register", uid(2), {
      method: "POST",
      body: JSON.stringify({ name: "Ahmad" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publicId: string; name: string };
    expect(body.name).toBe("Ahmad");
    expect(body.publicId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("register is idempotent and keeps the stored name", async () => {
    await req("/register", uid(3), { method: "POST", body: JSON.stringify({ name: "Ahmad" }) });
    const res = await req("/register", uid(3), {
      method: "POST",
      body: JSON.stringify({ name: "SomeoneElse" }),
    });
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Ahmad");
  });

  it("login via profile returns stored profile", async () => {
    await req("/register", uid(4), { method: "POST", body: JSON.stringify({ name: "Ahmad" }) });
    const res = await req("/profile", uid(4));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Ahmad");
  });

  it("rename updates the profile", async () => {
    await req("/register", uid(5), { method: "POST", body: JSON.stringify({ name: "Ahmad" }) });
    await req("/name", uid(5), { method: "POST", body: JSON.stringify({ name: "Ahmad (laptop)" }) });
    const res = await req("/profile", uid(5));
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Ahmad (laptop)");
  });

  it("rename before registration returns 404", async () => {
    const res = await req("/name", uid(6), { method: "POST", body: JSON.stringify({ name: "X" }) });
    expect(res.status).toBe(404);
  });

  it("identities are isolated per ID", async () => {
    const a = (await (
      await req("/register", uid(7), { method: "POST", body: JSON.stringify({ name: "A" }) })
    ).json()) as { publicId: string };
    const b = (await (
      await req("/register", uid(8), { method: "POST", body: JSON.stringify({ name: "B" }) })
    ).json()) as { publicId: string };
    expect(a.publicId).not.toBe(b.publicId);
    const aProfile = (await (await req("/profile", uid(7))).json()) as { name: string };
    expect(aProfile.name).toBe("A");
  });

  it("normalizes names: blank and non-string fall back, long names clamp to 64 code points", async () => {
    const blank = (await (
      await req("/register", uid(9), { method: "POST", body: JSON.stringify({ name: "   " }) })
    ).json()) as { name: string };
    expect(blank.name).toBe("Listener");
    const numeric = (await (
      await req("/register", uid(2) + "-b", { method: "POST", body: JSON.stringify({ name: 42 }) })
    ).json()) as { name: string };
    expect(numeric.name).toBe("Listener");
    const long = "x".repeat(100);
    await req("/name", uid(9), { method: "POST", body: JSON.stringify({ name: long }) });
    const clamped = (await (await req("/profile", uid(9))).json()) as { name: string };
    expect(clamped.name).toBe("x".repeat(64));
  });

  it("createdAt survives re-register", async () => {
    const first = (await (
      await req("/register", uid(3) + "-b", { method: "POST", body: JSON.stringify({ name: "A" }) })
    ).json()) as { createdAt: string };
    const again = (await (
      await req("/register", uid(3) + "-b", { method: "POST", body: JSON.stringify({ name: "B" }) })
    ).json()) as { createdAt: string };
    expect(again.createdAt).toBe(first.createdAt);
  });

  it("strips bidi overrides and control characters from names", async () => {
    const res = (await (
      await req("/register", uid(10), {
        method: "POST",
        body: JSON.stringify({ name: "Ahm‮ad" }),
      })
    ).json()) as { name: string };
    expect(res.name).toBe("Ahmad");

    const fallback = (await (
      await req("/register", uid(11), {
        method: "POST",
        body: JSON.stringify({ name: "‮" }),
      })
    ).json()) as { name: string };
    expect(fallback.name).toBe("Listener");
  });

  it("profile GET carries a well-formed lastSeenAt but does not refresh it within a day", async () => {
    await req("/register", uid(12), { method: "POST", body: JSON.stringify({ name: "Ahmad" }) });
    const first = (await (await req("/profile", uid(12))).json()) as { lastSeenAt: string };
    expect(Number.isFinite(Date.parse(first.lastSeenAt))).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    const second = (await (await req("/profile", uid(12))).json()) as { lastSeenAt: string };
    expect(Number.isFinite(Date.parse(second.lastSeenAt))).toBe(true);
    // The staleness gate (TOUCH_STALE_MS = 1 day) suppresses the write for a
    // read this soon after the last one: pins that the value is unchanged.
    expect(second.lastSeenAt).toBe(first.lastSeenAt);
  });

  it("body over the size cap is rejected with 413", async () => {
    const res = await req("/register", uid(13), {
      method: "POST",
      body: JSON.stringify({ name: "x".repeat(5000) }),
    });
    expect(res.status).toBe(413);
  });

  it("a streamed body with no Content-Length stops being read past the size cap", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const total = 256;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled === total) {
          controller.close();
          return;
        }
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const res = await req("/register", uid(14), { method: "POST", body });
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(total);
  });
});

describe("identityExpired", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const YEAR_MS = 365 * DAY;

  it("is false just under the TTL", () => {
    const now = Date.now();
    const lastSeenAt = new Date(now - YEAR_MS + DAY).toISOString();
    expect(identityExpired(lastSeenAt, now)).toBe(false);
  });

  it("is true at the TTL boundary", () => {
    const now = Date.now();
    const lastSeenAt = new Date(now - YEAR_MS).toISOString();
    expect(identityExpired(lastSeenAt, now)).toBe(true);
  });

  it("is true well over the TTL", () => {
    const now = Date.now();
    const lastSeenAt = new Date(now - YEAR_MS - DAY).toISOString();
    expect(identityExpired(lastSeenAt, now)).toBe(true);
  });

  it("is true for garbage input", () => {
    expect(identityExpired("not-a-date", Date.now())).toBe(true);
  });
});
