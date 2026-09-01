export interface Setlist {
  id: string;
  name: string;
  items: string[]; // json_file slugs
  updatedAt: string; // ISO
}

export interface VersePosition {
  section: "chorus" | "verses";
  group: number; // index into order.chorus / order.verses
}

export interface PeerInfo {
  publicId: string;
  name: string;
  isHost: boolean;
}

// client -> server
export type ClientMessage =
  | { type: "hello"; id: string; name: string } // id = full secret identity
  | { type: "position"; position: VersePosition }
  | { type: "navigate"; slug: string; index?: number } // index = position in the setlist
  | { type: "chorus"; on?: boolean } // absent = on (pre-toggle clients)
  | { type: "follow-me" }
  | { type: "promote"; target: string } // target = publicId
  | { type: "setlist"; setlist: Setlist }
  | { type: "end-event" };

// server -> client
export type ServerMessage =
  | {
      type: "snapshot";
      you: string; // your publicId
      leader: string;
      hosts: string[];
      roster: PeerInfo[];
      currentSlug: string | null;
      currentIndex?: number | null;
      position: VersePosition | null;
      setlist: Setlist | null;
      chorus?: boolean;
      roomName?: string;
    }
  | { type: "peer-joined"; peer: PeerInfo }
  | { type: "peer-left"; publicId: string }
  | { type: "hosts"; hosts: string[]; leader: string }
  | { type: "position"; from: string; position: VersePosition }
  | { type: "navigate"; from: string; slug: string; index?: number }
  | { type: "chorus"; from: string; on: boolean }
  | { type: "setlist"; from: string; setlist: Setlist }
  | { type: "ended" }
  | { type: "error"; code: string; message: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isVersePosition(v: unknown): v is VersePosition {
  if (typeof v !== "object" || v === null) return false;
  const p = v as { section?: unknown; group?: unknown };
  return (
    (p.section === "chorus" || p.section === "verses") &&
    typeof p.group === "number" &&
    Number.isInteger(p.group) &&
    p.group >= 0
  );
}

function isIndex(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 200;
}

function isBoundedString(v: unknown, maxLength: number): v is string {
  return isNonEmptyString(v) && v.length <= maxLength;
}

function isSetlist(v: unknown): v is Setlist {
  if (typeof v !== "object" || v === null) return false;
  const s = v as { id?: unknown; name?: unknown; items?: unknown; updatedAt?: unknown };
  return (
    isBoundedString(s.id, 128) &&
    isBoundedString(s.name, 128) &&
    Array.isArray(s.items) &&
    s.items.length <= 200 &&
    s.items.every((item) => isBoundedString(item, 128)) &&
    isBoundedString(s.updatedAt, 128)
  );
}

// Slugs are qasida data file names: transliterated letters such as "ṭ" and
// "ū", apostrophes, dots and hyphens, but never a path separator.
const SLUG_RE = /^[\p{L}\p{M}\p{N}_.'-]{1,128}$/u;

// Messages arrive from arbitrary WebSocket clients; validate every field that
// reaches room state or a broadcast, and strip anything not in the contract.
export function parseClientMessage(raw: string): ClientMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  switch (m.type) {
    case "hello":
      return isBoundedString(m.id, 256) && isBoundedString(m.name, 256)
        ? { type: "hello", id: m.id, name: m.name }
        : null;
    case "position":
      return isVersePosition(m.position)
        ? { type: "position", position: { section: m.position.section, group: m.position.group } }
        : null;
    case "navigate": {
      if (!isNonEmptyString(m.slug) || !SLUG_RE.test(m.slug)) return null;
      const index = isIndex(m.index) ? m.index : undefined;
      return index === undefined ? { type: "navigate", slug: m.slug } : { type: "navigate", slug: m.slug, index };
    }
    case "chorus":
      return { type: "chorus", on: m.on !== false };
    case "follow-me":
      return { type: "follow-me" };
    case "promote":
      return isNonEmptyString(m.target) ? { type: "promote", target: m.target } : null;
    case "setlist":
      return isSetlist(m.setlist)
        ? {
            type: "setlist",
            setlist: {
              id: m.setlist.id,
              name: m.setlist.name,
              items: [...m.setlist.items],
              updatedAt: m.setlist.updatedAt,
            },
          }
        : null;
    case "end-event":
      return { type: "end-event" };
    default:
      return null;
  }
}
