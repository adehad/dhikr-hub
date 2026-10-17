export interface QasidaData {
  name: { ara: string; en: string };
  verses: { ara: string[]; en: string[] };
  translation: { en: string[] };
  order: {
    chorus: { repeat: number; index: number }[][];
    verses: { repeat: number; index: number }[][];
  };
}

export interface Ornaments {
  dividers: string[];
  colours: number;
}

export interface Divider {
  shape: string;
  colour: number;
}

export interface RenderOptions {
  ornaments?: Ornaments | null;
  // The animated end-of-verses divider, rendered once by Hugo and moved into
  // place here; its script keeps observing the same element across renders.
  morph?: HTMLElement | null;
}

type Entry = { repeat: number; index: number };

// Mirrors verse.html: every section ends in a divider except the last verse
// section, which ends in the morph. Sections are numbered chorus first.
export function dividerFor(n: number, chorusCount: number, verseCount: number, orn: Ornaments): Divider | null {
  const dividerCount = chorusCount + verseCount - 1;
  if (n >= dividerCount || orn.dividers.length === 0) return null;
  return {
    shape: orn.dividers[n % orn.dividers.length]!,
    colour: (n % orn.colours) + 1,
  };
}

// A stanza whose lines all share one repeat count carries a single mark on
// its heading; otherwise each line carries its own.
export function stanzaRepeat(entries: Entry[]): number {
  const first = entries[0]?.repeat ?? 1;
  return entries.every((e) => e.repeat === first) ? first : 1;
}

export function repeatTimes(n: number): string {
  return n === 2 ? "twice" : `${n} times`;
}

function repeatMark(doc: Document, repeat: number, extraClass?: string): HTMLSpanElement {
  const span = doc.createElement("span");
  span.className = extraClass ? `repeat-mark ${extraClass}` : "repeat-mark";
  span.dir = "ltr";
  span.setAttribute("aria-hidden", "true");
  span.textContent = `×${repeat}`;
  return span;
}

function srText(doc: Document, text: string): HTMLSpanElement {
  const span = doc.createElement("span");
  span.className = "sr-only repeat-sr";
  span.textContent = text;
  return span;
}

function buildDivider(doc: Document, divider: Divider): HTMLElement {
  const box = doc.createElement("div");
  box.className = `ornament-divider ornament-c${divider.colour}`;
  box.setAttribute("role", "separator");
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = doc.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#ornament-${divider.shape}`);
  svg.appendChild(use);
  box.appendChild(svg);
  return box;
}

function chorusLiveIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const attrs: Record<string, string> = {
    class: "live-icon live-chorus-live",
    "aria-hidden": "true",
    focusable: "false",
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  };
  for (const [name, value] of Object.entries(attrs)) svg.setAttribute(name, value);
  const use = doc.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#li-repeat");
  svg.appendChild(use);
  return svg;
}

function srSpan(doc: Document, className: string, text: string): HTMLSpanElement {
  const span = doc.createElement("span");
  span.className = `sr-only ${className}`;
  span.textContent = text;
  return span;
}

function buildGroup(
  doc: Document,
  data: QasidaData,
  section: "chorus" | "verses",
  groupIdx: number,
  entries: Entry[],
  divider: Divider | null,
): HTMLElement {
  const container = doc.createElement("div");
  container.className = "verse-container";
  container.dataset.section = section;
  container.dataset.group = String(groupIdx);

  const heading = doc.createElement("h2");
  const label = section === "chorus" ? `Chorus ${groupIdx + 1}` : String(groupIdx + 1);
  const stanza = stanzaRepeat(entries);
  if (stanza > 1) {
    if (section === "verses") heading.appendChild(srText(doc, "Verse "));
    heading.appendChild(doc.createTextNode(label));
    heading.appendChild(repeatMark(doc, stanza));
    heading.appendChild(srText(doc, `, sung ${repeatTimes(stanza)}`));
  } else {
    heading.textContent = label;
  }
  container.appendChild(heading);

  const spacer = doc.createElement("p");
  spacer.style.flexBasis = "100%";
  spacer.style.margin = "0";
  container.appendChild(spacer);

  for (const entry of entries) {
    const lineRepeat = stanza > 1 ? 1 : entry.repeat;
    const verse = doc.createElement("div");
    verse.className = "verse";
    const layers: [string, string, string | undefined][] = [
      ["arabic", data.verses.ara[entry.index] ?? "", undefined],
      ["transliteration", data.verses.en[entry.index] ?? "", "repeat-mark-fallback-transliteration"],
      ["translation", data.translation.en[entry.index] ?? "", "repeat-mark-fallback-translation"],
    ];
    for (const [cls, text, fallback] of layers) {
      const div = doc.createElement("div");
      div.className = cls;
      div.textContent = text;
      if (lineRepeat > 1) {
        div.appendChild(doc.createTextNode(" "));
        div.appendChild(repeatMark(doc, lineRepeat, fallback));
      }
      verse.appendChild(div);
    }
    if (lineRepeat > 1) verse.appendChild(srText(doc, `Sung ${repeatTimes(lineRepeat)}`));
    container.appendChild(verse);
  }

  if (divider) {
    container.appendChild(buildDivider(doc, divider));
  } else {
    const rule = doc.createElement("div");
    rule.style.flexBasis = "100%";
    container.appendChild(rule);
  }
  return container;
}

function isRenderable(data: QasidaData): boolean {
  const d = data as Partial<QasidaData> | null;
  return (
    !!d &&
    !!d.verses &&
    Array.isArray(d.verses.ara) &&
    Array.isArray(d.verses.en) &&
    Array.isArray(d.translation?.en) &&
    Array.isArray(d.order?.chorus) &&
    Array.isArray(d.order?.verses) &&
    [...d.order.chorus, ...d.order.verses].every(
      (group) => Array.isArray(group) && group.every((e) => Number.isInteger(e?.index)),
    )
  );
}

export function renderQasida(
  doc: Document,
  target: HTMLElement,
  data: QasidaData,
  opts: RenderOptions = {},
): void {
  target.replaceChildren();
  if (!isRenderable(data)) {
    const p = doc.createElement("p");
    p.className = "live-render-error";
    p.textContent = "Could not display this qasida (malformed data).";
    target.appendChild(p);
    return;
  }

  const orn = opts.ornaments ?? null;
  const chorusCount = data.order.chorus.length;
  const verseCount = data.order.verses.length;
  const divider = (n: number): Divider | null =>
    orn ? dividerFor(n, chorusCount, verseCount, orn) : null;

  if (chorusCount > 0) {
    const toggle = doc.createElement("input");
    toggle.type = "checkbox";
    toggle.id = "chorus-toggle";
    // The tab markup follows the verse.html shortcode, plus the repeat icon
    // shown while the host has the chorus on.
    const label = doc.createElement("label");
    label.htmlFor = "chorus-toggle";
    label.append(
      chorusLiveIcon(doc),
      srSpan(doc, "chorus-tab-show", "Show "),
      srSpan(doc, "chorus-tab-hide", "Hide "),
      "Chorus",
    );
    const sticky = doc.createElement("div");
    sticky.className = "sticky-chorus";
    data.order.chorus.forEach((entries, i) => {
      sticky.appendChild(buildGroup(doc, data, "chorus", i, entries, divider(i)));
    });
    target.append(toggle, label, sticky);
  }

  data.order.verses.forEach((entries, i) => {
    target.appendChild(buildGroup(doc, data, "verses", i, entries, divider(chorusCount + i)));
  });

  if (opts.morph && verseCount > 0) target.appendChild(opts.morph);

  // menu-before.html applies saved display settings only on window load;
  // re-run them so freshly rendered nodes respect them.
  const view = doc.defaultView as (Window & { UpdateLayoutBasedOnUserSettings?: () => void }) | null;
  view?.UpdateLayoutBasedOnUserSettings?.();
}
