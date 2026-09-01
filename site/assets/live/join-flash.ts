export interface JoinFlash {
  count: number;
  shownAt: number;
}

// Returns the flash to display after a join at `now`: joins within `windowMs`
// of the current flash add to its count; otherwise a fresh flash starts.
export function coalesceJoin(current: JoinFlash | null, now: number, windowMs = 1500): JoinFlash {
  if (current && now - current.shownAt <= windowMs) {
    return { count: current.count + 1, shownAt: current.shownAt };
  }
  return { count: 1, shownAt: now };
}

export function joinMessage(count: number): string {
  return count === 1 ? "1 person joined" : `${count} people joined`;
}
