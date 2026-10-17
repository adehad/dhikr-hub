import { isNonEmptyString, isSetlist } from "./messages";
import type { Setlist } from "./messages";
import * as recent from "./recent-rooms";
import type { RecentRoom } from "./recent-rooms";

export interface Identity {
  id: string; // full secret, never rendered except the transfer screen
  publicId: string | null; // known after first registration
  name: string;
}

interface Blob {
  identity: Identity | null;
  trusted: string[];
  setlists: Setlist[];
  recentRooms: RecentRoom[];
}

// Whole-blob last-write-wins: a second tab writing this key clobbers
// concurrent changes from the first. Accepted for a best-effort local cache.
const KEY = "dhikr-hub-live";

function isIdentity(v: unknown): v is Identity {
  if (typeof v !== "object" || v === null) return false;
  const i = v as { id?: unknown; publicId?: unknown; name?: unknown };
  return (
    isNonEmptyString(i.id) &&
    (i.publicId === null || isNonEmptyString(i.publicId)) &&
    isNonEmptyString(i.name)
  );
}

function emptyBlob(): Blob {
  return { identity: null, trusted: [], setlists: [], recentRooms: [] };
}

export class LiveStore {
  // Holds the identity for the page's life when localStorage refuses writes,
  // so every caller sees the same id instead of a fresh one per call.
  private memoryIdentity: Identity | null = null;

  constructor(private ls: Storage) {}

  private read(): Blob {
    const blob = this.readStored();
    if (this.memoryIdentity) blob.identity = this.memoryIdentity;
    return blob;
  }

  private readStored(): Blob {
    try {
      const raw = this.ls.getItem(KEY);
      if (!raw) return emptyBlob();
      const parsed = JSON.parse(raw) as Partial<Blob>;
      return {
        identity: isIdentity(parsed.identity) ? parsed.identity : null,
        trusted: Array.isArray(parsed.trusted) ? parsed.trusted.filter(isNonEmptyString) : [],
        setlists: Array.isArray(parsed.setlists) ? parsed.setlists.filter(isSetlist) : [],
        recentRooms: Array.isArray(parsed.recentRooms)
          ? parsed.recentRooms.filter(recent.isRecentRoom).slice(0, recent.RECENT_LIMIT)
          : [],
      };
    } catch {
      return emptyBlob();
    }
  }

  private write(blob: Blob): boolean {
    try {
      this.ls.setItem(KEY, JSON.stringify(blob));
      return true;
    } catch {
      // Quota or private-mode failure: run without persistence.
      return false;
    }
  }

  private writeIdentity(blob: Blob, identity: Identity): void {
    blob.identity = identity;
    this.memoryIdentity = this.write(blob) ? null : identity;
  }

  ensureIdentity(): Identity {
    const blob = this.read();
    if (blob.identity) return blob.identity;
    const identity: Identity = { id: crypto.randomUUID(), publicId: null, name: "Listener" };
    this.writeIdentity(blob, identity);
    return identity;
  }

  updateIdentity(patch: Partial<Identity>): Identity {
    const blob = this.read();
    const base: Identity =
      blob.identity ?? { id: crypto.randomUUID(), publicId: null, name: "Listener" };
    const identity = { ...base, ...patch };
    this.writeIdentity(blob, identity);
    return identity;
  }

  adoptIdentity(fullId: string, name: string, publicId: string): void {
    const blob = this.read();
    this.writeIdentity(blob, { id: fullId, publicId, name });
  }

  isTrusted(publicId: string): boolean {
    return this.read().trusted.includes(publicId);
  }

  setTrusted(publicId: string, trusted: boolean): void {
    const blob = this.read();
    const set = new Set(blob.trusted);
    if (trusted) set.add(publicId);
    else set.delete(publicId);
    blob.trusted = [...set];
    this.write(blob);
  }

  setlists(): Setlist[] {
    return this.read()
      .setlists.slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  saveSetlist(setlist: Setlist): void {
    const blob = this.read();
    blob.setlists = [setlist, ...blob.setlists.filter((s) => s.id !== setlist.id)];
    this.write(blob);
  }

  deleteSetlist(id: string): void {
    const blob = this.read();
    blob.setlists = blob.setlists.filter((s) => s.id !== id);
    this.write(blob);
  }

  recentRooms(): RecentRoom[] {
    return this.read().recentRooms;
  }

  rememberRoom(room: RecentRoom): void {
    const blob = this.read();
    blob.recentRooms = recent.rememberRoom(blob.recentRooms, room);
    this.write(blob);
  }

  forgetRoom(code: string): void {
    const blob = this.read();
    blob.recentRooms = recent.forgetRoom(blob.recentRooms, code);
    this.write(blob);
  }
}
