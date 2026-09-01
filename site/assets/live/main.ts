import type { PeerInfo, ServerMessage, Setlist, VersePosition } from "./messages";
import { LiveStore } from "./storage";
import { LiveSocket, type LiveStatus } from "./net";
import { renderQasida, type Ornaments, type QasidaData } from "./renderer";
import { chorusPanel, initialChorusPanel, type ChorusPanelEvent } from "./chorus-state";
import { coalesceJoin, joinMessage, type JoinFlash } from "./join-flash";
import { debounce, FollowerScroller, groupElements, HostTracker, jumpDirection, pickCurrentGroup } from "./sync";
import { SetlistEditor, shortTitle, type QasidaIndexEntry } from "./setlist-editor";
import {
  button,
  closeDialog,
  closeOnBackdrop,
  copyText,
  icon,
  openDialog,
  pill,
  swapIconBriefly,
} from "./ui";

// Matches the room-code generator's alphabet: l and o are excluded to avoid
// confusion with 1 and 0.
const ROOM_CODE_RE = /^[abcdefghijkmnpqrstuvwxyz23456789]{8}$/;

const app = document.getElementById("live-app");
if (app) {
  boot(app).catch(() => {
    app.textContent = "Live is unavailable. Reload to try again.";
  });
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`live: missing #${id}`);
  return node as T;
}

function condensed(publicId: string): string {
  return `${publicId.slice(0, 4)}…${publicId.slice(-4)}`;
}

function toast(text: string, onClick?: () => void): void {
  const box = el<HTMLDivElement>("live-toasts");
  const node = document.createElement(onClick ? "button" : "div");
  node.className = "live-toast";
  node.textContent = text;
  if (onClick) {
    (node as HTMLButtonElement).type = "button";
    node.addEventListener("click", () => {
      onClick();
      node.remove();
    });
  }
  box.appendChild(node);
  setTimeout(() => node.remove(), 6000);
}

async function fetchIndex(indexUrl: string): Promise<QasidaIndexEntry[]> {
  try {
    const res = await fetch(indexUrl);
    if (!res.ok) return [];
    const body = (await res.json()) as { qasidas?: QasidaIndexEntry[] };
    return body.qasidas ?? [];
  } catch {
    return [];
  }
}

function readOrnaments(root: HTMLElement): Ornaments | null {
  try {
    const dividers = JSON.parse(root.dataset.dividers ?? "[]") as unknown;
    const colours = Number(root.dataset.ornamentColours);
    if (!Array.isArray(dividers) || !Number.isInteger(colours) || colours < 1) return null;
    return { dividers: dividers.filter((d): d is string => typeof d === "string"), colours };
  } catch {
    return null;
  }
}

async function boot(root: HTMLElement): Promise<void> {
  const store = new LiveStore(localStorage);
  const endpoint = root.dataset.endpoint || "";
  const qasidaBase = root.dataset.qasidaBase!;
  const indexUrl = root.dataset.indexUrl!;

  // Same-origin on any workers.dev host (PR previews then use their own DOs);
  // the configured endpoint only matters for the GitHub Pages deployment.
  const sameOrigin =
    !endpoint || location.hostname.endsWith(".workers.dev") || location.hostname === "localhost";
  const httpBase = sameOrigin ? "" : endpoint.replace(/^ws/, "http");
  const wsBase = sameOrigin
    ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
    : endpoint;

  store.ensureIdentity();

  async function api(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${httpBase}/api/live${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${store.ensureIdentity().id}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  }

  async function registerIdentity(): Promise<void> {
    const res = await api("/identity/register", {
      method: "POST",
      body: JSON.stringify({ name: store.ensureIdentity().name }),
    });
    if (res.ok) {
      const profile = (await res.json()) as { publicId: string; name: string };
      store.updateIdentity({ publicId: profile.publicId, name: profile.name });
    }
  }

  const room = new URLSearchParams(location.search).get("room");
  if (room) {
    // Not awaited: the event view renders immediately, and the identity
    // refresh is not on the critical path for the hello-then-snapshot flow.
    void registerIdentity().catch(() => {
      // Offline or worker unreachable: the event view still works; registration
      // retries on the next visit.
    });
    await eventView(store, room, {
      api,
      httpBase,
      wsBase,
      qasidaBase,
      indexUrl,
      ornaments: readOrnaments(root),
    });
  } else {
    await lobbyView(store, { api, indexUrl, registerIdentity });
  }
}

// ---------- lobby ----------

async function lobbyView(
  store: LiveStore,
  ctx: {
    api: (p: string, i?: RequestInit) => Promise<Response>;
    indexUrl: string;
    registerIdentity: () => Promise<void>;
  },
): Promise<void> {
  el<HTMLElement>("live-lobby").hidden = false;

  const identity = store.ensureIdentity();
  const nameInput = el<HTMLInputElement>("live-name");
  nameInput.value = identity.name;
  nameInput.addEventListener("change", () => {
    const name = nameInput.value.trim() || "Listener";
    store.updateIdentity({ name });
    // 404s until first registration; the stored name goes up with that register.
    void ctx.api("/identity/name", { method: "POST", body: JSON.stringify({ name }) }).catch(() => {});
  });

  el<HTMLElement>("live-full-id").textContent = identity.id;
  const copyId = el<HTMLButtonElement>("live-copy-id");
  copyId.addEventListener("click", () => {
    void copyText(store.ensureIdentity().id).then((result) => {
      if (result === "copied") {
        swapIconBriefly(copyId, "check");
        toast("ID copied");
      } else if (result === "failed") {
        toast("Could not copy; select the ID and copy it by hand");
      }
    });
  });
  el<HTMLButtonElement>("live-adopt-id").addEventListener("click", () => void adoptPastedId());

  async function adoptPastedId(): Promise<void> {
    const pasted = el<HTMLInputElement>("live-paste-id").value.trim();
    if (!pasted) return;
    const res = await ctx
      .api("/identity/profile", { headers: { Authorization: `Bearer ${pasted}` } })
      .catch(() => null);
    if (!res?.ok) {
      toast("That ID is not a known account");
      return;
    }
    const profile = (await res.json()) as { publicId: string; name: string };
    store.adoptIdentity(pasted, profile.name, profile.publicId);
    location.reload();
  }

  // ----- setlist editor (new or existing) -----
  const index = await fetchIndex(ctx.indexUrl);
  const editorCard = el<HTMLElement>("live-editor");
  const editorTitle = el<HTMLElement>("live-editor-title");
  const nameField = el<HTMLInputElement>("live-setlist-name");
  let editingId: string | null = null;
  const editor = new SetlistEditor(document, el<HTMLElement>("live-editor-body"), index, {
    items: [],
    editable: true,
    current: null,
    storage: localStorage,
  });

  function openEditor(setlist?: Setlist): void {
    editingId = setlist?.id ?? null;
    editorTitle.textContent = setlist ? `Edit "${setlist.name}"` : "New setlist";
    nameField.value = setlist?.name ?? "";
    editor.setItems(setlist?.items ?? [], null);
    editorCard.hidden = false;
    editorCard.scrollIntoView({ behavior: "smooth", block: "start" });
    nameField.focus();
  }

  function closeEditor(): void {
    editorCard.hidden = true;
    editingId = null;
    editor.setItems([], null);
    nameField.value = "";
  }

  el<HTMLButtonElement>("live-setlist-new").addEventListener("click", () => openEditor());
  el<HTMLButtonElement>("live-setlist-cancel").addEventListener("click", closeEditor);
  el<HTMLButtonElement>("live-setlist-save").addEventListener("click", () => {
    const name = nameField.value.trim();
    const items = editor.getItems();
    if (!name || items.length === 0) {
      toast("Name the setlist and add at least one qasida");
      return;
    }
    store.saveSetlist({
      id: editingId ?? crypto.randomUUID(),
      name,
      items,
      updatedAt: new Date().toISOString(),
    });
    closeEditor();
    renderSetlists();
    toast(`Saved "${name}"`);
  });

  // ----- saved setlists -----
  function renderSetlists(): void {
    const lists = store.setlists();
    el<HTMLElement>("live-setlist-table").hidden = lists.length === 0;
    el<HTMLElement>("live-setlist-empty").hidden = lists.length > 0;
    el<HTMLTableSectionElement>("live-setlist-list").replaceChildren(
      ...lists.map((s) => {
        const tr = document.createElement("tr");
        const name = document.createElement("td");
        name.className = "live-td-title";
        name.textContent = s.name;
        const count = document.createElement("td");
        count.className = "live-td-num";
        count.textContent = String(s.items.length);
        const actionsCell = document.createElement("td");
        actionsCell.className = "live-td-actions";
        const actions = document.createElement("div");
        actions.className = "live-actions";
        actionsCell.appendChild(actions);
        actions.append(
          button(document, {
            icon: "play",
            text: "Start",
            className: "live-btn-primary",
            onClick: () => void createRoom(s.id),
          }),
          button(document, {
            icon: "pencil",
            label: `Edit ${s.name}`,
            className: "live-btn-quiet",
            onClick: () => openEditor(s),
          }),
          button(document, {
            icon: "trash",
            label: `Delete ${s.name}`,
            className: "live-btn-quiet live-btn-remove",
            onClick: () => {
              if (!confirm(`Delete the setlist "${s.name}"?`)) return;
              store.deleteSetlist(s.id);
              if (editingId === s.id) closeEditor();
              renderSetlists();
            },
          }),
        );
        tr.append(name, count, actionsCell);
        return tr;
      }),
    );
  }
  renderSetlists();

  el<HTMLButtonElement>("live-create-room").addEventListener("click", () => void createRoom(""));

  async function createRoom(setlistId: string): Promise<void> {
    await ctx.registerIdentity().catch(() => {
      // Registration failure surfaces below via the room-create request itself.
    });
    const hostName = store.ensureIdentity().name;
    const chosen = setlistId ? store.setlists().find((s) => s.id === setlistId) : undefined;
    const roomName = chosen?.name ?? `${hostName}'s room`;
    const res = await ctx
      .api("/room", { method: "POST", body: JSON.stringify({ name: hostName, roomName }) })
      .catch(() => null);
    if (!res?.ok) {
      toast("Could not create room (is the live server reachable?)");
      return;
    }
    const { room } = (await res.json()) as { room: string };
    sessionStorage.setItem("dhikr-hub-live-start-setlist", setlistId);
    location.search = `?room=${room}`;
  }

  el<HTMLFormElement>("live-join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = el<HTMLInputElement>("live-join-code").value.trim().toLowerCase();
    if (!code) return;
    if (!ROOM_CODE_RE.test(code)) {
      toast("That is not a valid room code (8 letters and digits)");
      return;
    }
    location.search = `?room=${code}`;
  });
}

// ---------- event ----------

async function eventView(
  store: LiveStore,
  room: string,
  ctx: {
    api: (p: string, i?: RequestInit) => Promise<Response>;
    httpBase: string;
    wsBase: string;
    qasidaBase: string;
    indexUrl: string;
    ornaments: Ornaments | null;
  },
): Promise<void> {
  if (!ROOM_CODE_RE.test(room)) {
    toast("Invalid room code");
    location.search = "";
    return;
  }

  const probe = await fetch(`${ctx.httpBase}/api/live/room/${room}/ws`).catch(() => null);
  if (probe?.status === 404) {
    toast("Room not found. Check the code with the host.");
    setTimeout(() => {
      location.search = "";
    }, 1500);
    return;
  }

  el<HTMLElement>("live-event").hidden = false;
  el<HTMLElement>("live-room-code").textContent = room;
  const liveApp = el<HTMLElement>("live-app");
  document.body.classList.add("live-event-active");

  // On phones the now strip sits inside the site header, so it takes the
  // header's height; the header is display:none on desktop.
  function measureHeader(): void {
    const height = document.querySelector(".book-header")?.getBoundingClientRect().height ?? 0;
    liveApp.style.setProperty("--live-header-h", height > 0 ? `${height}px` : "0px");
  }
  measureHeader();

  const versesRoot = el<HTMLDivElement>("live-verses");
  const morph = document.querySelector<HTMLElement>("#live-morph-holder .ornament-morph");
  const identity = store.ensureIdentity();

  let you = identity.publicId ?? "";
  let hosts: string[] = [];
  let leader = "";
  let roster: PeerInfo[] = [];
  let setlist: Setlist | null = null;
  let currentSlug: string | null = null;
  let currentIndex: number | null = null;
  let renderedSlug: string | null = null;
  let lastHostPosition: VersePosition | null = null;
  let chorusOn = false;
  let panel = initialChorusPanel;
  let settingPanel = false;
  let wasLeading = false;
  let tracker: HostTracker | null = null;
  let ended = false;
  let loadGeneration = 0;
  let index: QasidaIndexEntry[] = [];
  const titles = new Map<string, string>();
  const pageUrls = new Map<string, string>();
  const lastErrorToast = new Map<string, number>();

  const scroller = new FollowerScroller(versesRoot, () => updateFollowState());

  const setlistDialog = el<HTMLDialogElement>("live-setlist-dialog");
  const peopleDialog = el<HTMLDialogElement>("live-people-dialog");
  const menuDialog = el<HTMLDialogElement>("live-menu-dialog");
  closeOnBackdrop(setlistDialog);
  closeOnBackdrop(peopleDialog);
  closeOnBackdrop(menuDialog);

  // The sheet borrows the page's own top bar so its controls keep one set of
  // ids and listeners; it goes back where it came from when the sheet closes.
  const topbar = document.querySelector<HTMLElement>("#live-event .live-topbar")!;
  const topbarHome = { parent: topbar.parentElement!, next: topbar.nextSibling };
  function restoreTopbar(): void {
    if (topbar.parentElement !== topbarHome.parent) {
      topbarHome.parent.insertBefore(topbar, topbarHome.next);
    }
  }
  function openMenu(): void {
    el<HTMLElement>("live-menu-body").appendChild(topbar);
    openDialog(menuDialog);
  }
  function closeMenu(): void {
    closeDialog(menuDialog);
    restoreTopbar();
  }
  menuDialog.addEventListener("close", restoreTopbar);
  el<HTMLButtonElement>("live-menu-close").addEventListener("click", closeMenu);

  function openFromMenu(dialog: HTMLDialogElement): void {
    if (menuDialog.open) closeMenu();
    openDialog(dialog);
  }
  for (const id of ["live-setlist-open", "live-setlist-bar", "live-menu-setlist"]) {
    el<HTMLButtonElement>(id).addEventListener("click", () => openFromMenu(setlistDialog));
  }
  for (const id of ["live-people-open", "live-people-bar"]) {
    el<HTMLButtonElement>(id).addEventListener("click", () => openFromMenu(peopleDialog));
  }
  el<HTMLButtonElement>("live-setlist-close").addEventListener("click", () => closeDialog(setlistDialog));
  el<HTMLButtonElement>("live-people-close").addEventListener("click", () => closeDialog(peopleDialog));

  // The theme appends a "#" anchor link to the h1; only its leading text
  // node is the heading text.
  const headingText = [...(document.querySelector(".book-article h1")?.childNodes ?? [])].find(
    (node) => node.nodeType === Node.TEXT_NODE,
  );
  const pageTitle = document.title;
  function showRoomName(name: string | undefined): void {
    const trimmed = name?.trim();
    if (!trimmed) return;
    if (headingText) headingText.textContent = trimmed;
    el<HTMLElement>("live-menu-title").textContent = trimmed;
    document.title = `${trimmed} | Dhikr Hub`;
  }
  function restoreRoomName(): void {
    if (headingText) headingText.textContent = "Live";
    el<HTMLElement>("live-menu-title").textContent = "Room";
    document.title = pageTitle;
  }

  let joinFlash: JoinFlash | null = null;
  let joinFlashTimer: ReturnType<typeof setTimeout> | undefined;
  function flashJoin(): void {
    joinFlash = coalesceJoin(joinFlash, Date.now());
    const flash = el<HTMLSpanElement>("live-join-flash");
    el<HTMLSpanElement>("live-join-count").textContent = `+${joinFlash.count}`;
    el<HTMLSpanElement>("live-join-live").textContent = joinMessage(joinFlash.count);
    flash.hidden = false;
    flash.style.animation = "none";
    void flash.offsetWidth;
    flash.style.animation = "";
    clearTimeout(joinFlashTimer);
    joinFlashTimer = setTimeout(() => {
      flash.hidden = true;
    }, 1200);
  }

  const setlistEditor = new SetlistEditor(document, el<HTMLElement>("live-setlist-body"), index, {
    items: [],
    editable: false,
    current: null,
    storage: localStorage,
    onChange: (items, current) => publishSetlist(items, current),
    onPlay: (i) => goTo(i),
  });

  function isHost(): boolean {
    return hosts.includes(you);
  }

  function effectiveLeader(): string | null {
    const present = new Set(roster.map((p) => p.publicId));
    if (present.has(leader)) return leader;
    return hosts.find((h) => present.has(h)) ?? null;
  }

  function isLeader(): boolean {
    return you !== "" && effectiveLeader() === you;
  }

  function nameOf(publicId: string): string {
    const peer = roster.find((p) => p.publicId === publicId);
    return peer ? peer.name : condensed(publicId);
  }

  function titleOf(slug: string): string {
    return titles.get(slug) ?? slug;
  }

  function toastError(code: string, message: string): void {
    const now = Date.now();
    if (now - (lastErrorToast.get(code) ?? 0) < 5000) return;
    lastErrorToast.set(code, now);
    toast(message);
  }

  // ----- presentation -----

  function stanzaText(pos: VersePosition | null): string {
    if (!pos) return "";
    return pos.section === "chorus" ? `Chorus ${pos.group + 1}` : `stanza ${pos.group + 1}`;
  }

  function updateJumpDirection(): void {
    if (!lastHostPosition) return;
    const items = groupElements(versesRoot);
    const order = items.map((i) => i.pos);
    const line = innerHeight / 3;
    const mine = pickCurrentGroup(
      order,
      items.map((i) => i.el.getBoundingClientRect().top - line),
    );
    const direction = jumpDirection(order, lastHostPosition, mine);
    el<HTMLButtonElement>("live-jump")
      .querySelector("use")
      ?.setAttribute("href", `#li-arrow-${direction}-to-line`);
  }

  function updateFollowState(): void {
    const detached = scroller.isDetached() && !isLeader();
    const jump = el<HTMLButtonElement>("live-jump");
    jump.hidden = !detached;
    el<HTMLElement>("live-now").classList.toggle("is-detached", detached);
    el<HTMLElement>("live-now-badge").setAttribute("aria-label", detached ? "Paused" : "Live");
    if (detached) {
      updateJumpDirection();
      const verse =
        lastHostPosition === null
          ? ""
          : lastHostPosition.section === "chorus"
            ? `Chorus ${lastHostPosition.group + 1}`
            : `Verse ${lastHostPosition.group + 1}`;
      el<HTMLSpanElement>("live-banner-text").textContent = verse
        ? `Back to live: ${verse}`
        : "Back to live";
    }
  }

  function fitTitle(): void {
    const inner = el<HTMLSpanElement>("live-now-title");
    const outer = inner.parentElement;
    if (!outer) return;
    outer.classList.remove("is-overflowing");
    const overflow = outer.scrollWidth - outer.clientWidth;
    if (overflow > 0) {
      outer.style.setProperty("--live-overflow", `${overflow}px`);
      outer.classList.add("is-overflowing");
    } else {
      outer.style.removeProperty("--live-overflow");
    }
  }

  function setTitle(text: string): void {
    const titleEl = el<HTMLSpanElement>("live-now-title");
    if (titleEl.textContent !== text) titleEl.textContent = text;
    fitTitle();
  }

  function updateIndex(): void {
    const total = setlist?.items.length ?? 0;
    const parts: string[] = [];
    if (currentSlug && currentIndex !== null && total > 0) parts.push(`${currentIndex + 1} of ${total}`);
    if (currentSlug && renderedSlug === currentSlug) {
      const stanza = stanzaText(lastHostPosition);
      if (stanza) parts.push(stanza);
    }
    el<HTMLSpanElement>("live-now-index").textContent = parts.join(" · ");
  }

  function updateNow(): void {
    updateIndex();
    if (!currentSlug) {
      setTitle(isLeader() ? "Pick a qasida from the setlist" : "Waiting for the host");
      return;
    }
    setTitle(titleOf(currentSlug));
    setlistEditor.setCurrent(currentIndex);
  }

  function updateRole(): void {
    const role = el<HTMLSpanElement>("live-role");
    role.hidden = false;
    role.className = "live-pill";
    role.replaceChildren();
    if (isLeader()) {
      role.classList.add("live-pill-lead");
      role.appendChild(icon(document, "radio", 14));
      role.appendChild(document.createTextNode("Leading"));
    } else if (isHost()) {
      role.classList.add("live-pill-host");
      role.appendChild(icon(document, "crown", 14));
      role.appendChild(document.createTextNode("Host"));
    } else {
      const lead = effectiveLeader();
      role.classList.add("live-pill-follow");
      role.appendChild(icon(document, "user", 14));
      role.appendChild(document.createTextNode(lead ? `Following ${nameOf(lead)}` : "No host here"));
    }
  }

  function chorusToggle(): HTMLInputElement | null {
    return versesRoot.querySelector<HTMLInputElement>("#chorus-toggle");
  }

  // The leader's own panel toggle is theirs alone; only followers have it
  // driven by the host's chorus.
  function syncPanel(): void {
    if (isLeader()) return;
    const toggle = chorusToggle();
    if (!toggle || toggle.checked === panel.panelOpen) return;
    settingPanel = true;
    toggle.checked = panel.panelOpen;
    settingPanel = false;
  }

  function dispatchPanel(event: ChorusPanelEvent): void {
    panel = chorusPanel(panel, event);
    applyChorus();
    syncPanel();
  }

  function applyChorus(): void {
    versesRoot.classList.toggle("live-host-chorus-on", isLeader() ? chorusOn : panel.hostOn);
    const chorus = el<HTMLButtonElement>("live-chorus");
    chorus.setAttribute("aria-pressed", String(chorusOn));
    chorus.querySelector("use")?.setAttribute("href", chorusOn ? "#li-eye" : "#li-eye-off");
    const label = chorusOn ? "Chorus, shown to followers" : "Chorus, hidden from followers";
    chorus.setAttribute("aria-label", label);
    chorus.title = label;
  }

  function updateControls(): void {
    const host = isHost();
    document
      .querySelectorAll<HTMLElement>("#live-app .live-host-only")
      .forEach((node) => (node.hidden = !host));
    liveApp.classList.toggle("is-host", host);
    const leading = isLeader();
    if (wasLeading && !leading) {
      // Adopt whatever the former leader left their panel at as their own choice.
      panel = { hostOn: chorusOn, panelOpen: chorusToggle()?.checked ?? false, openedByHost: false };
    }
    wasLeading = leading;
    el<HTMLButtonElement>("live-menu-setlist").hidden = !leading;
    const hasList = (setlist?.items.length ?? 0) > 0;
    const prev = el<HTMLButtonElement>("live-prev");
    const next = el<HTMLButtonElement>("live-next");
    // A host who is not leading also gets "Lead from here"; prev and next
    // alongside it would overflow the bar on a phone.
    prev.hidden = next.hidden = !host || !leading;
    prev.disabled = !hasList || (currentIndex ?? 0) <= 0;
    next.disabled = !hasList || (currentIndex ?? -1) >= (setlist?.items.length ?? 0) - 1;
    const chorus = el<HTMLButtonElement>("live-chorus");
    chorus.disabled = !leading || !currentSlug;
    // "Lead from here" is too wide to share a 390px bar with the chorus,
    // people and setlist buttons.
    chorus.hidden = host && !leading;
    el<HTMLButtonElement>("live-follow-me").hidden = !host || leading;
    el<HTMLButtonElement>("live-download-setlist").hidden = host || setlist === null;
    setlistEditor.setEditable(leading);
    el<HTMLElement>("live-setlist-dialog-title").textContent = leading ? "Setlist (you can edit it)" : "Setlist";
    updateRole();
    updateNow();
    applyChorus();
    updateFollowState();
  }

  function renderRoster(): void {
    el<HTMLSpanElement>("live-roster-count").textContent = String(roster.length);
    el<HTMLSpanElement>("live-roster-count-bar").textContent = String(roster.length);
    const lead = effectiveLeader();
    const ordered = [...roster].sort((a, b) => {
      const rank = (p: PeerInfo): number =>
        p.publicId === you ? 0 : p.publicId === lead ? 1 : hosts.includes(p.publicId) ? 2 : 3;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });

    el<HTMLTableSectionElement>("live-roster").replaceChildren(
      ...ordered.map((peer) => {
        const tr = document.createElement("tr");
        if (peer.publicId === lead) tr.className = "live-row-lead";

        const name = document.createElement("td");
        name.className = "live-td-title";
        const label = document.createElement("span");
        label.className = "live-peer-name";
        label.textContent = peer.name;
        name.appendChild(label);
        if (peer.publicId === you) name.appendChild(pill(document, "you", "you"));
        const id = document.createElement("span");
        id.className = "live-peer-id";
        id.textContent = condensed(peer.publicId);
        name.appendChild(id);

        const role = document.createElement("td");
        role.className = "live-td-role";
        const cell = document.createElement("div");
        cell.className = "live-role-cell";
        const chips = document.createElement("span");
        chips.className = "live-chips";
        if (peer.publicId === lead) chips.appendChild(pill(document, "Leading", "lead", "radio"));
        if (hosts.includes(peer.publicId)) chips.appendChild(pill(document, "Host", "host", "crown"));
        const actions = document.createElement("span");
        actions.className = "live-actions";
        cell.append(chips, actions);
        role.appendChild(cell);
        if (peer.publicId !== you) {
          const trusted = store.isTrusted(peer.publicId);
          actions.appendChild(
            button(document, {
              icon: "star",
              label: trusted ? `Unstar ${peer.name}` : `Star ${peer.name}`,
              className: "live-btn-quiet live-btn-star",
              pressed: trusted,
              onClick: () => {
                store.setTrusted(peer.publicId, !trusted);
                renderRoster();
              },
            }),
          );
          if (isHost() && !hosts.includes(peer.publicId)) {
            actions.appendChild(
              button(document, {
                icon: "crown",
                label: `Make ${peer.name} a host`,
                className: "live-btn-host",
                onClick: () => socket.send({ type: "promote", target: peer.publicId }),
              }),
            );
          }
        }
        tr.append(name, role);
        return tr;
      }),
    );
  }

  // Returns false when a newer load superseded this one.
  async function loadQasida(slug: string): Promise<boolean> {
    const generation = ++loadGeneration;
    let data: QasidaData | null = null;
    try {
      const res = await fetch(`${ctx.qasidaBase}${slug}.json`);
      if (res.ok) data = (await res.json()) as QasidaData;
    } catch {
      data = null;
    }
    if (generation !== loadGeneration) return false;
    if (!data) {
      versesRoot.textContent = `Could not load ${titleOf(slug)}`;
      renderedSlug = null;
      return false;
    }
    titles.set(slug, shortTitle(data.name?.en ?? slug));
    renderQasida(document, versesRoot, data, { ornaments: ctx.ornaments, morph });
    syncPanel();
    renderedSlug = slug;
    const share = el<HTMLAnchorElement>("live-share-qasida");
    const pageUrl = pageUrls.get(slug);
    share.hidden = !pageUrl;
    if (pageUrl) share.href = pageUrl;
    if (isLeader() && tracker) {
      tracker.reset();
      tracker.emitNow();
    }
    updateNow();
    updateFollowState();
    return true;
  }

  // ----- networking -----

  const socket = new LiveSocket(
    `${ctx.wsBase}/api/live/room/${room}/ws`,
    { id: identity.id, name: identity.name },
    {
      onStatus: (status: LiveStatus) => {
        const box = el<HTMLSpanElement>("live-status");
        box.dataset.state = status;
        el<HTMLSpanElement>("live-status-text").textContent =
          status === "open" ? "connected" : status === "ended" ? "event ended" : "reconnecting";
        if (status === "ended" && !ended) {
          ended = true;
          toast("The host ended the event");
          setTimeout(() => {
            location.search = "";
          }, 1500);
        }
      },
      onMessage: (msg: ServerMessage) => {
        handle(msg).catch(() => {
          toastError("client", "Something went wrong; reload if the page stops following");
        });
      },
    },
  );

  function claimBatonIfOrphaned(): void {
    // The server never reassigns the leader on disconnect; an acting host
    // must claim the baton or every broadcast it sends is rejected not-leader.
    if (isHost() && leader !== you && effectiveLeader() === you) {
      socket.send({ type: "follow-me" });
    }
  }

  function syncSetlistPanel(): void {
    setlistEditor.setItems(setlist?.items ?? [], currentIndex);
    const title = el<HTMLElement>("live-setlist-dialog-title");
    title.textContent = setlist ? setlist.name : "Setlist";
  }

  async function handle(msg: ServerMessage): Promise<void> {
    switch (msg.type) {
      case "snapshot": {
        you = msg.you;
        store.updateIdentity({ publicId: msg.you });
        hosts = msg.hosts;
        leader = msg.leader;
        roster = msg.roster;
        setlist = msg.setlist;
        showRoomName(msg.roomName);
        lastHostPosition = msg.position;
        chorusOn = msg.chorus === true;
        currentIndex = msg.currentIndex ?? (msg.currentSlug && setlist ? indexFallback(msg.currentSlug) : null);
        renderRoster();
        syncSetlistPanel();
        updateControls();
        if (!isLeader()) dispatchPanel({ type: "host", on: chorusOn });
        syncTracker();
        claimBatonIfOrphaned();
        if (msg.currentSlug) {
          currentSlug = msg.currentSlug;
          if (msg.currentSlug !== renderedSlug) {
            const rendered = await loadQasida(msg.currentSlug);
            if (!rendered) break;
          } else {
            // Reconnect delivers a fresh snapshot for an already-rendered
            // qasida; a full re-render would re-derive and, for the leader,
            // rebroadcast a position mid-recitation.
            updateNow();
            updateFollowState();
          }
          if (msg.position && !isLeader()) scroller.apply(msg.position);
        } else if (isLeader()) {
          await startSetlistIfPending();
        } else {
          updateNow();
        }
        break;
      }
      case "peer-joined": {
        // A second socket for someone already present is not a new person.
        const isNew = msg.peer.publicId !== you && !roster.some((p) => p.publicId === msg.peer.publicId);
        roster = [...roster.filter((p) => p.publicId !== msg.peer.publicId), msg.peer];
        renderRoster();
        updateControls();
        syncTracker();
        claimBatonIfOrphaned();
        if (isNew) flashJoin();
        break;
      }
      case "peer-left":
        roster = roster.filter((p) => p.publicId !== msg.publicId);
        renderRoster();
        updateControls();
        syncTracker();
        claimBatonIfOrphaned();
        break;
      case "hosts": {
        const leaderChanged = msg.leader !== leader;
        const becameHost = !hosts.includes(you) && msg.hosts.includes(you);
        hosts = msg.hosts;
        leader = msg.leader;
        renderRoster();
        updateControls();
        syncTracker();
        claimBatonIfOrphaned();
        if (becameHost && !isLeader()) toast("You are a host now. Tap 'Lead from here' to take over.");
        else if (leaderChanged && !isLeader()) toast(`Now following ${nameOf(leader)}`);
        break;
      }
      case "position":
        // The server relays only the leader; the local gate is just "not me".
        if (msg.from === you || isLeader()) return;
        lastHostPosition = msg.position;
        if (renderedSlug === currentSlug) scroller.apply(msg.position);
        updateIndex();
        updateFollowState();
        break;
      case "navigate": {
        if (msg.from === you || isLeader()) return;
        currentIndex = msg.index ?? indexFallback(msg.slug);
        chorusOn = false;
        dispatchPanel({ type: "host", on: false });
        if (msg.slug === renderedSlug && msg.slug === currentSlug) {
          // Same qasida, new place in the setlist (the host reordered it).
          updateNow();
          updateControls();
          break;
        }
        currentSlug = msg.slug;
        lastHostPosition = null;
        scroller.reattach();
        updateControls();
        updateFollowState();
        const rendered = await loadQasida(msg.slug);
        // Positions that arrived during the fetch were applied to the old
        // qasida's DOM.
        if (rendered && lastHostPosition && !scroller.isDetached()) {
          scroller.apply(lastHostPosition);
        }
        updateFollowState();
        break;
      }
      case "chorus": {
        if (msg.from === you || isLeader()) return;
        chorusOn = msg.on;
        dispatchPanel({ type: "host", on: msg.on });
        break;
      }
      case "setlist":
        setlist = msg.setlist;
        if (currentSlug && currentIndex !== null && setlist.items[currentIndex] !== currentSlug) {
          currentIndex = indexFallback(currentSlug);
        }
        syncSetlistPanel();
        updateControls();
        break;
      case "ended":
        break; // onStatus handles it idempotently
      case "error":
        toastError(msg.code, msg.message);
        break;
    }
  }

  function indexFallback(slug: string): number | null {
    const i = setlist?.items.indexOf(slug) ?? -1;
    return i === -1 ? null : i;
  }

  function startSetlistIfPending(): Promise<void> {
    const id = sessionStorage.getItem("dhikr-hub-live-start-setlist");
    const pending = id ? store.setlists().find((s) => s.id === id) : undefined;
    if (!pending || pending.items.length === 0) {
      sessionStorage.removeItem("dhikr-hub-live-start-setlist");
      updateNow();
      return Promise.resolve();
    }
    setlist = pending;
    socket.send({ type: "setlist", setlist: pending });
    const sent = socket.send({ type: "navigate", slug: pending.items[0]!, index: 0 });
    if (sent) sessionStorage.removeItem("dhikr-hub-live-start-setlist");
    currentSlug = pending.items[0]!;
    currentIndex = 0;
    syncSetlistPanel();
    updateControls();
    return loadQasida(currentSlug).then(() => undefined);
  }

  // Shows the leader which stanza followers are being sent to.
  function markBroadcast(pos: VersePosition | null): void {
    versesRoot.querySelector(".live-broadcast")?.classList.remove("live-broadcast");
    if (!pos) return;
    versesRoot
      .querySelector(`.verse-container[data-section="${pos.section}"][data-group="${pos.group}"]`)
      ?.classList.add("live-broadcast");
  }

  function syncTracker(): void {
    if (isLeader() && !tracker) {
      tracker = new HostTracker(versesRoot, (pos) => {
        // A backgrounded device signed into this same account must not fight
        // the foreground device for the baton's positions.
        if (document.visibilityState === "hidden") return false;
        lastHostPosition = pos;
        markBroadcast(pos);
        updateIndex();
        return socket.send({ type: "position", position: pos });
      });
      tracker.emitNow();
    } else if (!isLeader() && tracker) {
      tracker.destroy();
      tracker = null;
      markBroadcast(null);
      scroller.jumpToHost();
    }
  }

  // ----- host actions -----

  function publishSetlist(items: string[], current: number | null): void {
    const base: Setlist = setlist ?? {
      id: crypto.randomUUID(),
      name: "Live setlist",
      items: [],
      updatedAt: "",
    };
    const next: Setlist = { ...base, items, updatedAt: new Date().toISOString() };
    if (!socket.send({ type: "setlist", setlist: next })) {
      toast("Not connected; the change was not sent");
      syncSetlistPanel();
      return;
    }
    setlist = next;
    const moved = currentSlug !== null && current !== currentIndex;
    currentIndex = current;
    if (moved && currentSlug && current !== null) {
      socket.send({ type: "navigate", slug: currentSlug, index: current });
      tracker?.reset();
      tracker?.emitNow();
    }
    syncSetlistPanel();
    updateControls();
  }

  function goTo(i: number): void {
    const slug = setlist?.items[i];
    if (!slug) return;
    if (!socket.send({ type: "navigate", slug, index: i })) {
      toast("Not connected; try again in a moment");
      return;
    }
    currentSlug = slug;
    currentIndex = i;
    chorusOn = false;
    lastHostPosition = null;
    markBroadcast(null);
    closeDialog(setlistDialog);
    updateControls();
    window.scrollTo({ top: 0 });
    void loadQasida(slug).then(() => {
      tracker?.reset();
      tracker?.emitNow();
    });
  }

  function step(delta: number): void {
    if (!setlist) return;
    const from = currentIndex ?? (currentSlug ? indexFallback(currentSlug) : null) ?? -1;
    goTo(from + delta);
  }

  el<HTMLButtonElement>("live-now-main").addEventListener("click", openMenu);
  el<HTMLButtonElement>("live-prev").addEventListener("click", () => step(-1));
  el<HTMLButtonElement>("live-next").addEventListener("click", () => step(1));
  el<HTMLButtonElement>("live-chorus").addEventListener("click", () => {
    const on = !chorusOn;
    if (!socket.send({ type: "chorus", on })) {
      toast("Not connected; try again in a moment");
      return;
    }
    chorusOn = on;
    applyChorus();
  });
  el<HTMLButtonElement>("live-follow-me").addEventListener("click", () => {
    socket.send({ type: "follow-me" });
  });
  el<HTMLButtonElement>("live-end-event").addEventListener("click", () => {
    if (confirm("End the event for everyone?")) socket.send({ type: "end-event" });
  });

  // ----- follower actions -----

  el<HTMLButtonElement>("live-jump").addEventListener("click", () => void jumpToHost());

  async function jumpToHost(): Promise<void> {
    if (currentSlug && renderedSlug !== currentSlug) {
      scroller.reattach();
      const rendered = await loadQasida(currentSlug);
      if (rendered && lastHostPosition) scroller.jumpTo(lastHostPosition);
    } else {
      scroller.jumpToHost();
    }
    updateFollowState();
  }

  el<HTMLButtonElement>("live-download-setlist").addEventListener("click", () => {
    if (setlist) {
      store.saveSetlist(setlist);
      toast(`Saved setlist "${setlist.name}"`);
    }
  });
  const shareRoom = el<HTMLButtonElement>("live-share-room");
  shareRoom.addEventListener("click", () => {
    void copyText(location.href, `Join live room ${room}`).then((result) => {
      if (result === "copied") {
        swapIconBriefly(shareRoom, "check");
        toast("Invite link copied");
      } else if (result === "failed") {
        toast(`Could not copy. The code is ${room}`);
      }
    });
  });
  el<HTMLButtonElement>("live-leave").addEventListener("click", () => {
    closeMenu();
    restoreRoomName();
    document.body.classList.remove("live-event-active");
    socket.stop();
    void wakeLock?.release().catch(() => {});
    location.search = "";
  });

  window.addEventListener(
    "resize",
    debounce(() => {
      measureHeader();
      fitTitle();
    }, 150),
    { passive: true },
  );
  window.addEventListener(
    "scroll",
    debounce(() => {
      if (!el<HTMLButtonElement>("live-jump").hidden) updateJumpDirection();
    }, 200),
    { passive: true },
  );

  // A display-settings toggle reflows the page without any scroll event;
  // re-derive the leader's position when the sidebar settings change.
  document.addEventListener("change", (event) => {
    if ((event.target as HTMLElement | null)?.closest?.(".settings-box, #chorus-toggle")) {
      tracker?.emitNow();
    }
  });

  // Delegated: the toggle is re-created with every rendered qasida.
  versesRoot.addEventListener("change", (event) => {
    if (settingPanel || isLeader()) return;
    if ((event.target as HTMLElement | null)?.id !== "chorus-toggle") return;
    dispatchPanel({ type: "toggle" });
  });

  let wakeLock: WakeLockSentinel | null = null;
  async function acquireWakeLock(): Promise<void> {
    if (!("wakeLock" in navigator)) return;
    await wakeLock?.release().catch(() => {});
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      // Denied (battery saver, unsupported): following still works while the
      // screen stays on by itself.
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void acquireWakeLock();
  });
  void acquireWakeLock();

  updateControls();
  socket.connect();

  index = await fetchIndex(ctx.indexUrl);
  for (const q of index) {
    titles.set(q.slug, shortTitle(q.title));
    pageUrls.set(q.slug, q.url);
  }
  setlistEditor.setIndex(index);
  updateNow();
}
