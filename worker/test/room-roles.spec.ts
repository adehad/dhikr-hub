import { describe, expect, it } from "vitest";
import { createRoom, join, nextMessage } from "./helpers";

const HOST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COHOST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PEER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("roles and relay", () => {
  it("listener position is rejected, not relayed", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    await join(room, HOST_ID, "Ahmad");
    const peer = await join(room, PEER_ID, "Listener");
    const reply = nextMessage(peer.ws);
    peer.ws.send(JSON.stringify({ type: "position", position: { section: "verses", group: 1 } }));
    const msg = await reply;
    expect(msg.type).toBe("error");
  });

  it("host position relays to peers and lands in late-joiner snapshot", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    const peer = await join(room, PEER_ID, "Listener");
    const relayed = nextMessage(peer.ws);
    host.ws.send(JSON.stringify({ type: "navigate", slug: "qamarun" }));
    const nav = await relayed;
    expect(nav).toMatchObject({ type: "navigate", slug: "qamarun" });

    const late = await join(room, COHOST_ID, "Late");
    expect(late.snapshot.currentSlug).toBe("qamarun");
  });

  it("late joiner gets the host's last position even when it landed inside the write throttle", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    const peer = await join(room, PEER_ID, "Listener");
    host.ws.send(JSON.stringify({ type: "position", position: { section: "verses", group: 0 } }));
    host.ws.send(JSON.stringify({ type: "position", position: { section: "verses", group: 1 } }));
    expect(await nextMessage(peer.ws)).toMatchObject({ position: { group: 0 } });
    expect(await nextMessage(peer.ws)).toMatchObject({ position: { group: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const late = await join(room, COHOST_ID, "Late");
    expect(late.snapshot.position).toEqual({ section: "verses", group: 1 });
  });

  it("promote makes a peer a host; follow-me moves the baton", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    // co joining broadcasts peer-joined to the host; drain it so it isn't
    // mistaken for a later broadcast on the host's socket.
    const peerJoinedAtHost = nextMessage(host.ws);
    const co = await join(room, COHOST_ID, "Laptop");
    expect((await peerJoinedAtHost).type).toBe("peer-joined");

    const hostsAtCo = nextMessage(co.ws);
    // promote's "hosts" broadcast also lands on the sending host's own socket;
    // drain it here so it isn't mistaken for the later follow-me broadcast.
    const hostsAtHostFromPromote = nextMessage(host.ws);
    host.ws.send(JSON.stringify({ type: "promote", target: co.snapshot.you }));
    const hostsMsg = await hostsAtCo;
    expect(hostsMsg).toMatchObject({ type: "hosts" });
    expect((hostsMsg as { hosts: string[] }).hosts).toContain(co.snapshot.you);
    expect(await hostsAtHostFromPromote).toMatchObject({ type: "hosts" });

    const batonAtHost = nextMessage(host.ws);
    co.ws.send(JSON.stringify({ type: "follow-me" }));
    const baton = await batonAtHost;
    expect(baton).toMatchObject({ type: "hosts", leader: co.snapshot.you });
  });

  it("promote from a non-host is rejected", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    await join(room, HOST_ID, "Ahmad");
    const peer = await join(room, PEER_ID, "Listener");
    const reply = nextMessage(peer.ws);
    peer.ws.send(JSON.stringify({ type: "promote", target: peer.snapshot.you }));
    expect((await reply).type).toBe("error");
  });

  it("non-leader host cannot broadcast until follow-me", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    const co = await join(room, COHOST_ID, "Laptop");
    expect((await nextMessage(host.ws)).type).toBe("peer-joined");

    host.ws.send(JSON.stringify({ type: "promote", target: co.snapshot.you }));
    expect((await nextMessage(co.ws)).type).toBe("hosts");
    expect((await nextMessage(host.ws)).type).toBe("hosts");

    co.ws.send(JSON.stringify({ type: "position", position: { section: "verses", group: 0 } }));
    expect(await nextMessage(co.ws)).toMatchObject({ type: "error", code: "not-leader" });

    co.ws.send(JSON.stringify({ type: "follow-me" }));
    expect(await nextMessage(co.ws)).toMatchObject({ type: "hosts", leader: co.snapshot.you });
    expect(await nextMessage(host.ws)).toMatchObject({ type: "hosts", leader: co.snapshot.you });

    co.ws.send(JSON.stringify({ type: "position", position: { section: "verses", group: 1 } }));
    expect(await nextMessage(host.ws)).toMatchObject({
      type: "position",
      position: { section: "verses", group: 1 },
    });
  });

  it("end-event from a non-host is rejected", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    await join(room, HOST_ID, "Ahmad");
    const peer = await join(room, PEER_ID, "Listener");
    peer.ws.send(JSON.stringify({ type: "end-event" }));
    expect(await nextMessage(peer.ws)).toMatchObject({ type: "error", code: "not-host" });
  });

  it("promote of an absent target is rejected", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    host.ws.send(JSON.stringify({ type: "promote", target: "not-in-room" }));
    expect(await nextMessage(host.ws)).toMatchObject({ type: "error", code: "unknown-target" });
  });

  it("end-event closes everyone and the room stops accepting joins", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    const peer = await join(room, PEER_ID, "Listener");
    const endedAtPeer = nextMessage(peer.ws);
    host.ws.send(JSON.stringify({ type: "end-event" }));
    expect((await endedAtPeer).type).toBe("ended");

    const { SELF } = await import("cloudflare:test");
    const res = await SELF.fetch(`https://example.com/api/live/room/${room}/ws`, {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const closed = new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve));
    ws.accept();
    expect((await closed).code).toBe(4004);
  });
});

describe("setlist index and chorus state", () => {
  it("navigate relays the index and the snapshot carries it for late joiners", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    const peer = await join(room, PEER_ID, "Listener");
    const relayed = nextMessage(peer.ws);
    host.ws.send(JSON.stringify({ type: "navigate", slug: "qamarun", index: 2 }));
    expect(await relayed).toMatchObject({ type: "navigate", slug: "qamarun", index: 2 });

    const late = await join(room, COHOST_ID, "Late");
    expect(late.snapshot.currentSlug).toBe("qamarun");
    expect(late.snapshot.currentIndex).toBe(2);
    expect(late.snapshot.chorus).toBe(false);
  });

  it("chorus on is relayed, snapshotted, and cleared by the next navigate", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    const peer = await join(room, PEER_ID, "Listener");
    const relayed = nextMessage(peer.ws);
    host.ws.send(JSON.stringify({ type: "chorus", on: true }));
    expect(await relayed).toMatchObject({ type: "chorus", on: true });

    const during = await join(room, COHOST_ID, "During");
    expect(during.snapshot.chorus).toBe(true);
    expect((await nextMessage(peer.ws)).type).toBe("peer-joined");

    host.ws.send(JSON.stringify({ type: "navigate", slug: "qamarun", index: 0 }));
    expect(await nextMessage(peer.ws)).toMatchObject({ type: "navigate" });
    const after = await join(room, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "After");
    expect(after.snapshot.chorus).toBe(false);
  });

  it("a legacy chorus message without a flag relays as on", async () => {
    const room = await createRoom(HOST_ID, "Ahmad");
    const host = await join(room, HOST_ID, "Ahmad");
    const peer = await join(room, PEER_ID, "Listener");
    const relayed = nextMessage(peer.ws);
    host.ws.send(JSON.stringify({ type: "chorus" }));
    expect(await relayed).toMatchObject({ type: "chorus", on: true });
  });
});
