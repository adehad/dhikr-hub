import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { injectPreview } from "../index";
import { createRoom, join, nextMessage } from "./helpers";

const HOST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function page(): Response {
  return new Response(
    '<html><head><title>Live | Dhikr Hub</title><meta name="description" content="x"></head><body></body></html>',
    { headers: { "Content-Type": "text/html" } },
  );
}

function metaContent(html: string, attr: "property" | "name", key: string): string[] {
  const re = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`, "g");
  return [...html.matchAll(re)].map((m) => m[1]!);
}

describe("injectPreview", () => {
  it("sets title, description and og/twitter tags from the room name", async () => {
    const html = await injectPreview(
      page(),
      { name: "Thursday mawlid", setlistName: null, trackCount: 1 },
      "https://example.com/live/?room=abcdefgh",
    ).text();
    expect(html).toContain("<title>Thursday mawlid · Dhikr Hub Live</title>");
    expect(metaContent(html, "name", "description")).toEqual(["1 qasida · join the gathering"]);
    expect(metaContent(html, "property", "og:title")).toEqual(["Thursday mawlid · Dhikr Hub Live"]);
    expect(metaContent(html, "property", "og:description")).toEqual(["1 qasida · join the gathering"]);
    expect(metaContent(html, "property", "og:type")).toEqual(["website"]);
    expect(metaContent(html, "property", "og:url")).toEqual(["https://example.com/live/?room=abcdefgh"]);
    expect(metaContent(html, "property", "og:site_name")).toEqual(["Dhikr Hub"]);
    expect(metaContent(html, "property", "og:image")).toEqual(["https://example.com/og/live.png"]);
    expect(metaContent(html, "property", "og:image:width")).toEqual(["1200"]);
    expect(metaContent(html, "property", "og:image:height")).toEqual(["630"]);
    expect(metaContent(html, "property", "og:image:alt")).toEqual(["Dhikr Hub Live"]);
    expect(metaContent(html, "name", "twitter:card")).toEqual(["summary_large_image"]);
    expect(metaContent(html, "name", "twitter:title")).toEqual(["Thursday mawlid · Dhikr Hub Live"]);
    expect(metaContent(html, "name", "twitter:description")).toEqual(["1 qasida · join the gathering"]);
    expect(metaContent(html, "name", "twitter:image")).toEqual(["https://example.com/og/live.png"]);
    expect(html.indexOf("og:title")).toBeLessThan(html.indexOf("</head>"));
  });

  it("titles by the setlist when it differs from the room name", async () => {
    const html = await injectPreview(
      page(),
      { name: "Ahmad's room", setlistName: "Mawlid set", trackCount: 3 },
      "https://example.com/live/?room=abcdefgh",
    ).text();
    expect(html).toContain("<title>Mawlid set · Dhikr Hub Live</title>");
    expect(metaContent(html, "property", "og:description")).toEqual(["3 qasidas · join the gathering"]);
  });

  it("keeps the room name as title when the setlist has the same name", async () => {
    const html = await injectPreview(
      page(),
      { name: "Mawlid", setlistName: "Mawlid", trackCount: 0 },
      "https://example.com/live/?room=abcdefgh",
    ).text();
    expect(metaContent(html, "property", "og:title")).toEqual(["Mawlid · Dhikr Hub Live"]);
    expect(metaContent(html, "property", "og:description")).toEqual(["Join the gathering"]);
  });

  it("falls back to a generic name when the room has none", async () => {
    const html = await injectPreview(
      page(),
      { name: "", setlistName: null, trackCount: 0 },
      "https://example.com/live/?room=abcdefgh",
    ).text();
    expect(html).toContain("<title>Live room · Dhikr Hub Live</title>");
  });

  it("escapes markup and quotes in the name and URL", async () => {
    const name = '<script>alert("x")</script>';
    const html = await injectPreview(
      page(),
      { name, setlistName: null, trackCount: 2 },
      'https://example.com/live/?room=abcdefgh&q="<',
    ).text();
    expect(html).not.toContain("<script>");
    expect(html).toContain('<title>&lt;script&gt;alert("x")&lt;/script&gt; · Dhikr Hub Live</title>');
    expect(metaContent(html, "property", "og:title")).toEqual([
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; · Dhikr Hub Live",
    ]);
    expect(metaContent(html, "property", "og:url")).toEqual([
      "https://example.com/live/?room=abcdefgh&amp;q=&quot;&lt;",
    ]);
    const description = /<meta name="description" content="([^"]*)"/.exec(html);
    expect(description).not.toBeNull();
    expect(description![1]).not.toContain("<");
  });

  it("replaces static og and twitter tags instead of duplicating them", async () => {
    const res = new Response(
      '<html><head><title>Live</title><meta property="og:title" content="Live"><meta property="og:site_name" content="Dhikr Hub"><meta name="twitter:card" content="summary_large_image"></head></html>',
      { headers: { "Content-Type": "text/html" } },
    );
    const html = await injectPreview(res, { name: "Room", setlistName: null, trackCount: 1 }, "https://x/").text();
    expect(metaContent(html, "property", "og:title")).toEqual(["Room · Dhikr Hub Live"]);
    expect(metaContent(html, "property", "og:site_name")).toEqual(["Dhikr Hub"]);
    expect(metaContent(html, "name", "twitter:card")).toEqual(["summary_large_image"]);
  });
});

describe("invite link preview", () => {
  it("serves the setlist title, falls back for unknown rooms, and stops after the event ends", async () => {
    const room = await createRoom(HOST_ID, "Ahmad", "Thursday mawlid");
    const host = await join(room, HOST_ID, "Ahmad");
    host.ws.send(
      JSON.stringify({
        type: "setlist",
        setlist: { id: "s1", name: "Mawlid set", items: ["a", "b", "c"], updatedAt: "2026-10-16T00:00:00Z" },
      }),
    );
    host.ws.send(JSON.stringify({ type: "follow-me" }));
    while ((await nextMessage(host.ws)).type !== "hosts");

    const res = await SELF.fetch(`https://example.com/live/?room=${room}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30");
    const html = await res.text();
    expect(metaContent(html, "property", "og:title")).toEqual(["Mawlid set · Dhikr Hub Live"]);
    expect(metaContent(html, "property", "og:description")).toEqual(["3 qasidas · join the gathering"]);
    expect(html).toContain("<title>Mawlid set · Dhikr Hub Live</title>");
    expect(metaContent(html, "property", "og:image")).toEqual(["https://example.com/og/live.png"]);
    expect(metaContent(html, "name", "twitter:image")).toEqual(["https://example.com/og/live.png"]);
    expect(metaContent(html, "name", "twitter:card")).toEqual(["summary_large_image"]);

    // A real Hugo build carries its own static og:title, so the fallback is
    // compared with the plain page rather than checked for a missing tag.
    const plain = await (await SELF.fetch("https://example.com/live/")).text();
    const unknown = await SELF.fetch("https://example.com/live/?room=zzzzzzzz");
    expect(unknown.status).toBe(200);
    expect(await unknown.text()).toBe(plain);

    const ended = new Promise<void>((resolve) => host.ws.addEventListener("close", () => resolve()));
    host.ws.send(JSON.stringify({ type: "end-event" }));
    await ended;

    // Previews are cached for 30 s by URL, so a fresh query string is needed
    // to observe the ended room.
    const after = await SELF.fetch(`https://example.com/live/?room=${room}&v=2`);
    const afterHtml = await after.text();
    expect(afterHtml).not.toContain("Mawlid set");
    expect(afterHtml).toBe(plain);
  });

  it("does not cache the preview while the room has no setlist", async () => {
    const room = await createRoom(HOST_ID, "Ahmad", "Fresh room");
    const host = await join(room, HOST_ID, "Ahmad");

    const empty = await SELF.fetch(`https://example.com/live/?room=${room}`);
    expect(empty.headers.get("Cache-Control")).not.toBe("public, max-age=30");
    expect(metaContent(await empty.text(), "property", "og:description")).toEqual(["Join the gathering"]);

    host.ws.send(
      JSON.stringify({
        type: "setlist",
        setlist: { id: "s2", name: "Fresh room", items: ["a", "b"], updatedAt: "2026-10-16T00:00:00Z" },
      }),
    );
    host.ws.send(JSON.stringify({ type: "follow-me" }));
    while ((await nextMessage(host.ws)).type !== "hosts");

    const filled = await SELF.fetch(`https://example.com/live/?room=${room}`);
    expect(filled.headers.get("Cache-Control")).toBe("public, max-age=30");
    expect(metaContent(await filled.text(), "property", "og:description")).toEqual(["2 qasidas · join the gathering"]);
  });

  it("serves the plain page for a malformed room code", async () => {
    const plain = await (await SELF.fetch("https://example.com/live/")).text();
    const bad = await SELF.fetch("https://example.com/live/?room=NOT-A-CODE");
    expect(await bad.text()).toBe(plain);
  });
});
