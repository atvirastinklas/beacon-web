import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMeshlogDataBuilder, buildLiveMeshlogData } from "../../../src/features/meshlog/live-data";
import { MeshlogLiveStore } from "../../../src/features/meshlog/live-store";
import * as pathModule from "../../../src/features/map/packet-path";
import { heardAt, historyDetail, liveMessage, liveNode, liveObservation, liveObserver } from "./live-fixtures";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const flush = () => vi.advanceTimersByTime(20);
const metadata = { nodes: [liveNode], observers: [liveObserver()], channels: [] };

it("reuses unchanged packet geometry across status/directory updates without freezing metadata", () => {
  const paths = vi.spyOn(pathModule, "buildPacketPaths");
  const build = createMeshlogDataBuilder();
  const store = new MeshlogLiveStore();
  store.observe(liveObservation());
  store.observe(liveObservation("observer-b", "packet-b"));
  flush();
  const initial = build(store.getSnapshot(), metadata, "Unknown");
  expect(paths).toHaveBeenCalledTimes(2);
  paths.mockClear();
  store.updateObserver({ observerId: "observer-a", displayName: "Renamed receiver", online: false, iata: "RIX" });
  store.updateNode({ nodeId: liveNode.id, ...liveNode, iata: "RIX", isObserver: true });
  flush();
  const status = build(store.getSnapshot(), metadata, "Unknown");
  expect(paths).not.toHaveBeenCalled();
  expect(status.paths[0]!.label).toBe("Renamed receiver");
  expect(status.paths[0]!.points).toBe(initial.paths[0]!.points);
  expect(status.contacts[0]!.node?.isObserver).toBe(true);
  expect(status).toEqual(buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown"));
  paths.mockClear();
  const changedDirectory = { ...metadata, channels: [{ channelHash: liveMessage.channelHash, name: "Renamed channel", keyKnown: true }] };
  const directory = build(store.getSnapshot(), changedDirectory, "Unknown");
  expect(paths).not.toHaveBeenCalled();
  expect(directory.channels[0]!.name).toBe("Renamed channel");
  expect(directory).toEqual(buildLiveMeshlogData(store.getSnapshot(), changedDirectory, "Unknown"));
});

it("recomputes only changed packets for live observations, hydration, and channel enrichment", () => {
  const paths = vi.spyOn(pathModule, "buildPacketPaths");
  const build = createMeshlogDataBuilder();
  const store = new MeshlogLiveStore();
  store.observe(liveObservation());
  store.observe(liveObservation("observer-b", "packet-b"));
  flush();
  build(store.getSnapshot(), metadata, "Unknown");
  for (const update of [
    () => store.observe(liveObservation("observer-b", "packet-a", heardAt + 1000)),
    () => store.hydrate(historyDetail()),
    () => store.enrich(liveMessage),
  ]) {
    paths.mockClear();
    update(); flush();
    const data = build(store.getSnapshot(), metadata, "Unknown");
    expect(paths).toHaveBeenCalledTimes(1);
    expect(data).toEqual(buildLiveMeshlogData(store.getSnapshot(), metadata, "Unknown"));
  }
});

it("invalidates cached region and language derivations, including an explicit empty region", () => {
  const paths = vi.spyOn(pathModule, "buildPacketPaths");
  const build = createMeshlogDataBuilder();
  const store = new MeshlogLiveStore();
  store.observe(liveObservation()); flush();
  const snapshot = store.getSnapshot();
  build(snapshot, metadata, "Unknown");
  paths.mockClear();
  build(snapshot, { ...metadata, iatas: ["RIX"] }, "Unknown");
  expect(paths).toHaveBeenCalledTimes(1);
  paths.mockClear();
  build(snapshot, { ...metadata, iatas: ["RIX"] }, "Unknown");
  expect(paths).not.toHaveBeenCalled();
  const translated = build(snapshot, { ...metadata, iatas: ["RIX"] }, "Nežinoma");
  expect(paths).toHaveBeenCalledTimes(1);
  expect(translated).toEqual(buildLiveMeshlogData(snapshot, { ...metadata, iatas: ["RIX"] }, "Nežinoma"));
  paths.mockClear();
  const empty = build(snapshot, { ...metadata, iatas: [] }, "Nežinoma");
  expect(paths).toHaveBeenCalledTimes(1);
  expect(empty.paths).toEqual([]);
  expect(empty.messages[0]!.reports).toEqual([]);
});
