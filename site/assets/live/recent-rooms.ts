import { isNonEmptyString } from "./messages";

export interface RecentRoom {
  code: string;
  name: string;
  lastSeen: string; // ISO
}

export type RoomStatus =
  | { exists: true; name: string; people: number; live: boolean; lastActive: string }
  | { exists: false };

export const RECENT_LIMIT = 10;
export const RECENT_VISIBLE = 3;

export function isRecentRoom(v: unknown): v is RecentRoom {
  if (typeof v !== "object" || v === null) return false;
  const r = v as { code?: unknown; name?: unknown; lastSeen?: unknown };
  return (
    isNonEmptyString(r.code) &&
    typeof r.name === "string" &&
    typeof r.lastSeen === "string" &&
    !Number.isNaN(Date.parse(r.lastSeen))
  );
}

export function parseRoomStatus(v: unknown): RoomStatus | null {
  if (typeof v !== "object" || v === null) return null;
  const s = v as { exists?: unknown; name?: unknown; people?: unknown; live?: unknown; lastActive?: unknown };
  if (s.exists === false) return { exists: false };
  if (
    s.exists !== true ||
    typeof s.name !== "string" ||
    typeof s.people !== "number" ||
    !Number.isFinite(s.people) ||
    typeof s.live !== "boolean" ||
    typeof s.lastActive !== "string"
  ) {
    return null;
  }
  return { exists: true, name: s.name, people: s.people, live: s.live, lastActive: s.lastActive };
}

export function rememberRoom(list: RecentRoom[], room: RecentRoom): RecentRoom[] {
  return [room, ...list.filter((r) => r.code !== room.code)].slice(0, RECENT_LIMIT);
}

export function forgetRoom(list: RecentRoom[], code: string): RecentRoom[] {
  return list.filter((r) => r.code !== code);
}

export function visibleRooms(list: RecentRoom[], expanded: boolean): RecentRoom[] {
  return expanded ? list.slice() : list.slice(0, RECENT_VISIBLE);
}

// Status is fetched only for rows on screen; `fetched` holds codes already requested.
export function roomsToFetch(
  list: RecentRoom[],
  expanded: boolean,
  fetched: ReadonlySet<string> = new Set(),
): string[] {
  return visibleRooms(list, expanded)
    .map((r) => r.code)
    .filter((code) => !fetched.has(code));
}

export function timeAgo(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
