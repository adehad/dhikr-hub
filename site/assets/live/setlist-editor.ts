import { button, icon } from "./ui";

export interface QasidaIndexEntry {
  slug: string;
  title: string;
  titleAra: string;
  url: string;
  maqam: string[];
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = items.slice();
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved as T);
  return out;
}

// Where the live track ends up after an edit; null when it was removed.
export function currentAfterMove(current: number | null, from: number, to: number): number | null {
  if (current === null) return null;
  if (current === from) return to;
  if (from < current && to >= current) return current - 1;
  if (from > current && to <= current) return current + 1;
  return current;
}

export function currentAfterRemove(current: number | null, removed: number): number | null {
  if (current === null) return null;
  if (removed === current) return null;
  return removed < current ? current - 1 : current;
}

export function shortTitle(title: string): string {
  return title.split(" - ")[0] ?? title;
}

export function searchable(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function filterIndex(index: QasidaIndexEntry[], query: string): QasidaIndexEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return index;
  const folded = searchable(query);
  return index.filter(
    (q) => searchable(q.title).includes(folded) || q.titleAra.includes(needle) || q.slug.includes(needle),
  );
}

export interface SetlistEditorOptions {
  items: string[];
  editable: boolean;
  // Index of the live track; its row gets the live marker.
  current: number | null;
  // Remembers whether Arabic titles are shown; null keeps the choice in memory.
  storage?: Storage | null;
  onChange?: (items: string[], current: number | null) => void;
  onPlay?: (index: number) => void;
}

const ARABIC_TITLES_KEY = "dhikr-hub-live-arabic-titles";
const SVG_NS = "http://www.w3.org/2000/svg";

export class SetlistEditor {
  private items: string[];
  private editable: boolean;
  private current: number | null;
  private showArabic: boolean;
  private query = "";
  private titles = new Map<string, QasidaIndexEntry>();

  constructor(
    private doc: Document,
    private root: HTMLElement,
    index: QasidaIndexEntry[],
    private opts: SetlistEditorOptions,
  ) {
    this.items = opts.items.slice();
    this.editable = opts.editable;
    this.current = opts.current;
    this.showArabic = this.readArabicChoice();
    this.setIndex(index);
  }

  setIndex(index: QasidaIndexEntry[]): void {
    this.titles = new Map(index.map((q) => [q.slug, q]));
    this.render();
  }

  getItems(): string[] {
    return this.items.slice();
  }

  setItems(items: string[], current: number | null): void {
    this.items = items.slice();
    this.current = current;
    this.render();
  }

  setCurrent(current: number | null): void {
    this.current = current;
    this.render();
  }

  setEditable(editable: boolean): void {
    if (this.editable === editable) return;
    this.editable = editable;
    this.render();
  }

  private readArabicChoice(): boolean {
    try {
      return this.opts.storage?.getItem(ARABIC_TITLES_KEY) === "1";
    } catch {
      return false;
    }
  }

  private setShowArabic(show: boolean): void {
    this.showArabic = show;
    try {
      this.opts.storage?.setItem(ARABIC_TITLES_KEY, show ? "1" : "0");
    } catch {
      // Private mode or full storage: the choice lasts for this page only.
    }
    this.render();
  }

  titleOf(slug: string): string {
    const entry = this.titles.get(slug);
    return entry ? shortTitle(entry.title) : slug;
  }

  private commit(items: string[], current: number | null): void {
    this.items = items;
    this.current = current;
    this.render();
    this.opts.onChange?.(items.slice(), current);
  }

  private add(slug: string): void {
    this.commit([...this.items, slug], this.current);
  }

  private move(from: number, to: number): void {
    if (to < 0 || to >= this.items.length) return;
    this.commit(moveItem(this.items, from, to), currentAfterMove(this.current, from, to));
  }

  private remove(index: number): void {
    const items = this.items.slice();
    items.splice(index, 1);
    this.commit(items, currentAfterRemove(this.current, index));
  }

  render(): void {
    const doc = this.doc;
    const frag = doc.createDocumentFragment();

    if (this.items.length === 0) {
      const empty = doc.createElement("p");
      empty.className = "live-hint";
      empty.textContent = this.editable
        ? "No qasidas yet. Search below to add some."
        : "The host has not chosen any qasidas yet.";
      frag.appendChild(empty);
    } else {
      frag.appendChild(this.table());
    }

    if (this.editable) frag.appendChild(this.picker());
    this.root.replaceChildren(frag);
  }

  private table(): HTMLTableElement {
    const doc = this.doc;
    const table = doc.createElement("table");
    table.className = "live-table live-setlist";
    const thead = doc.createElement("thead");
    const headRow = doc.createElement("tr");
    const numTh = doc.createElement("th");
    numTh.scope = "col";
    numTh.className = "live-td-num";
    numTh.textContent = "#";
    const titleTh = doc.createElement("th");
    titleTh.scope = "col";
    titleTh.className = "live-th-title";
    const titleText = doc.createElement("span");
    titleText.textContent = "Qasida";
    const ara = doc.createElement("button");
    ara.type = "button";
    ara.className = "live-btn live-btn-quiet live-btn-ara";
    ara.setAttribute("aria-pressed", String(this.showArabic));
    ara.setAttribute("aria-label", "Show Arabic titles");
    ara.title = "Show Arabic titles";
    ara.lang = "ar";
    ara.textContent = "ع";
    ara.addEventListener("click", () => this.setShowArabic(!this.showArabic));
    const titleWrap = doc.createElement("span");
    titleWrap.className = "live-th-wrap";
    titleWrap.append(titleText, ara);
    titleTh.appendChild(titleWrap);
    const actionsTh = doc.createElement("th");
    actionsTh.scope = "col";
    const sr = doc.createElement("span");
    sr.className = "live-sr-only";
    sr.textContent = "Actions";
    actionsTh.appendChild(sr);
    headRow.append(numTh, titleTh, actionsTh);
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = doc.createElement("tbody");
    this.items.forEach((slug, i) => tbody.appendChild(this.row(slug, i)));
    table.appendChild(tbody);
    return table;
  }

  private row(slug: string, i: number): HTMLTableRowElement {
    const doc = this.doc;
    const tr = doc.createElement("tr");
    const isCurrent = i === this.current;
    if (isCurrent) {
      tr.className = "live-row-current";
      tr.setAttribute("aria-current", "true");
    }

    const num = doc.createElement("td");
    num.className = "live-td-num";
    if (isCurrent) {
      num.appendChild(this.liveMarker());
    } else {
      num.textContent = String(i + 1);
    }
    tr.appendChild(num);

    const title = doc.createElement("td");
    title.className = "live-td-title";
    const entry = this.titles.get(slug);
    const name = entry ? shortTitle(entry.title) : slug;
    const en = doc.createElement("span");
    en.className = "live-setlist-title";
    en.textContent = name;
    const ara = doc.createElement("span");
    ara.className = "live-setlist-ara arabic";
    ara.dir = "rtl";
    ara.textContent = entry?.titleAra ?? "";
    const withArabic = this.showArabic && !!entry?.titleAra;
    if (this.opts.onPlay && this.editable && !isCurrent) {
      const go = doc.createElement("button");
      go.type = "button";
      go.className = "live-track-btn";
      go.setAttribute("aria-label", `Go to ${name}`);
      go.title = `Go to ${name}`;
      go.appendChild(icon(doc, "play", 16));
      const text = doc.createElement("span");
      text.className = "live-track-text";
      text.append(en);
      if (withArabic) text.append(ara);
      go.appendChild(text);
      go.addEventListener("click", () => this.opts.onPlay?.(i));
      title.appendChild(go);
    } else {
      title.appendChild(en);
      if (withArabic) title.appendChild(ara);
    }
    tr.appendChild(title);

    const actionsCell = doc.createElement("td");
    actionsCell.className = "live-td-actions";
    const actions = doc.createElement("div");
    actions.className = "live-actions";
    actionsCell.appendChild(actions);
    if (this.editable) {
      const updown = doc.createElement("div");
      updown.className = "live-updown";
      updown.append(
        button(doc, {
          icon: "chevron-up",
          label: `Move ${name} up`,
          disabled: i === 0,
          onClick: () => this.move(i, i - 1),
        }),
        button(doc, {
          icon: "chevron-down",
          label: `Move ${name} down`,
          disabled: i === this.items.length - 1,
          onClick: () => this.move(i, i + 1),
        }),
      );
      actions.appendChild(updown);
      actions.appendChild(
        button(doc, {
          icon: "x",
          label: `Remove ${name}`,
          className: "live-btn-quiet live-btn-remove",
          onClick: () => this.remove(i),
        }),
      );
    }
    tr.appendChild(actionsCell);
    return tr;
  }

  private liveMarker(): HTMLSpanElement {
    const doc = this.doc;
    const rec = doc.createElement("span");
    rec.className = "live-rec";
    rec.setAttribute("role", "img");
    rec.setAttribute("aria-label", "Live now");
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "live-rec-star");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = doc.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#ornament-rub_lotus");
    svg.appendChild(use);
    rec.appendChild(svg);
    return rec;
  }

  private picker(): HTMLElement {
    const doc = this.doc;
    const box = doc.createElement("div");
    box.className = "live-picker";

    const field = doc.createElement("label");
    field.className = "live-search";
    field.appendChild(icon(doc, "search"));
    const sr = doc.createElement("span");
    sr.className = "live-sr-only";
    sr.textContent = "Search qasidas to add";
    field.appendChild(sr);
    const input = doc.createElement("input");
    input.type = "search";
    input.placeholder = "Search qasidas to add";
    input.autocomplete = "off";
    input.value = this.query;
    field.appendChild(input);
    box.appendChild(field);

    const list = doc.createElement("ul");
    list.className = "live-picker-list";
    const fill = (): void => {
      const all = [...this.titles.values()];
      const matches = filterIndex(all, this.query);
      list.replaceChildren(
        ...matches.map((q) => {
          const li = doc.createElement("li");
          const text = doc.createElement("span");
          text.className = "live-picker-title";
          text.textContent = shortTitle(q.title);
          li.appendChild(text);
          if (q.titleAra) {
            const ara = doc.createElement("span");
            ara.className = "live-setlist-ara arabic";
            ara.dir = "rtl";
            ara.textContent = q.titleAra;
            li.appendChild(ara);
          }
          li.appendChild(
            button(doc, {
              icon: "plus",
              label: `Add ${shortTitle(q.title)}`,
              className: "live-btn-add",
              onClick: () => this.add(q.slug),
            }),
          );
          return li;
        }),
      );
      if (matches.length === 0) {
        const li = doc.createElement("li");
        li.className = "live-hint";
        li.textContent = "No qasida matches that.";
        list.appendChild(li);
      }
    };
    input.addEventListener("input", () => {
      this.query = input.value;
      fill();
    });
    fill();
    box.appendChild(list);
    return box;
  }
}
