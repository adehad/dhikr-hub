import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { dividerFor, renderQasida, repeatTimes, stanzaRepeat, type QasidaData } from "../renderer";

const SAMPLE: QasidaData = {
  name: { ara: "طلع البدر", en: "Talaa - The Moon Rose" },
  verses: { ara: ["ara0", "ara1", "ara2"], en: ["en0", "en1", "en2"] },
  translation: { en: ["tr0", "tr1", "tr2"] },
  order: {
    chorus: [[{ repeat: 1, index: 0 }]],
    verses: [
      [{ repeat: 2, index: 1 }],
      [{ repeat: 1, index: 2 }],
    ],
  },
};

function renderIntoDoc(data: QasidaData) {
  const window = new Window();
  const doc = window.document;
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  renderQasida(doc as unknown as Document, container as unknown as HTMLElement, data);
  return container;
}

describe("renderQasida", () => {
  it("renders chorus toggle and one container per group with data attributes", () => {
    const el = renderIntoDoc(SAMPLE);
    expect(el.querySelector("#chorus-toggle")).toBeTruthy();
    const containers = el.querySelectorAll(".verse-container");
    expect(containers).toHaveLength(3);
    expect(containers[0]!.getAttribute("data-section")).toBe("chorus");
    expect(containers[1]!.getAttribute("data-section")).toBe("verses");
    expect(containers[1]!.getAttribute("data-group")).toBe("0");
    expect(containers[2]!.getAttribute("data-group")).toBe("1");
  });

  it("renders headings and the three line layers", () => {
    const el = renderIntoDoc(SAMPLE);
    // Verse 1 is sung twice in SAMPLE; strip its mark to compare the labels alone.
    const headings = [...el.querySelectorAll("h2")].map((h) => {
      const clone = h.cloneNode(true) as unknown as HTMLElement;
      clone.querySelectorAll(".repeat-mark, .repeat-sr").forEach((n) => n.remove());
      return clone.textContent;
    });
    expect(headings).toEqual(["Chorus 1", "1", "2"]);
    const verse = el.querySelector('[data-section="verses"] .verse')!;
    expect(verse.querySelector(".arabic")!.textContent!.trim()).toBe("ara1");
    expect(verse.querySelector(".transliteration")!.textContent!.trim()).toBe("en1");
    expect(verse.querySelector(".translation")!.textContent!.trim()).toBe("tr1");
  });

  it("omits chorus block when order.chorus is empty", () => {
    const el = renderIntoDoc({ ...SAMPLE, order: { chorus: [], verses: SAMPLE.order.verses } });
    expect(el.querySelector("#chorus-toggle")).toBeNull();
    expect(el.querySelectorAll(".verse-container")).toHaveLength(2);
  });

  it("keeps the toggle-label-sticky sibling chain the chorus CSS depends on", () => {
    const el = renderIntoDoc(SAMPLE);
    expect(
      el.querySelector("#chorus-toggle + label[for='chorus-toggle'] + .sticky-chorus"),
    ).toBeTruthy();
    expect(el.querySelectorAll(".sticky-chorus > .verse-container")).toHaveLength(1);
  });

  it("renders the chorus tab as verse.html does, plus the repeat icon", () => {
    const el = renderIntoDoc(SAMPLE);
    const label = el.querySelector("label[for='chorus-toggle']")!;
    const icons = [...label.querySelectorAll("svg")];
    expect(icons).toHaveLength(1);
    const icon = icons[0]!;
    expect(label.firstElementChild).toBe(icon);
    expect(icon.getAttribute("class")).toBe("live-icon live-chorus-live");
    expect(icon.querySelector("use")!.getAttribute("href")).toBe("#li-repeat");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("fill")).toBe("none");
    expect(icon.getAttribute("stroke")).toBe("currentColor");
    expect(label.querySelector(".sr-only.chorus-tab-show")!.textContent).toBe("Show ");
    expect(label.querySelector(".sr-only.chorus-tab-hide")!.textContent).toBe("Hide ");
    expect(label.textContent).toBe("Show Hide Chorus");
  });

  it("re-runs the settings hook on the rendering document's window", () => {
    const window = new Window();
    const hook = vi.fn();
    (window as unknown as { UpdateLayoutBasedOnUserSettings?: () => void }).UpdateLayoutBasedOnUserSettings = hook;
    const doc = window.document;
    const container = doc.createElement("div");
    doc.body.appendChild(container);
    renderQasida(doc as unknown as Document, container as unknown as HTMLElement, SAMPLE);
    expect(hook).toHaveBeenCalledOnce();
  });

  it("renders every entry in a group and re-render replaces prior content", () => {
    const window = new Window();
    const doc = window.document;
    const container = doc.createElement("div");
    doc.body.appendChild(container);
    const two: QasidaData = {
      ...SAMPLE,
      order: { chorus: [], verses: [[{ repeat: 1, index: 0 }, { repeat: 1, index: 1 }]] },
    };
    renderQasida(doc as unknown as Document, container as unknown as HTMLElement, two);
    expect(container.querySelectorAll(".verse")).toHaveLength(2);
    renderQasida(doc as unknown as Document, container as unknown as HTMLElement, SAMPLE);
    expect(container.querySelectorAll(".verse-container")).toHaveLength(3);
    expect(container.querySelectorAll("#chorus-toggle")).toHaveLength(1);
  });

  it("malformed data renders an error message instead of throwing", () => {
    const el = renderIntoDoc({} as QasidaData);
    expect(el.querySelector(".live-render-error")).toBeTruthy();
  });
});

describe("renderQasida ornaments and repeat marks", () => {
  const ORN = { dividers: ["rub_lotus", "girih_12", "rub_khatam"], colours: 5 };

  function render(data: QasidaData) {
    const window = new Window();
    const doc = window.document;
    const container = doc.createElement("div");
    doc.body.appendChild(container);
    renderQasida(doc as unknown as Document, container as unknown as HTMLElement, data, {
      ornaments: ORN,
    });
    return container;
  }

  it("every section but the last verse section ends in a divider, chorus first", () => {
    const container = render(SAMPLE);
    const dividers = [...container.querySelectorAll(".ornament-divider")];
    // chorus 1 + verses 1 (of 2) = 2 dividers
    expect(dividers).toHaveLength(2);
    expect(dividers[0]!.className).toBe("ornament-divider ornament-c1");
    expect(dividers[0]!.querySelector("use")!.getAttribute("href")).toBe("#ornament-rub_lotus");
    expect(dividers[1]!.className).toBe("ornament-divider ornament-c2");
    expect(dividers[1]!.querySelector("use")!.getAttribute("href")).toBe("#ornament-girih_12");
    expect(
      container.querySelector('[data-section="verses"][data-group="1"] .ornament-divider'),
    ).toBeNull();
  });

  it("shapes wrap around the divider list and colours around the colour count", () => {
    expect(dividerFor(3, 0, 5, ORN)).toEqual({ shape: "rub_lotus", colour: 4 });
    expect(dividerFor(5, 0, 7, ORN)).toEqual({ shape: "rub_khatam", colour: 1 });
    expect(dividerFor(4, 0, 5, ORN)).toBeNull();
  });

  it("moves the morph element to the end of the verses on every render", () => {
    const window = new Window();
    const doc = window.document;
    const holder = doc.createElement("div");
    const morph = doc.createElement("div");
    morph.className = "ornament-divider ornament-morph";
    holder.appendChild(morph);
    doc.body.appendChild(holder);
    const container = doc.createElement("div");
    doc.body.appendChild(container);
    const opts = { morph: morph as unknown as HTMLElement };
    renderQasida(doc as unknown as Document, container as unknown as HTMLElement, SAMPLE, opts);
    expect(container.lastElementChild).toBe(morph);
    renderQasida(doc as unknown as Document, container as unknown as HTMLElement, SAMPLE, opts);
    expect(container.querySelectorAll(".ornament-morph")).toHaveLength(1);
    expect(container.lastElementChild).toBe(morph);
  });

  it("a stanza repeated as a whole gets one mark on its heading", () => {
    const container = render(SAMPLE);
    const heading = container.querySelector('[data-section="verses"][data-group="0"] h2')!;
    expect(heading.querySelector(".repeat-mark")!.textContent).toBe("\u00d72");
    expect(heading.textContent).toContain("sung twice");
    expect(
      container.querySelectorAll('[data-section="verses"][data-group="0"] .verse .repeat-mark'),
    ).toHaveLength(0);
  });

  it("mixed repeats mark each line on every layer with the fallback classes", () => {
    const mixed: QasidaData = {
      ...SAMPLE,
      order: { chorus: [], verses: [[{ repeat: 3, index: 0 }, { repeat: 1, index: 1 }]] },
    };
    const container = render(mixed);
    expect(container.querySelector("h2 .repeat-mark")).toBeNull();
    const first = container.querySelectorAll(".verse")[0]!;
    const marks = [...first.querySelectorAll(".repeat-mark")];
    expect(marks.map((m) => m.textContent)).toEqual(["\u00d73", "\u00d73", "\u00d73"]);
    expect(marks[1]!.className).toBe("repeat-mark repeat-mark-fallback-transliteration");
    expect(marks[2]!.className).toBe("repeat-mark repeat-mark-fallback-translation");
    expect(first.querySelector(".repeat-sr")!.textContent).toBe("Sung 3 times");
    expect(container.querySelectorAll(".verse")[1]!.querySelector(".repeat-mark")).toBeNull();
  });

  it("stanzaRepeat and repeatTimes follow verse.html", () => {
    expect(stanzaRepeat([{ repeat: 2, index: 0 }, { repeat: 2, index: 1 }])).toBe(2);
    expect(stanzaRepeat([{ repeat: 2, index: 0 }, { repeat: 1, index: 1 }])).toBe(1);
    expect(repeatTimes(2)).toBe("twice");
    expect(repeatTimes(4)).toBe("4 times");
  });

  it("a qasida missing the transliteration array renders the error instead of throwing", () => {
    const broken = { ...SAMPLE, verses: { ara: ["a"] } } as unknown as QasidaData;
    const container = render(broken);
    expect(container.querySelector(".live-render-error")).toBeTruthy();
  });
});
