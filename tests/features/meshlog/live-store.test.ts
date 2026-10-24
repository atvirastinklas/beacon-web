import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MeshlogLiveStore } from "../../../src/features/meshlog/live-store";
import { buildLiveMeshlogData, meshlogTime } from "../../../src/features/meshlog/live-data";
import { packetPathsToFeatures } from "../../../src/features/map/packet-path";
import { shortNodeKey } from "../../../src/features/meshlog/short-node-key";
import { liveMessage, liveNode, liveObservation, heardAt, historySummary, historyDetail } from "./live-fixtures";
import { observerPublicKeys } from "./live-fixtures";
import { PayloadType, PAYLOAD_TYPE_NAMES, type PayloadTypeValue } from "../../../src/types/enums";
import { PACKET_FLOW_MAX } from "../../../src/features/map/types";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const flush = () => vi.advanceTimersByTime(20);
const metadata = { nodes: [liveNode], observers: [], channels: [] };

it("keeps real epoch timestamps distinct from missing or invalid contact times", () => {
  expect(meshlogTime(0)).toBe("00:00:00");
  expect(meshlogTime()).toBe("—");
  expect(meshlogTime(Number.NaN)).toBe("—");
});

it("retains Beacon's canonical summary fields and updates them from actual node events", () => {
  const store = new MeshlogLiveStore();
  const node = { ...liveNode, radio: "868,250,11", defaultScope: "#north", isObserver: true, possiblyForeign: true, knownNeighborCount: 4 };
  store.updateNode({ nodeId: node.id, publicKey: node.publicKey, name: "Live sensor", nodeType: 4, nodeTypeName: "sensor",
    iata: "RIX", iatas: node.iatas, isObserver: true, possiblyForeign: null,
  });
  flush();
  const contact = buildLiveMeshlogData(store.getSnapshot(), { ...metadata, nodes: [node] }, "Unknown").contacts[0]!;
  expect(contact).toMatchObject({ name: "Live sensor", kind: "sensor", node: {
    radio: "868,250,11", defaultScope: "#north", isObserver: true, knownNeighborCount: 4,
  } });
  expect(contact.node!.possiblyForeign).toBeUndefined();
  expect(contact.firstSeenAt).toBeUndefined();
  expect(contact.interval).toBeUndefined();
  expect(contact.battery).toBeUndefined();
});

it("publishes a bounded batch of actual live observations with their matching retained data", () => {
  const store = new MeshlogLiveStore();
  store.mergeHistory([historySummary()]);
  flush();
  expect(store.getSnapshot().liveBatch).toEqual({ sequence: 0, observations: [] });
  for (let index = 0; index < PACKET_FLOW_MAX + 2; index++) store.observe(liveObservation("observer-a", `batch-${index}`));
  expect(store.getSnapshot().liveBatch.sequence).toBe(0);
  flush();
  const snapshot = store.getSnapshot();
  expect(snapshot.liveBatch.sequence).toBe(1);
  expect(snapshot.liveBatch.observations).toHaveLength(PACKET_FLOW_MAX);
  expect(snapshot.liveBatch.observations[0]!.packetHash).toBe("batch-2");
  expect(snapshot.liveBatch.observations.every(event => snapshot.packets.some(packet => packet.hash === event.packetHash))).toBe(true);
  store.hydrate(historyDetail());
  store.mergeHistory([historySummary("older")]);
  flush();
  expect(store.getSnapshot().liveBatch).toBe(snapshot.liveBatch);
  store.observe(liveObservation("observer-b"));
  flush();
  expect(store.getSnapshot().liveBatch).toEqual({ sequence: 2, observations: [liveObservation("observer-b")] });
});

it("drops unflushed animation observations when the live session is disposed", () => {
  const store = new MeshlogLiveStore();
  store.observe(liveObservation());
  store.dispose();
  store.mergeHistory([historySummary()]);
  flush();
  expect(store.getSnapshot().liveBatch).toEqual({ sequence: 0, observations: [] });
});

it.each([...Object.values(PayloadType), 12, 13, 14])("exposes actual wire payload type %i instead of its message category", payloadType => {
  const store = new MeshlogLiveStore();
  const event = liveObservation();
  store.observe({ ...event, packet: { ...event.packet, payloadType,
    payloadTypeName: PAYLOAD_TYPE_NAMES[payloadType as PayloadTypeValue] ?? `TYPE_${payloadType}`,
  } });
  flush();
  expect(buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown").messages[0]!.payloadType).toBe(payloadType);
});

it.each(["live", "history", "detail", "message"] as const)("keeps the actual matched scope from %s data", source => {
  const store = new MeshlogLiveStore();
  if (source === "history" || source === "detail") store.mergeHistory([{ ...historySummary(), scope: source === "history" ? "#RIX" : undefined }]);
  else {
    const event = liveObservation();
    store.observe({ ...event, packet: { ...event.packet, scope: source === "live" ? "#RIX" : undefined } });
  }
  if (source === "detail") store.hydrate({ ...historyDetail(), scope: "#RIX" });
  if (source === "message") store.enrich({ ...liveMessage, scope: "#RIX", scopeStatus: "matched" });
  flush();
  expect(buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown").messages[0]!.scope).toBe("#RIX");
});

it("retains a known history scope when a live report omits it, while preferring an explicit live scope", () => {
  const store = new MeshlogLiveStore();
  store.mergeHistory([{ ...historySummary(), scope: "#history" }]);
  store.observe(liveObservation());
  store.hydrate({ ...historyDetail(), scope: "#detail" });
  flush();
  expect(buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown").messages[0]!.scope).toBe("#history");
  const event = liveObservation("observer-b", "packet-a", heardAt + 5000);
  store.observe({ ...event, packet: { ...event.packet, scope: "#live" } });
  flush();
  expect(buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown").messages[0]!.scope).toBe("#live");
});

it("retains an already matched live scope when another observer report omits scope metadata", () => {
  const store = new MeshlogLiveStore();
  const first = liveObservation();
  store.observe({ ...first, packet: { ...first.packet, scope: "#north" } });
  store.observe(liveObservation("observer-b", "packet-a", heardAt + 100));
  flush();
  expect(buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown").messages[0]!.scope).toBe("#north");
});

it("does not invent packet scopes from channel names or observer memberships", () => {
  const store = new MeshlogLiveStore();
  store.observe(liveObservation());
  store.enrich(liveMessage);
  flush();
  const data = buildLiveMeshlogData(store.getSnapshot(), { ...metadata,
    observers: [{ id: "observer-a", iata: "RIX", status: "online", scopes: ["#not-the-packet-scope"] }],
    channels: [{ id: 1, channelHash: liveMessage.channelHash, name: "#also-not-scope", keyKnown: true, isHashtag: true, lastSeen: heardAt }],
  }, "Unknown");
  expect(data.messages[0]!.scope).toBeUndefined();
});

it("exposes real envelope endpoints for an otherwise unknown originator", () => {
  const store = new MeshlogLiveStore();
  store.mergeHistory([{ ...historySummary(), payloadType: PayloadType.REQUEST, payloadTypeName: "REQ" }]);
  const detail = historyDetail();
  detail.header.payloadType = PayloadType.REQUEST;
  detail.parsedPayload = { type: "REQUEST", sourceHash: "A1", destinationHash: "B2", ciphertext: "0011" };
  detail.observations.forEach(report => { report.resolvedSource = undefined; report.resolvedDestination = undefined; });
  store.hydrate(detail);
  flush();
  expect(buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown").messages[0]).toMatchObject({
    senderName: "Unknown", senderUnknown: true, originator: "a1", target: "b2",
  });
});

it("does not mistake a real node named Unknown for a missing sender", () => {
  const store = new MeshlogLiveStore();
  store.mergeHistory([historySummary()]);
  const detail = historyDetail();
  detail.parsedPayload = undefined;
  detail.observations[0]!.resolvedSource!.nodes[0]!.name = "Unknown";
  store.hydrate(detail);
  flush();
  expect(buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown").messages[0]).toMatchObject({
    senderName: "Unknown", senderUnknown: false, originator: liveNode.publicKey,
  });
});

it("groups channels by the backend's known-key flag, including packet-only hashes", () => {
  const store = new MeshlogLiveStore();
  store.observe(liveObservation());
  store.enrich(liveMessage);
  flush();
  const data = buildLiveMeshlogData(store.getSnapshot(), { ...metadata, channels: [
    { id: 1, channelHash: "AA", name: "ab", keyKnown: true, isHashtag: true, lastSeen: heardAt },
    { id: 2, channelHash: "BB", name: "Named without key", keyKnown: false, isHashtag: false, lastSeen: heardAt },
    { id: 3, channelHash: "CC", name: null, keyKnown: true, isHashtag: false, lastSeen: heardAt },
  ] }, "Unknown");
  expect(data.channels).toEqual([
    { id: "aa", name: "ab", keyKnown: true },
    { id: "bb", name: "Named without key", keyKnown: false },
    { id: "cc", name: "CC", keyKnown: true },
    { id: "channel-a", name: "channel-a", keyKnown: false },
  ]);
});

it("keeps a packet-only channel's identity when its known metadata arrives", () => {
  const store = new MeshlogLiveStore();
  store.observe(liveObservation());
  store.enrich(liveMessage);
  flush();
  const initial = buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown");
  expect(initial.channels).toEqual([{ id: "channel-a", name: "channel-a", keyKnown: false }]);
  const updated = buildLiveMeshlogData(store.getSnapshot(), { ...metadata, channels: [
    { id: 1, channelHash: "CHANNEL-A", name: "Community", keyKnown: true, isHashtag: true, lastSeen: heardAt },
  ] }, "Unknown");
  expect(updated.channels).toEqual([{ id: "channel-a", name: "Community", keyKnown: true }]);
  expect(updated.messages[0]).toMatchObject({ channelId: "channel-a", channel: "Community" });
});

it("batches packets while retaining independent reports and the latest observation per observer", () => {
  const store = new MeshlogLiveStore();
  const notify = vi.fn();
  store.subscribe(notify);
  store.observe(liveObservation());
  store.observe(liveObservation("observer-b", "packet-a", heardAt + 100));
  store.observe(liveObservation("observer-a", "packet-a", heardAt - 10));
  expect(store.getSnapshot().packets).toHaveLength(0);
  flush();
  expect(notify).toHaveBeenCalledTimes(1);
  const packet = store.getSnapshot().packets[0]!;
  expect(packet.firstHeardAt).toBe(heardAt - 10);
  expect(packet.reports.size).toBe(2);
  expect(packet.reports.get("observer-a")!.heardAt).toBe(heardAt);
});

it("joins channel text in either order without making channel-only events into visible packets", () => {
  const store = new MeshlogLiveStore();
  store.enrich(liveMessage);
  flush();
  expect(store.getSnapshot().packets).toHaveLength(0);
  store.observe(liveObservation());
  flush();
  expect(store.getSnapshot().packets[0]!.message).toEqual(liveMessage);
  store.observe(liveObservation("observer-b", "packet-b"));
  store.enrich({ ...liveMessage, packetHash: "PACKET-B", content: "Second" });
  flush();
  expect(store.getSnapshot().packets.find(packet => packet.hash === "packet-b")!.message?.content).toBe("Second");
});

it("retains accumulated history and live traffic while bounding the unmatched message cache", () => {
  const store = new MeshlogLiveStore();
  for (let index = 0; index < 105; index++) {
    store.observe(liveObservation("observer-a", `packet-${index}`, heardAt + index));
    store.enrich({ ...liveMessage, packetHash: `pending-${index}` });
  }
  flush();
  expect(store.getSnapshot().packets).toHaveLength(105);
  expect(store.getSnapshot().packets[0]!.hash).toBe("packet-104");
  expect(store.getSnapshot().packets.some(packet => packet.hash === "packet-0")).toBe(true);
  store.observe(liveObservation("observer-a", "pending-0", heardAt + 200));
  flush();
  expect(store.getSnapshot().packets[0]!.message).toBeUndefined();
});

it("merges late history and details without replacing live reports or duplicating packets", () => {
  const store = new MeshlogLiveStore();
  store.observe(liveObservation("observer-b", "PACKET-A", heardAt + 100));
  store.mergeHistory([historySummary(), historySummary("older", heardAt - 1000)]);
  store.hydrate(historyDetail());
  flush();
  const data = buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown");
  expect(data.messages).toHaveLength(2);
  expect(data.messages.map(message => message.id)).toEqual(["packet-a", "older"]);
  expect(data.messages[0]!.text).toBe(liveMessage.content);
  expect(data.messages[0]!.reports.map(report => report.reporterId)).toEqual(["observer-a", "observer-b"]);
  expect(data.paths.map(path => path.key)).toEqual(["packet-a:observer-a", "packet-a:observer-b"]);
  expect(store.getSnapshot().packets[0]!.lastHeardAt).toBe(heardAt + 100);
});

it("keeps separate historical routes for one observer under its single path control", () => {
  const store = new MeshlogLiveStore();
  store.mergeHistory([historySummary()]);
  const detail = historyDetail("packet-a", ["observer-a", "observer-a"]);
  detail.observations[1]!.resolvedPath[0]!.nodes[0]!.longitude = 24.2;
  store.hydrate(detail);
  flush();
  const data = buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown");
  expect(data.messages[0]!.reports).toHaveLength(1);
  expect(data.paths).toHaveLength(2);
  expect(data.paths.map(path => path.key)).toEqual(["packet-a:observer-a", "packet-a:observer-a"]);
  expect(data.paths[0]!.points[1]!.lng).not.toBe(data.paths[1]!.points[1]!.lng);
});

it("shows summary-only history without inventing observation times or radio identities", () => {
  const store = new MeshlogLiveStore();
  store.mergeHistory([historySummary()]);
  flush();
  const data = buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown");
  expect(data.messages[0]).toMatchObject({ reportsPending: true, senderName: "Unknown", reports: [{ reporterId: "observer-a", time: "—", pathUnavailable: true }] });
  expect(data.paths).toHaveLength(0);
  expect(data.contacts[0]).toMatchObject({ id: "source-node", publicKey: "0123456789abcdef" });
});

it("limits historical detail observations to the selected region without mutating the cached detail", () => {
  const store = new MeshlogLiveStore();
  store.mergeHistory([historySummary()]);
  const detail = historyDetail("packet-a", ["observer-a", "outside"]);
  detail.observations[1]!.iata = "OTHER";
  store.hydrate(detail);
  flush();
  const data = buildLiveMeshlogData(store.getSnapshot(), { ...metadata, iatas: ["RIX"] }, "Unknown");
  expect(data.messages[0]!.reports.map(report => report.reporterId)).toEqual(["observer-a"]);
  expect(data.paths).toHaveLength(1);
  expect(data.reporters.some(reporter => reporter.id === "outside")).toBe(false);
  expect(detail.observations).toHaveLength(2);
});

it("preserves explicit location clears across later omitted-coordinate updates", () => {
  const store = new MeshlogLiveStore();
  const update = { nodeId: liveNode.id, publicKey: liveNode.publicKey, name: liveNode.name!, nodeType: 1,
    nodeTypeName: "Companion", iata: "RIX", isObserver: false, iatas: liveNode.iatas };
  store.updateNode({ ...update, lat: null, lng: null });
  store.updateNode({ ...update, name: "Renamed" });
  flush();
  const data = buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown");
  expect(data.contacts[0]).toMatchObject({ name: "Renamed", position: null, firstSeen: "—" });
  expect(data.contacts[0]!.reporterIds).toBeUndefined();
});

it("uses only real resolved observation geometry with stable observer identity colors", () => {
  const store = new MeshlogLiveStore();
  store.observe(liveObservation());
  store.observe(liveObservation("observer-b"));
  store.enrich(liveMessage);
  flush();
  const data = buildLiveMeshlogData(store.getSnapshot(), { ...metadata, channels: [{ id: 1, channelHash: "channel-a", name: "Community", lastSeen: heardAt, keyKnown: true, isHashtag: true }] }, "Unknown");
  expect(data.messages[0]).toMatchObject({ senderId: liveNode.id, senderName: "Live Walker", text: "Hello from live mode", channelId: "channel-a", channel: "Community", kind: "channel" });
  expect(data.paths.map(path => path.key)).toEqual(["packet-a:observer-a", "packet-a:observer-b"]);
  expect(data.paths[0]!.points.map(point => [point.lng, point.lat])).toEqual([[24.087, 56.943], [24.105, 56.951], [24.112, 56.955]]);
  expect(data.paths[0]!.color).toBe(data.reporters.find(observer => observer.id === "observer-a")!.color);
  store.observe(liveObservation("observer-b", "packet-b"));
  flush();
  const updated = buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown");
  expect(updated.paths.find(path => path.key === "packet-b:observer-b")!.color).toBe(data.paths[1]!.color);
});

it("keeps unknown identities/types visible and never maps ambiguous, all-gapped or unsupported trace routes", () => {
  const store = new MeshlogLiveStore();
  const unknown = liveObservation();
  unknown.packet.payloadType = 15;
  unknown.packet.payloadTypeName = "CUSTOM";
  unknown.observation.resolvedSource = null;
  unknown.observation.resolvedPath = null;
  unknown.observation.resolvedDestination = null;
  store.observe(unknown);
  const gapped = liveObservation("observer-b", "gapped");
  gapped.observation.resolvedPath = [{ confidence: "none", nodes: [] }];
  store.observe(gapped);
  const trace = liveObservation("observer-b", "trace");
  trace.packet.payloadType = 9;
  store.observe(trace);
  flush();
  const data = buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown");
  expect(data.messages.find(message => message.id === "packet-a")).toMatchObject({ senderName: "Unknown", kind: "other", typeLabel: "CUSTOM" });
  expect(data.messages.find(message => message.id === "packet-a")!.reports[0]!.pathUnavailable).toBe(true);
  expect(data.paths).toHaveLength(0);

  const partial = liveObservation("observer-a", "partial");
  partial.observation.resolvedPath!.push({ confidence: "none", nodes: [] });
  store.observe(partial);
  flush();
  const paths = buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown").paths;
  expect(packetPathsToFeatures(paths, null).lines.features[0]!.geometry.coordinates).toEqual([[24.087, 56.943], [24.105, 56.951]]);
});

it("publishes gap notices and cancels pending work on cleanup", () => {
  const store = new MeshlogLiveStore();
  store.noteGap();
  flush();
  expect(store.getSnapshot().gap).toBe(true);
  store.observe(liveObservation());
  store.dispose();
  flush();
  expect(store.getSnapshot().packets).toHaveLength(0);
});

it.each([1, 2, 3] as const)("uses the observed %i-byte radio hash width without exposing internal node IDs", size => {
  const store = new MeshlogLiveStore();
  const relay = { ...liveNode, id: "internal-relay-uuid", publicKey: "aabbccddeeff0011", name: null };
  const event = liveObservation();
  event.observation.pathLength!.hashSize = size;
  event.observation.resolvedPath![0]!.hashBytes = relay.publicKey.slice(0, size * 2);
  event.observation.resolvedPath![0]!.nodes = [{ id: relay.id, publicKey: relay.publicKey, latitude: relay.lat!, longitude: relay.lng! }];
  store.observe(event);
  flush();
  const data = buildLiveMeshlogData(store.getSnapshot(), { ...metadata, nodes: [liveNode, relay] }, "Unknown");
  const contact = data.contacts.find(contact => contact.id === relay.id)!;
  expect(contact.hashSize).toBe(size);
  expect(contact.name).toBe(relay.publicKey.slice(0, size * 2));
  expect(shortNodeKey(contact.publicKey, contact.hashSize)).toBe(relay.publicKey.slice(0, size * 2));
  expect(data.messages[0]!.reports[0]!.path).toEqual([relay.publicKey.slice(0, size * 2)]);
  expect(data.paths[0]!.points[1]!.name).toBe(relay.publicKey.slice(0, size * 2));
  expect(data.contacts.find(contact => contact.id === liveNode.id)!.hashSize).toBeUndefined();
});

it("renders observer radio prefixes at each report's width and preserves descriptive metadata", () => {
  const store = new MeshlogLiveStore();
  const first = liveObservation();
  first.observation.observerPublicKey = observerPublicKeys["observer-a"];
  first.observation.pathBytes = "77";
  first.observation.resolvedPath = null;
  store.observe(first);
  const second = liveObservation("observer-a", "packet-b", heardAt + 1000);
  second.observation.pathLength!.hashSize = 3;
  second.observation.pathBytes = "112233";
  second.observation.resolvedPath = null;
  store.observe(second);
  flush();
  const data = buildLiveMeshlogData(store.getSnapshot(), { ...metadata,
    observers: [{ id: "observer-a", displayName: "Full observer name", iata: "RIX", observerType: "repeater", status: "online" }],
  }, "Unknown");
  expect(data.reporters[0]).toMatchObject({ name: "Full observer name", code: "a1b2c3", publicKey: observerPublicKeys["observer-a"], iata: "RIX", observerType: "repeater", status: "online" });
  expect(data.messages.find(message => message.id === "packet-a")!.reports[0]).toMatchObject({ observerCode: "a1", path: ["77"], pathUnavailable: false });
  expect(data.messages.find(message => message.id === "packet-b")!.reports[0]).toMatchObject({ observerCode: "a1b2c3", path: ["112233"], pathUnavailable: false });
  expect(data.paths).toHaveLength(0); // Readable codes must not invent geometry across unresolved relay hops.
});

it("uses only an explicit node-to-observer association to resolve a directory radio key", () => {
  const store = new MeshlogLiveStore();
  store.observe(liveObservation());
  flush();
  const data = buildLiveMeshlogData(store.getSnapshot(), { ...metadata,
    nodes: [{ ...liveNode, id: "observer-node", publicKey: observerPublicKeys["observer-a"]!, observerId: "observer-a", isObserver: true }],
  }, "Unknown");
  expect(data.reporters[0]).toMatchObject({ publicKey: observerPublicKeys["observer-a"], code: "a1" });
});
