const SVG_NS = "http://www.w3.org/2000/svg";

// References a <symbol> in the sprite emitted by partials/live/icons.html.
export function icon(doc: Document, name: string, size = 20): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "live-icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  const use = doc.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#li-${name}`);
  svg.appendChild(use);
  return svg;
}

export interface ButtonSpec {
  icon?: string;
  text?: string;
  // Accessible name for icon-only buttons; also shown as a tooltip.
  label?: string;
  className?: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
}

export function button(doc: Document, spec: ButtonSpec): HTMLButtonElement {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = `live-btn ${spec.text ? "" : "live-btn-icon"} ${spec.className ?? ""}`.trim();
  if (spec.icon) btn.appendChild(icon(doc, spec.icon));
  if (spec.text) btn.appendChild(doc.createTextNode(spec.text));
  if (spec.label) {
    btn.setAttribute("aria-label", spec.label);
    btn.title = spec.label;
  }
  if (spec.disabled) btn.disabled = true;
  if (spec.pressed !== undefined) btn.setAttribute("aria-pressed", String(spec.pressed));
  btn.addEventListener("click", spec.onClick);
  return btn;
}

export function pill(doc: Document, text: string, kind: string, iconName?: string): HTMLSpanElement {
  const span = doc.createElement("span");
  span.className = `live-pill live-pill-${kind}`;
  if (iconName) span.appendChild(icon(doc, iconName, 14));
  span.appendChild(doc.createTextNode(text));
  return span;
}

export function swapIconBriefly(btn: HTMLElement, name: string, ms = 1500): void {
  const use = btn.querySelector("use");
  if (!use) return;
  const previous = use.getAttribute("href") ?? "";
  use.setAttribute("href", `#li-${name}`);
  btn.classList.add("is-confirmed");
  setTimeout(() => {
    use.setAttribute("href", previous);
    btn.classList.remove("is-confirmed");
  }, ms);
}

// Clipboard needs a secure context; a LAN phone over plain http gets the
// share sheet instead, and failing that the text itself to copy by hand.
export async function copyText(text: string, shareTitle?: string): Promise<"copied" | "shared" | "failed"> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    // fall through to share
  }
  try {
    if (navigator.share) {
      await navigator.share(shareTitle ? { title: shareTitle, url: text } : { text });
      return "shared";
    }
  } catch {
    // user dismissed or unsupported payload
  }
  return "failed";
}

export function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

export function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

// Tapping the dimmed backdrop closes the dialog, as on native sheets.
export function closeOnBackdrop(dialog: HTMLDialogElement): void {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
}
