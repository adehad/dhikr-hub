import { describe, expect, it, vi } from "vitest";
import { Window as HappyWindow } from "happy-dom";
import {
  debounce,
  pickCurrentGroup,
  groupElements,
  HostTracker,
  FollowerScroller,
  jumpDirection,
} from "../sync";
import type { VersePosition } from "../messages";

describe("debounce", () => {
  it("collapses rapid calls and fires trailing with last args", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d(1);
    d(2);
    d(3);
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(3);
    vi.useRealTimers();
  });

  it("cancel() suppresses a pending trailing call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d(1);
    d.cancel();
    vi.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("pickCurrentGroup", () => {
  const groups = [
    { section: "chorus" as const, group: 0 },
    { section: "verses" as const, group: 0 },
    { section: "verses" as const, group: 1 },
  ];

  it("picks the last group at or above the reading line", () => {
    // distance = signed px from the reading line to the group top (negative = above)
    const picked = pickCurrentGroup(groups, [-400, -20, 500]);
    expect(picked).toEqual({ section: "verses", group: 0 });
  });

  it("falls back to the first group when none is above the line", () => {
    const picked = pickCurrentGroup(groups, [120, 480, 900]);
    expect(picked).toEqual({ section: "chorus", group: 0 });
  });

  it("returns null for empty input", () => {
    expect(pickCurrentGroup([], [])).toBeNull();
  });
});

type HappyDocument = InstanceType<typeof HappyWindow>["document"];
type HappyElement = ReturnType<HappyDocument["createElement"]>;

function addGroup(doc: HappyDocument, parent: HappyElement, section: string, group: number): HappyElement {
  const el = doc.createElement("div");
  el.className = "verse-container";
  el.dataset.section = section;
  el.dataset.group = String(group);
  parent.appendChild(el);
  return el;
}

describe("groupElements", () => {
  it("collects section/group positions in document order", () => {
    const window = new HappyWindow();
    const doc = window.document;
    const root = doc.createElement("div");
    doc.body.appendChild(root);
    addGroup(doc, root, "chorus", 0);
    addGroup(doc, root, "verses", 0);
    addGroup(doc, root, "verses", 1);

    const items = groupElements(root as unknown as HTMLElement);
    expect(items.map((i) => i.pos)).toEqual([
      { section: "chorus", group: 0 },
      { section: "verses", group: 0 },
      { section: "verses", group: 1 },
    ]);
  });

  it("returns [] for a root with no verse containers", () => {
    const window = new HappyWindow();
    const root = window.document.createElement("div");
    expect(groupElements(root as unknown as HTMLElement)).toEqual([]);
  });

  it("excludes .sticky-chorus copies only when #chorus-toggle is checked", () => {
    const window = new HappyWindow();
    const doc = window.document;
    const root = doc.createElement("div");
    doc.body.appendChild(root);

    const toggle = doc.createElement("input");
    toggle.type = "checkbox";
    toggle.id = "chorus-toggle";
    root.appendChild(toggle);

    const sticky = doc.createElement("div");
    sticky.className = "sticky-chorus";
    root.appendChild(sticky);
    addGroup(doc, sticky, "chorus", 0);
    addGroup(doc, root, "verses", 0);

    const unchecked = groupElements(root as unknown as HTMLElement);
    expect(unchecked.map((i) => i.pos)).toEqual([
      { section: "chorus", group: 0 },
      { section: "verses", group: 0 },
    ]);

    toggle.checked = true;
    const checked = groupElements(root as unknown as HTMLElement);
    expect(checked.map((i) => i.pos)).toEqual([{ section: "verses", group: 0 }]);
  });
});

function asView(window: HappyWindow): Window & typeof globalThis {
  return window as unknown as Window & typeof globalThis;
}

describe("HostTracker", () => {
  function setupRoot() {
    const window = new HappyWindow();
    const doc = window.document;
    const root = doc.createElement("div");
    doc.body.appendChild(root);
    addGroup(doc, root, "verses", 0);
    return { window, root: root as unknown as HTMLElement };
  }

  it("emitNow dedupes repeats and only commits lastSent when send succeeds", () => {
    const { window, root } = setupRoot();
    const sender = { fn: vi.fn((_pos: VersePosition) => false) };
    const tracker = new HostTracker(root, (pos) => sender.fn(pos), asView(window));

    tracker.emitNow();
    expect(sender.fn).toHaveBeenCalledTimes(1);

    // send failed, so lastSent was never committed: the retry fires again.
    tracker.emitNow();
    expect(sender.fn).toHaveBeenCalledTimes(2);

    sender.fn = vi.fn(() => true);
    tracker.emitNow();
    expect(sender.fn).toHaveBeenCalledTimes(1);

    // now committed: an identical position is deduped and not resent.
    tracker.emitNow();
    expect(sender.fn).toHaveBeenCalledTimes(1);

    tracker.destroy();
  });

  it("reset() clears the dedupe so the same position is resent", () => {
    const { window, root } = setupRoot();
    const send = vi.fn(() => true);
    const tracker = new HostTracker(root, send, asView(window));

    tracker.emitNow();
    expect(send).toHaveBeenCalledTimes(1);
    tracker.reset();
    tracker.emitNow();
    expect(send).toHaveBeenCalledTimes(2);

    tracker.destroy();
  });
});

describe("FollowerScroller", () => {
  function setupDom() {
    const window = new HappyWindow();
    const doc = window.document;
    const header = doc.createElement("div");
    header.className = "book-header";
    doc.body.appendChild(header);
    const root = doc.createElement("div");
    doc.body.appendChild(root);
    const groupA = addGroup(doc, root, "verses", 0);
    const groupB = addGroup(doc, root, "verses", 1);
    return { window, root: root as unknown as HTMLElement, groupA, groupB };
  }

  it("apply() stores the position while detached and does not scroll; jumpToHost re-attaches and scrolls to it", () => {
    const { window, root } = setupDom();
    const view = asView(window);
    const scrollToSpy = vi.fn();
    view.scrollTo = scrollToSpy as unknown as typeof view.scrollTo;

    const detachChanges: boolean[] = [];
    const scroller = new FollowerScroller(root, (d) => detachChanges.push(d), view);

    window.dispatchEvent(new window.Event("wheel"));
    expect(scroller.isDetached()).toBe(true);
    expect(detachChanges).toEqual([true]);

    scroller.apply({ section: "verses", group: 0 });
    expect(scrollToSpy).not.toHaveBeenCalled();

    scroller.jumpToHost();
    expect(scroller.isDetached()).toBe(false);
    expect(detachChanges).toEqual([true, false]);
    expect(scrollToSpy).toHaveBeenCalledTimes(1);

    scroller.destroy();
  });

  it("reattach() clears detachment and forgets the previous qasida's position", () => {
    const { window, root } = setupDom();
    const view = asView(window);
    const scrollToSpy = vi.fn();
    view.scrollTo = scrollToSpy as unknown as typeof view.scrollTo;
    const detachChanges: boolean[] = [];
    const scroller = new FollowerScroller(root, (d) => detachChanges.push(d), view);

    window.dispatchEvent(new window.Event("wheel"));
    scroller.apply({ section: "verses", group: 0 });
    scroller.reattach();
    expect(scroller.isDetached()).toBe(false);
    expect(detachChanges).toEqual([true, false]);
    expect(scrollToSpy).not.toHaveBeenCalled();

    // The stale position is gone: jumpToHost goes to the start of the new
    // qasida, where the host's navigate left them.
    scroller.jumpToHost();
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    scroller.destroy();
  });

  it("jumpTo() re-attaches and scrolls to the given position, not lastPosition", () => {
    const { window, root, groupB } = setupDom();
    (groupB as unknown as { getBoundingClientRect(): Partial<DOMRect> }).getBoundingClientRect =
      () => ({ top: 500, bottom: 550, height: 50 });
    const view = asView(window);
    const scrollToSpy = vi.fn();
    view.scrollTo = scrollToSpy as unknown as typeof view.scrollTo;

    const scroller = new FollowerScroller(root, () => {}, view);

    window.dispatchEvent(new window.Event("wheel"));
    expect(scroller.isDetached()).toBe(true);

    // apply() while detached records lastPosition = group 0 without scrolling.
    scroller.apply({ section: "verses", group: 0 });
    expect(scrollToSpy).not.toHaveBeenCalled();

    scroller.jumpTo({ section: "verses", group: 1 });
    expect(scroller.isDetached()).toBe(false);
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    // groupB.top (500) minus the 16px gap; nothing is stuck above it.
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 484, behavior: "smooth" });

    scroller.destroy();
  });

  it("does not scroll to a chorus group pinned by a checked #chorus-toggle", () => {
    const { window, root } = setupDom();
    const doc = window.document;
    const toggle = doc.createElement("input");
    toggle.type = "checkbox";
    toggle.id = "chorus-toggle";
    toggle.checked = true;
    const sticky = doc.createElement("div");
    sticky.className = "sticky-chorus";
    (root as unknown as HappyElement).prepend(toggle, sticky);
    addGroup(doc, sticky, "chorus", 0);
    const view = asView(window);
    const scrollToSpy = vi.fn();
    view.scrollTo = scrollToSpy as unknown as typeof view.scrollTo;

    const scroller = new FollowerScroller(root, () => {}, view);
    scroller.apply({ section: "chorus", group: 0 });
    scroller.jumpTo({ section: "chorus", group: 0 });
    expect(scrollToSpy).not.toHaveBeenCalled();

    toggle.checked = false;
    scroller.jumpTo({ section: "chorus", group: 0 });
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    scroller.destroy();
  });

  it("scrollTo lands below the deepest currently-stuck occluding element", () => {
    const { window, root, groupA } = setupDom();
    const doc = window.document;

    const liveApp = doc.createElement("div");
    liveApp.id = "live-app";
    doc.body.appendChild(liveApp);
    const nowStrip = doc.createElement("div");
    nowStrip.className = "live-now";
    liveApp.appendChild(nowStrip);
    const verses = doc.createElement("div");
    verses.id = "live-verses";
    liveApp.appendChild(verses);
    const chorusLabel = doc.createElement("label");
    chorusLabel.setAttribute("for", "chorus-toggle");
    verses.appendChild(chorusLabel);

    // Stub layout explicitly rather than relying on happy-dom's (real) zeroed
    // layout engine: the now strip stuck 0-60, the chorus toggle deeper at 60-112.
    function stubRect(el: HTMLElement, top: number, bottom: number): void {
      (el as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect = () =>
        ({
          top,
          bottom,
          height: bottom - top,
          left: 0,
          right: 0,
          width: 0,
          x: 0,
          y: top,
          toJSON() {},
        }) as unknown as DOMRect;
    }
    stubRect(nowStrip as unknown as HTMLElement, 0, 60);
    stubRect(chorusLabel as unknown as HTMLElement, 60, 112);
    stubRect(groupA as unknown as HTMLElement, 300, 350);

    const view = asView(window);
    const scrollToSpy = vi.fn();
    view.scrollTo = scrollToSpy as unknown as typeof view.scrollTo;

    const scroller = new FollowerScroller(root, () => {}, view);
    scroller.jumpTo({ section: "verses", group: 0 });

    // offset = deepest stuck bottom (112, the chorus toggle) + 16 = 128
    // top = groupA.top (300) + scrollY (0) - 128
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 172, behavior: "smooth" });

    scroller.destroy();
  });

  it("a keydown on a focused button does not detach (Space activates buttons, not scroll)", () => {
    const { window, root } = setupDom();
    const doc = window.document;
    const button = doc.createElement("button");
    doc.body.appendChild(button);

    const detachChanges: boolean[] = [];
    const scroller = new FollowerScroller(root, (d) => detachChanges.push(d), asView(window));

    const event = new window.KeyboardEvent("keydown", { key: " " });
    Object.defineProperty(event, "target", { value: button, configurable: true });
    window.dispatchEvent(event);

    expect(scroller.isDetached()).toBe(false);
    expect(detachChanges).toEqual([]);

    scroller.destroy();
  });

  it("a scroll key on a non-interactive target does detach", () => {
    const { window, root } = setupDom();
    const scroller = new FollowerScroller(root, () => {}, asView(window));

    const event = new window.KeyboardEvent("keydown", { key: "PageDown" });
    Object.defineProperty(event, "target", { value: window.document.body, configurable: true });
    window.dispatchEvent(event);

    expect(scroller.isDetached()).toBe(true);
    scroller.destroy();
  });

});

describe("jumpDirection", () => {
  const order: VersePosition[] = [
    { section: "chorus", group: 0 },
    { section: "verses", group: 0 },
    { section: "verses", group: 1 },
    { section: "verses", group: 2 },
  ];

  it("points up when the host is earlier in the document", () => {
    expect(jumpDirection(order, { section: "verses", group: 0 }, { section: "verses", group: 2 })).toBe("up");
    expect(jumpDirection(order, { section: "chorus", group: 0 }, { section: "verses", group: 1 })).toBe("up");
  });

  it("points down when the host is later or at the same group", () => {
    expect(jumpDirection(order, { section: "verses", group: 2 }, { section: "verses", group: 0 })).toBe("down");
    expect(jumpDirection(order, { section: "verses", group: 1 }, { section: "verses", group: 1 })).toBe("down");
  });

  it("points down when either position is unknown", () => {
    expect(jumpDirection(order, { section: "verses", group: 0 }, null)).toBe("down");
    expect(jumpDirection(order, { section: "verses", group: 9 }, { section: "verses", group: 2 })).toBe("down");
  });
});
