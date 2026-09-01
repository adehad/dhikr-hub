import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import {
  currentAfterMove,
  currentAfterRemove,
  filterIndex,
  moveItem,
  SetlistEditor,
  type QasidaIndexEntry,
} from "../setlist-editor";

const INDEX: QasidaIndexEntry[] = [
  { slug: "a", title: "Alpha - First", titleAra: "ألف", url: "/a/", maqam: [] },
  { slug: "b", title: "Beta - Second", titleAra: "باء", url: "/b/", maqam: [] },
  { slug: "c", title: "Gamma - Third", titleAra: "جيم", url: "/c/", maqam: [] },
];

describe("moveItem", () => {
  it("moves an item down and up", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
  });

  it("ignores out-of-range moves", () => {
    expect(moveItem(["a", "b"], 1, 2)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});

describe("current index after edits", () => {
  it("follows the live row when it moves", () => {
    expect(currentAfterMove(1, 1, 2)).toBe(2);
    expect(currentAfterMove(0, 0, 1)).toBe(1);
  });

  it("shifts when another row crosses the live row", () => {
    expect(currentAfterMove(2, 0, 2)).toBe(1);
    expect(currentAfterMove(0, 2, 0)).toBe(1);
    expect(currentAfterMove(0, 1, 2)).toBe(0);
  });

  it("drops when the live row is removed, shifts when an earlier row is", () => {
    expect(currentAfterRemove(1, 1)).toBeNull();
    expect(currentAfterRemove(2, 0)).toBe(1);
    expect(currentAfterRemove(0, 2)).toBe(0);
    expect(currentAfterRemove(null, 0)).toBeNull();
  });
});

describe("filterIndex", () => {
  it("matches latin without diacritics and arabic titles", () => {
    expect(filterIndex(INDEX, "alp").map((q) => q.slug)).toEqual(["a"]);
    expect(filterIndex(INDEX, "باء").map((q) => q.slug)).toEqual(["b"]);
    expect(filterIndex(INDEX, "")).toHaveLength(3);
  });
});

function setup(opts: Partial<ConstructorParameters<typeof SetlistEditor>[3]> = {}) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  const onChange = vi.fn();
  const onPlay = vi.fn();
  const editor = new SetlistEditor(doc, root, INDEX, {
    items: ["a", "b", "c"],
    editable: true,
    current: 1,
    onChange,
    onPlay,
    ...opts,
  });
  return { root, editor, onChange, onPlay };
}

describe("SetlistEditor", () => {
  it("renders one row per item with the live marker on the current row", () => {
    const { root } = setup();
    const rows = root.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);
    expect(rows[1]!.getAttribute("aria-current")).toBe("true");
    const rec = rows[1]!.querySelector(".live-td-num .live-rec")!;
    expect(rec.getAttribute("aria-label")).toBe("Live now");
    expect(rec.querySelector("use")!.getAttribute("href")).toBe("#ornament-rub_lotus");
    expect(rows[1]!.querySelector(".live-td-num")!.textContent).toBe("");
    expect(rows[0]!.querySelector(".live-td-num")!.textContent).toBe("1");
  });

  it("hides Arabic titles until toggled, and remembers the choice", () => {
    const window = new Window();
    const storage = window.localStorage as unknown as Storage;
    const { root } = setup({ storage });
    expect(root.querySelector("tbody .live-setlist-ara")).toBeNull();
    const toggle = root.querySelector<HTMLButtonElement>("thead .live-btn-ara")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Show Arabic titles");
    toggle.click();
    expect(root.querySelectorAll("tbody .live-setlist-ara")).toHaveLength(3);
    expect(root.querySelector("thead .live-btn-ara")!.getAttribute("aria-pressed")).toBe("true");
    expect(storage.getItem("dhikr-hub-live-arabic-titles")).toBe("1");

    const again = setup({ storage });
    expect(again.root.querySelectorAll("tbody .live-setlist-ara")).toHaveLength(3);
  });

  it("offers move up, move down and remove with accessible names", () => {
    const { root } = setup();
    const labels = [...root.querySelectorAll("tbody tr:nth-child(2) button")].map((b) =>
      b.getAttribute("aria-label"),
    );
    const updown = [...root.querySelectorAll("tbody tr:nth-child(2) .live-updown button")].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(updown).toEqual(["Move Beta up", "Move Beta down"]);
    // The live row has no "go to" since it is already playing.
    expect(labels).toEqual(["Move Beta up", "Move Beta down", "Remove Beta"]);
    expect(root.querySelector('.live-track-btn[aria-label="Go to Gamma"]')).toBeTruthy();
    expect(root.querySelector('tbody tr:nth-child(2) .live-track-btn')).toBeNull();
    const first = root.querySelector<HTMLButtonElement>('button[aria-label="Move Alpha up"]')!;
    expect(first.disabled).toBe(true);
    const last = root.querySelector<HTMLButtonElement>('button[aria-label="Move Gamma down"]')!;
    expect(last.disabled).toBe(true);
  });

  it("move down reports the new order and the live row's new index", () => {
    const { root, onChange } = setup();
    root.querySelector<HTMLButtonElement>('button[aria-label="Move Alpha down"]')!.click();
    expect(onChange).toHaveBeenCalledWith(["b", "a", "c"], 0);
  });

  it("remove of the live row reports null", () => {
    const { root, onChange } = setup();
    root.querySelector<HTMLButtonElement>('button[aria-label="Remove Beta"]')!.click();
    expect(onChange).toHaveBeenCalledWith(["a", "c"], null);
  });

  it("adding from the picker appends and keeps the live index", () => {
    const { root, onChange } = setup();
    root.querySelector<HTMLButtonElement>('button[aria-label="Add Gamma"]')!.click();
    expect(onChange).toHaveBeenCalledWith(["a", "b", "c", "c"], 1);
  });

  it("read-only mode shows no edit controls or picker, only the Arabic toggle", () => {
    const { root } = setup({ editable: false });
    const buttons = root.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.classList.contains("live-btn-ara")).toBe(true);
    expect(root.querySelector(".live-track-btn")).toBeNull();
    expect(root.querySelector(".live-picker")).toBeNull();
    expect(root.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("play on a non-live row calls onPlay with its index", () => {
    const { root, onPlay } = setup();
    root.querySelector<HTMLButtonElement>('.live-track-btn[aria-label="Go to Gamma"]')!.click();
    expect(onPlay).toHaveBeenCalledWith(2);
  });
});
