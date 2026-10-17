// A follower's chorus panel: the host's chorus opens it once per off-to-on
// edge, and only a panel the host opened closes again when the host stops.
export interface ChorusPanelState {
  hostOn: boolean;
  panelOpen: boolean;
  openedByHost: boolean;
}

export type ChorusPanelEvent =
  | { type: "host"; on: boolean }
  | { type: "toggle" };

export const initialChorusPanel: ChorusPanelState = { hostOn: false, panelOpen: false, openedByHost: false };

export function chorusPanel(state: ChorusPanelState, event: ChorusPanelEvent): ChorusPanelState {
  if (event.type === "toggle") {
    return { ...state, panelOpen: !state.panelOpen, openedByHost: false };
  }
  if (event.on) {
    // Snapshots repeat the current state; only a rising edge may reopen a
    // panel the follower closed.
    if (state.hostOn) return state;
    return { hostOn: true, panelOpen: true, openedByHost: !state.panelOpen };
  }
  return {
    hostOn: false,
    panelOpen: state.panelOpen && !state.openedByHost,
    openedByHost: false,
  };
}
