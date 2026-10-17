export interface RoomMeta {
  name: string;
  setlistName: string | null;
  trackCount: number;
}

// Hugo already emits page-level versions of these; crawlers read the first
// occurrence, so the static ones are dropped rather than shadowed.
const REPLACED_META = new Set([
  "og:title",
  "og:description",
  "og:type",
  "og:url",
  "og:site_name",
  "og:image",
  "og:image:width",
  "og:image:height",
  "og:image:alt",
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
]);

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function previewText(meta: RoomMeta): { title: string; description: string } {
  const name = meta.setlistName && meta.setlistName !== meta.name ? meta.setlistName : meta.name || "Live room";
  const n = meta.trackCount;
  const description =
    n === 0 ? "Join the gathering" : `${n} ${n === 1 ? "qasida" : "qasidas"} · join the gathering`;
  return { title: `${name} · Dhikr Hub Live`, description };
}

export function injectPreview(response: Response, meta: RoomMeta, pageUrl: string): Response {
  const { title, description } = previewText(meta);
  const image = new URL("/og/live.png", pageUrl).toString();
  const tag = (attr: "property" | "name", key: string, content: string) =>
    `<meta ${attr}="${key}" content="${escapeAttr(content)}">`;
  const tags = [
    tag("property", "og:title", title),
    tag("property", "og:description", description),
    tag("property", "og:type", "website"),
    tag("property", "og:url", pageUrl),
    tag("property", "og:site_name", "Dhikr Hub"),
    tag("property", "og:image", image),
    tag("property", "og:image:width", "1200"),
    tag("property", "og:image:height", "630"),
    tag("property", "og:image:alt", "Dhikr Hub Live"),
    tag("name", "twitter:card", "summary_large_image"),
    tag("name", "twitter:title", title),
    tag("name", "twitter:description", description),
    tag("name", "twitter:image", image),
  ].join("");

  const rewritten = new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(title);
      },
    })
    .on("meta", {
      element(el) {
        const key = el.getAttribute("property") ?? el.getAttribute("name");
        if (key === "description") el.replace(tag("name", "description", description), { html: true });
        else if (key && REPLACED_META.has(key)) el.remove();
      },
    })
    .on("head", {
      element(el) {
        el.append(tags, { html: true });
      },
    })
    .transform(response);
  const headers = new Headers(rewritten.headers);
  headers.delete("ETag");
  headers.delete("Content-Length");
  return new Response(rewritten.body, { status: rewritten.status, headers });
}
