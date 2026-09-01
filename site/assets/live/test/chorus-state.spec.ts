import { describe, expect, it } from "vitest";
import { chorusPanel, initialChorusPanel, type ChorusPanelEvent, type ChorusPanelState } from "../chorus-state";

const on: ChorusPanelEvent = { type: "host", on: true };
const off: ChorusPanelEvent = { type: "host", on: false };
const toggle: ChorusPanelEvent = { type: "toggle" };

function run(...events: ChorusPanelEvent[]): ChorusPanelState {
  return events.reduce(chorusPanel, initialChorusPanel);
}

describe("chorusPanel", () => {
  it("host on opens a closed panel and marks it opened by the host", () => {
    expect(run(on)).toEqual({ hostOn: true, panelOpen: true, openedByHost: true });
  });

  it("host on leaves a panel the follower already opened open and theirs", () => {
    expect(run(toggle, on)).toEqual({ hostOn: true, panelOpen: true, openedByHost: false });
  });

  it("host on while already on changes nothing", () => {
    const state = run(on);
    expect(chorusPanel(state, on)).toBe(state);
  });

  it("host off closes a panel the host opened", () => {
    expect(run(on, off)).toEqual(initialChorusPanel);
  });

  it("host off while already off keeps a closed panel closed", () => {
    expect(run(off)).toEqual(initialChorusPanel);
  });

  it("host off keeps a panel the follower opened", () => {
    expect(run(toggle, off)).toEqual({ hostOn: false, panelOpen: true, openedByHost: false });
  });

  it("toggle flips the panel and clears openedByHost without touching hostOn", () => {
    expect(run(on, toggle)).toEqual({ hostOn: true, panelOpen: false, openedByHost: false });
    expect(run(on, toggle, toggle)).toEqual({ hostOn: true, panelOpen: true, openedByHost: false });
  });

  it("reconnecting mid-chorus opens the panel from the snapshot", () => {
    expect(chorusPanel(initialChorusPanel, on)).toEqual({ hostOn: true, panelOpen: true, openedByHost: true });
  });

  it("a follower who closed it while on gets it reopened on the next off-to-on", () => {
    const closed = run(on, toggle);
    const afterOff = chorusPanel(closed, off);
    expect(afterOff.panelOpen).toBe(false);
    expect(chorusPanel(afterOff, on)).toEqual({ hostOn: true, panelOpen: true, openedByHost: true });
  });

  it("a panel the follower opened before the host's chorus stays open after it ends", () => {
    expect(run(toggle, on, off)).toEqual({ hostOn: false, panelOpen: true, openedByHost: false });
  });

  it("a panel the follower reopened during the chorus stays open after it ends", () => {
    expect(run(on, toggle, toggle, off)).toEqual({ hostOn: false, panelOpen: true, openedByHost: false });
  });

  it("a duplicate host on after the follower closed it does not reopen it", () => {
    expect(run(on, toggle, on)).toEqual({ hostOn: true, panelOpen: false, openedByHost: false });
  });
});
