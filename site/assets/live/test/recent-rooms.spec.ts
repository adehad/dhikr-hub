import { describe, expect, it } from "vitest";
import {
  forgetRoom,
  isRecentRoom,
  parseRoomStatus,
  rememberRoom,
  roomsToFetch,
  timeAgo,
  visibleRooms,
  RECENT_LIMIT,
  RECENT_VISIBLE,
  type RecentRoom,
} from "../recent-rooms";

function room(i: number, name = `Room ${i}`): RecentRoom {
  return { code: `code${String(i).padStart(4, "a")}`, name, lastSeen: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() };
}

function build(n: number): RecentRoom[] {
  let list: RecentRoom[] = [];
  for (let i = 0; i < n; i++) list = rememberRoom(list, room(i));
  return list;
}

describe("recent rooms", () => {
  it("lists newest first", () => {
    expect(build(3).map((r) => r.name)).toEqual(["Room 2", "Room 1", "Room 0"]);
  });

  it("caps at the limit by dropping the oldest", () => {
    const list = build(RECENT_LIMIT + 2);
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]!.name).toBe(`Room ${RECENT_LIMIT + 1}`);
    expect(list.some((r) => r.name === "Room 0" || r.name === "Room 1")).toBe(false);
  });

  it("removes by code", () => {
    const list = forgetRoom(build(3), room(1).code);
    expect(list.map((r) => r.name)).toEqual(["Room 2", "Room 0"]);
  });

  it("a rejoin moves the room to the top and refreshes it", () => {
    const rejoin = { ...room(0, "Renamed"), lastSeen: "2026-05-01T00:00:00.000Z" };
    const list = rememberRoom(build(3), rejoin);
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual(rejoin);
    expect(list.filter((r) => r.code === rejoin.code)).toHaveLength(1);
  });

  it("shows the first few, then all when expanded", () => {
    const list = build(5);
    expect(visibleRooms(list, false)).toEqual(list.slice(0, RECENT_VISIBLE));
    expect(visibleRooms(list, true)).toEqual(list);
  });

  it("fetches status only for visible rows, then the newly visible ones", () => {
    const list = build(5);
    const onLoad = roomsToFetch(list, false);
    expect(onLoad).toEqual(list.slice(0, 3).map((r) => r.code));
    const afterExpand = roomsToFetch(list, true, new Set(onLoad));
    expect(afterExpand).toEqual(list.slice(3).map((r) => r.code));
    expect(roomsToFetch(list, true, new Set([...onLoad, ...afterExpand]))).toEqual([]);
  });

  it("buckets time ago", () => {
    const now = Date.parse("2026-03-10T12:00:00Z");
    const ago = (ms: number) => timeAgo(new Date(now - ms).toISOString(), now);
    expect(ago(30_000)).toBe("just now");
    expect(ago(-5_000)).toBe("just now");
    expect(ago(5 * 60_000)).toBe("5m ago");
    expect(ago(2 * 3_600_000 + 59 * 60_000)).toBe("2h ago");
    expect(ago(3 * 86_400_000)).toBe("3d ago");
    expect(timeAgo("not a date", now)).toBe("");
  });

  it("validates stored entries and status payloads", () => {
    expect(isRecentRoom(room(1))).toBe(true);
    expect(isRecentRoom({ code: "abc", name: "x", lastSeen: "nope" })).toBe(false);
    expect(isRecentRoom({ code: "", name: "x", lastSeen: room(1).lastSeen })).toBe(false);
    expect(parseRoomStatus({ exists: false })).toEqual({ exists: false });
    expect(
      parseRoomStatus({ exists: true, name: "R", people: 2, live: true, lastActive: "2026-01-01T00:00:00Z" }),
    ).toMatchObject({ exists: true, people: 2, live: true });
    expect(parseRoomStatus({ exists: true, name: "R" })).toBeNull();
    expect(parseRoomStatus(null)).toBeNull();
  });
});
