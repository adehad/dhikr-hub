import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("worker routing", () => {
  it("serves health", async () => {
    const res = await SELF.fetch("https://example.com/api/live/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects identity routes without bearer", async () => {
    const res = await SELF.fetch("https://example.com/api/live/identity/profile");
    expect(res.status).toBe(401);
  });
});
