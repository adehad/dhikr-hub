import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../messages";

describe("parseClientMessage hello id cap", () => {
  it("accepts a real 36-char UUID id", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const msg = parseClientMessage(JSON.stringify({ type: "hello", id, name: "Ahmad" }));
    expect(msg).toEqual({ type: "hello", id, name: "Ahmad" });
  });

  it("rejects an id longer than 256 chars", () => {
    const id = "a".repeat(300);
    const msg = parseClientMessage(JSON.stringify({ type: "hello", id, name: "Ahmad" }));
    expect(msg).toBeNull();
  });

  it("accepts an id right at the 256 char cap", () => {
    const id = "a".repeat(256);
    const msg = parseClientMessage(JSON.stringify({ type: "hello", id, name: "Ahmad" }));
    expect(msg).toEqual({ type: "hello", id, name: "Ahmad" });
  });

  it("rejects a name longer than 256 chars and accepts one at the cap", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(parseClientMessage(JSON.stringify({ type: "hello", id, name: "x".repeat(257) }))).toBeNull();
    const name = "x".repeat(256);
    expect(parseClientMessage(JSON.stringify({ type: "hello", id, name }))).toEqual({ type: "hello", id, name });
  });
});

describe("parseClientMessage navigate and chorus", () => {
  it("navigate accepts slugs with apostrophes and transliterated letters", () => {
    for (const slug of ["kun-ma'a-llahi", "tashawwaqat-rūḥī-li-shaṭṭi-al-wādī"]) {
      expect(parseClientMessage(JSON.stringify({ type: "navigate", slug }))).toEqual({
        type: "navigate",
        slug,
      });
    }
  });

  it("navigate rejects a slug that could leave the qasida directory", () => {
    for (const slug of ["../secrets", "a/b", "a b", ""]) {
      expect(parseClientMessage(JSON.stringify({ type: "navigate", slug }))).toBeNull();
    }
  });

  it("navigate carries an optional setlist index and drops a bad one", () => {
    expect(parseClientMessage(JSON.stringify({ type: "navigate", slug: "qamarun", index: 3 }))).toEqual({
      type: "navigate",
      slug: "qamarun",
      index: 3,
    });
    expect(parseClientMessage(JSON.stringify({ type: "navigate", slug: "qamarun" }))).toEqual({
      type: "navigate",
      slug: "qamarun",
    });
    expect(parseClientMessage(JSON.stringify({ type: "navigate", slug: "qamarun", index: -1 }))).toEqual({
      type: "navigate",
      slug: "qamarun",
    });
    expect(parseClientMessage(JSON.stringify({ type: "navigate", slug: "qamarun", index: "2" }))).toEqual({
      type: "navigate",
      slug: "qamarun",
    });
  });

  it("chorus defaults to on for clients that send no flag", () => {
    expect(parseClientMessage(JSON.stringify({ type: "chorus" }))).toEqual({ type: "chorus", on: true });
    expect(parseClientMessage(JSON.stringify({ type: "chorus", on: false }))).toEqual({
      type: "chorus",
      on: false,
    });
  });
});
