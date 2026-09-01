import { describe, expect, it } from "vitest";
import { coalesceJoin, joinMessage } from "../join-flash";

describe("coalesceJoin", () => {
  it("starts a flash at one on the first join", () => {
    expect(coalesceJoin(null, 1000)).toEqual({ count: 1, shownAt: 1000 });
  });

  it("adds a join within the window to the current flash", () => {
    const first = coalesceJoin(null, 1000);
    expect(coalesceJoin(first, 1500)).toEqual({ count: 2, shownAt: 1000 });
  });

  it("starts a new flash for a join after the window", () => {
    const first = coalesceJoin(null, 1000);
    expect(coalesceJoin(first, 3000)).toEqual({ count: 1, shownAt: 3000 });
  });
});

describe("joinMessage", () => {
  it("uses the singular for one person", () => {
    expect(joinMessage(1)).toBe("1 person joined");
  });

  it("uses the plural for several", () => {
    expect(joinMessage(3)).toBe("3 people joined");
  });
});
