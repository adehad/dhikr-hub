import type { VersePosition } from "./messages";

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: number | undefined;
  const wrapped = ((...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms) as unknown as number;
  }) as Debounced<A>;
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

// The reading line sits at 1/3 of the viewport. The current group is the last
// one whose top has crossed the line; before any group crosses it, the first.
export function pickCurrentGroup(
  groups: VersePosition[],
  distances: number[],
): VersePosition | null {
  if (groups.length === 0) return null;
  let current: VersePosition | null = null;
  for (let i = 0; i < groups.length; i++) {
    if ((distances[i] ?? Infinity) <= 0) current = groups[i] ?? null;
  }
  return current ?? groups[0] ?? null;
}

// Which way the follower must scroll to reach the host. Groups missing from
// the order (a pinned chorus, a stale position) read as "down".
export function jumpDirection(
  order: VersePosition[],
  host: VersePosition,
  follower: VersePosition | null,
): "up" | "down" {
  if (!follower) return "down";
  const at = (p: VersePosition): number =>
    order.findIndex((o) => o.section === p.section && o.group === p.group);
  const h = at(host);
  const f = at(follower);
  return h !== -1 && f !== -1 && h < f ? "up" : "down";
}

export function groupElements(root: HTMLElement): { el: HTMLElement; pos: VersePosition }[] {
  const toggle = root.querySelector<HTMLInputElement>("#chorus-toggle");
  const chorusPinned = toggle?.checked === true;
  return [...root.querySelectorAll<HTMLElement>(".verse-container[data-section][data-group]")]
    // A checked #chorus-toggle pins .sticky-chorus near the top, so chorus
    // groups stop being scroll positions at all: excluded entirely while
    // pinned (a pinned chorus is an overlay, not a place in the document).
    .filter((el) => !(chorusPinned && el.closest(".sticky-chorus")))
    .map((el) => ({
      el,
      pos: {
        section: el.dataset.section as VersePosition["section"],
        group: Number(el.dataset.group),
      },
    }));
}

const REFLOW_EVENTS = ["scroll", "resize", "orientationchange"] as const;

export class HostTracker {
  private lastSent: string | null = null;
  private emit: Debounced<[]>;

  constructor(
    private root: HTMLElement,
    private send: (pos: VersePosition) => boolean,
    private view: Window & typeof globalThis = window,
  ) {
    this.emit = debounce(() => this.emitNow(), 300);
    for (const type of REFLOW_EVENTS) {
      this.view.addEventListener(type, this.emit, { passive: true });
    }
  }

  // Bypasses the debounce; call after a reconnect so a position dropped while
  // offline is re-sent even though the host has stopped scrolling.
  emitNow(): void {
    if (!this.root.isConnected) return;
    const items = groupElements(this.root);
    const line = this.view.innerHeight / 3;
    const pos = pickCurrentGroup(
      items.map((i) => i.pos),
      items.map((i) => i.el.getBoundingClientRect().top - line),
    );
    if (!pos) return;
    const key = `${pos.section}:${pos.group}`;
    if (key !== this.lastSent && this.send(pos)) {
      this.lastSent = key;
    }
  }

  // Clear the dedupe after navigating to a new qasida: its verses:0 must not
  // be deduped against the previous qasida's verses:0.
  reset(): void {
    this.lastSent = null;
  }

  destroy(): void {
    this.emit.cancel();
    for (const type of REFLOW_EVENTS) {
      this.view.removeEventListener(type, this.emit);
    }
  }
}

const SCROLL_KEYS = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];

export class FollowerScroller {
  private detached = false;
  private lastPosition: VersePosition | null = null;
  private userIntent: () => void;

  constructor(
    private root: HTMLElement,
    private onDetachChange: (detached: boolean) => void,
    private view: Window & typeof globalThis = window,
  ) {
    // Programmatic smooth scrolls also fire scroll events; only direct input
    // (wheel, touch, scroll keys) marks the follower as detached.
    // Scrollbar drags and find-in-page scroll without any of these events;
    // those cases do not detach (accepted limitation).
    this.userIntent = () => this.setDetached(true);
    for (const type of ["wheel", "touchmove"] as const) {
      this.view.addEventListener(type, this.userIntent, { passive: true });
    }
    this.view.addEventListener("keydown", this.keyHandler);
  }

  private keyHandler = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      target !== this.view.document.body &&
      target.closest("input, textarea, select, button, a[href], summary, [contenteditable]")
    ) {
      return;
    }
    if (SCROLL_KEYS.includes(event.key)) this.setDetached(true);
  };

  private setDetached(detached: boolean): void {
    if (this.detached === detached) return;
    this.detached = detached;
    this.onDetachChange(detached);
  }

  isDetached(): boolean {
    return this.detached;
  }

  apply(pos: VersePosition): void {
    this.lastPosition = pos;
    if (this.detached) return;
    this.scrollTo(pos);
  }

  // With no position yet for the host's current qasida, the host is at its
  // start: a navigate resets the host's view to the top.
  jumpToHost(): void {
    this.setDetached(false);
    const target = this.lastPosition ?? groupElements(this.root)[0]?.pos;
    if (target) this.scrollTo(target);
  }

  // A new qasida from the host supersedes any local scrolling: re-attach and
  // forget the previous qasida's position without scrolling its stale DOM.
  reattach(): void {
    this.lastPosition = null;
    this.setDetached(false);
  }

  // Like jumpToHost, but scrolls to an explicit position rather than the last
  // one recorded (e.g. a chorus tap, which is not the host's tracked position).
  jumpTo(pos: VersePosition): void {
    this.lastPosition = pos;
    this.setDetached(false);
    this.scrollTo(pos);
  }

  private occlusionOffset(): number {
    const doc = this.view.document;
    const candidates = doc.querySelectorAll<HTMLElement>(
      ".book-header, #live-app .live-now, #live-app .live-hostbar, #live-verses label[for='chorus-toggle'], .sticky-chorus",
    );
    let bottom = 0;
    for (const el of candidates) {
      if (el.hidden) continue;
      const rect = el.getBoundingClientRect();
      // Only elements currently stuck near the viewport top occlude the target.
      if (rect.height > 0 && rect.top >= 0 && rect.top < 140 && rect.bottom > bottom) {
        bottom = rect.bottom;
      }
    }
    return bottom + 16;
  }

  private scrollTo(pos: VersePosition): void {
    const el = groupElements(this.root).find(
      (g) => g.pos.section === pos.section && g.pos.group === pos.group,
    )?.el;
    if (!el) return;
    const offset = this.occlusionOffset();
    const top = el.getBoundingClientRect().top + this.view.scrollY - offset;
    this.view.scrollTo({ top, behavior: "smooth" });
  }

  destroy(): void {
    for (const type of ["wheel", "touchmove"] as const) {
      this.view.removeEventListener(type, this.userIntent);
    }
    this.view.removeEventListener("keydown", this.keyHandler);
  }
}
