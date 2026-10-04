import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import type { WsManager } from "../../../src/api/ws-manager";
import type { ResolvedHop } from "../../../src/types/api";
import type { WsPacketObservation } from "../../../src/types/ws";
import type { NodeFeatureProps } from "../../../src/features/map/node-geojson";
import { useMapPacketFlow } from "../../../src/features/map/useMapPacketFlow";
import { PACKET_FLOW_HOP_MS, PACKET_FLOW_TRAIL_FADE_MS } from "../../../src/features/map/types";

const unknown: ResolvedHop = { confidence: "none", nodes: [] };
const hop = (id: string, lng: number, lat: number): ResolvedHop => ({ confidence: "high", nodes: [{ id, publicKey: id, longitude: lng, latitude: lat }] });
const noNodes: FeatureCollection<Point, NodeFeatureProps> = { type: "FeatureCollection", features: [] };
const visibleNode = (id: string, lng: number, lat: number): FeatureCollection<Point, NodeFeatureProps> => ({
  type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { id, name: id, nodeTypeName: "Repeater", isObserver: false } }],
});

function setup() {
  const sources = new Map<string, { data: FeatureCollection; setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, unknown>();
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, spec: { data: FeatureCollection }) => {
      const source = { data: spec.data, setData: vi.fn() };
      source.setData.mockImplementation((data: FeatureCollection) => { source.data = data; });
      sources.set(id, source);
    },
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => layers.get(id),
    addLayer: (spec: { id: string }) => layers.set(spec.id, spec),
    removeLayer: (id: string) => layers.delete(id),
    setFeatureState: vi.fn(),
    removeFeatureState: vi.fn(),
  };
  let handler: ((data: WsPacketObservation["data"]) => void) | null = null;
  const unsubscribe = vi.fn(() => { handler = null; });
  const manager = {
    setResolvePath: vi.fn(),
    onPacketObservation: vi.fn((callback: typeof handler) => { handler = callback; return unsubscribe; }),
  };
  const ref = { current: map as unknown as MapLibreMap };
  const view = renderHook(({ enabled, region, nodes, theme }) => useMapPacketFlow(ref, true, enabled, manager as unknown as WsManager, theme, region, nodes), { initialProps: { enabled: true, region: "all", nodes: noNodes, theme: "dark" } });
  const emit = (source: ResolvedHop | null, path: ResolvedHop[] | null, destination: ResolvedHop | null) => {
    act(() => { handler?.({ packetHash: "test-packet", packet: { payloadType: 2, payloadTypeName: "Text", routeType: 1, routeTypeName: "Flood", isFirstObservation: true, observationCount: 1 }, observation: { observerId: "observer", observerName: "Observer", iata: "VNO", heardAt: 1, rssi: -70, snr: 8, sourceBroker: "test", resolvedSource: source, resolvedPath: path, resolvedDestination: destination } }); });
  };
  return { ...view, map, sources, layers, emit, unsubscribe, manager };
}

let now: number;
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
function tick(time: number) {
  now = time;
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(time);
  });
}
const pointCoordinates = (data: FeatureCollection) => data.features.map(feature => (feature.geometry as Point).coordinates);

beforeEach(() => {
  now = 0;
  sequence = 0;
  frames = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { frames.delete(id); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("live packet ghost stops", () => {
  it("animates A -> ghost B -> ghost C -> D, highlights only real IDs and clears ghosts at expiry", () => {
    const view = setup();
    view.emit(hop("A", 0, 50), [unknown, unknown], hop("D", 3, 53));
    tick(0);
    const ghosts = view.sources.get("packet-flow-ghosts")!;
    expect(pointCoordinates(ghosts.data)).toEqual([[1, 51], [2, 52]]);
    expect(ghosts.data.features.every(feature => feature.properties?.inferred === true)).toBe(true);
    tick(PACKET_FLOW_HOP_MS);
    expect(pointCoordinates(view.sources.get("packet-flow-dot")!.data)).toEqual([[1, 51]]);
    tick(PACKET_FLOW_HOP_MS * 2);
    expect(pointCoordinates(view.sources.get("packet-flow-dot")!.data)).toEqual([[2, 52]]);
    tick(PACKET_FLOW_HOP_MS * 3);
    expect(pointCoordinates(view.sources.get("packet-flow-dot")!.data)).toEqual([[3, 53]]);
    expect(view.map.setFeatureState.mock.calls.every(([target]) => target.id === "A" || target.id === "D")).toBe(true);
    expect(view.map.setFeatureState).toHaveBeenCalledWith({ source: "nodes", id: "D" }, { glow: 1 });
    tick(PACKET_FLOW_HOP_MS * 3 + PACKET_FLOW_TRAIL_FADE_MS + 1);
    expect(ghosts.data.features).toEqual([]);
    expect(view.sources.get("packet-flow-dot")!.data.features).toEqual([]);
    expect(frames.size).toBe(0);
    view.unmount();
  });

  it("animates only A -> B -> C when D has no location, never creating a trailing ghost", () => {
    const view = setup();
    const unlocatedD: ResolvedHop = { confidence: "high", nodes: [{ id: "D", publicKey: "D" }] };
    view.emit(hop("A", 0, 50), [hop("B", 1, 51), hop("C", 2, 52)], unlocatedD);
    tick(PACKET_FLOW_HOP_MS * 2);
    expect(pointCoordinates(view.sources.get("packet-flow-dot")!.data)).toEqual([[2, 52]]);
    expect(view.sources.get("packet-flow-ghosts")!.data.features).toEqual([]);
    expect(view.map.setFeatureState.mock.calls.map(([target]) => target.id)).toEqual(["A", "B", "C"]);
    tick(PACKET_FLOW_HOP_MS * 2 + 1);
    expect(view.sources.get("packet-flow-dot")!.data.features).toEqual([]);
    view.unmount();
  });

  it("doesn't draw Repeater -> unknown -> unknown when there is no located final anchor", () => {
    const view = setup();
    view.emit(null, [hop("Repeater", 0, 50), unknown, unknown], null);
    tick(PACKET_FLOW_HOP_MS * 2);
    expect(view.sources.get("packet-flow-trail")!.data.features).toEqual([]);
    expect(view.sources.get("packet-flow-dot")!.data.features).toEqual([]);
    expect(view.sources.get("packet-flow-ghosts")!.data.features).toEqual([]);
    expect(view.map.setFeatureState).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    view.unmount();
  });

  it("marks an absent real endpoint and intermediate corner throughout the trail without changing geometry", () => {
    const view = setup();
    const corner = { ...hop("Turn", 25, 54.7), nodes: [{ ...hop("Turn", 25, 54.7).nodes[0]!, name: "Resolved corner" }] };
    view.emit(hop("A", 23.9, 54.9), [unknown, unknown, corner], hop("C", 24.9, 54.5));
    tick(PACKET_FLOW_HOP_MS * 4 + 100);
    expect(view.sources.get("packet-flow-dot")!.data.features).toEqual([]);
    const anchors = view.sources.get("packet-flow-anchors")!.data;
    expect(anchors.features.map(feature => feature.properties?.nodeId)).toEqual(["A", "Turn", "C"]);
    expect(anchors.features[1]!.properties).toMatchObject({ name: "Resolved corner", resolvedAnchor: true, a: 0.9 });
    const trail = view.sources.get("packet-flow-trail")!.data;
    expect(trail.features).toHaveLength(1);
    expect(anchors.features[1]!.geometry).toMatchObject({ type: "Point", coordinates: (trail.features[0]!.geometry as { coordinates: number[][] }).coordinates[3] });
    tick(PACKET_FLOW_HOP_MS * 4 + PACKET_FLOW_TRAIL_FADE_MS + 1);
    expect(view.sources.get("packet-flow-anchors")!.data.features).toEqual([]);
    view.unmount();
  });

  it("reconciles loaded/filtered markers without resubscribing or restarting the packet", () => {
    const view = setup();
    view.emit(hop("A", 0, 50), [unknown], hop("C", 2, 52));
    tick(PACKET_FLOW_HOP_MS + 100);
    const dotBefore = view.sources.get("packet-flow-dot")!.data;
    view.rerender({ enabled: true, region: "all", nodes: visibleNode("C", 2, 52), theme: "dark" });
    expect(view.sources.get("packet-flow-anchors")!.data.features.map(feature => feature.properties?.nodeId)).toEqual(["A"]);
    expect(view.sources.get("packet-flow-dot")!.data).toBe(dotBefore);
    expect(view.manager.onPacketObservation).toHaveBeenCalledTimes(1);
    view.rerender({ enabled: true, region: "all", nodes: noNodes, theme: "dark" });
    expect(view.sources.get("packet-flow-anchors")!.data.features.map(feature => feature.properties?.nodeId)).toEqual(["A", "C"]);
    tick(PACKET_FLOW_HOP_MS * 2 + 1);
    expect(view.sources.get("packet-flow-dot")!.data.features).toEqual([]);
    expect(view.manager.onPacketObservation).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("restores active sources immediately after a style change without replaying observations", () => {
    const view = setup();
    view.emit(hop("A", 0, 50), [unknown], hop("C", 2, 52));
    tick(PACKET_FLOW_HOP_MS);
    const dataBefore = new Map([...view.sources].map(([id, source]) => [id, source.data]));
    view.sources.clear();
    view.layers.clear();
    view.rerender({ enabled: true, region: "all", nodes: noNodes, theme: "light" });
    for (const [id, data] of dataBefore) expect(view.sources.get(id)!.data).toEqual(data);
    expect(view.manager.onPacketObservation).toHaveBeenCalledTimes(1);
    tick(PACKET_FLOW_HOP_MS * 2 + 1);
    expect(view.sources.get("packet-flow-dot")!.data.features).toEqual([]);
    view.unmount();
  });

  it("doesn't animate a path with only one located anchor or missing opt-in path data", () => {
    const view = setup();
    view.emit(null, [unknown, hop("only", 1, 51), unknown], null);
    view.emit(hop("A", 0, 50), null, hop("D", 3, 53));
    expect(frames.size).toBe(0);
    expect(view.map.setFeatureState).not.toHaveBeenCalled();
    expect(view.sources.get("packet-flow-ghosts")!.data.features).toEqual([]);
    view.unmount();
  });

  it.each(["disable", "region"] as const)("clears ghost stops and pending animation when %s changes", action => {
    const view = setup();
    view.emit(hop("A", 0, 50), [unknown], hop("C", 2, 52));
    tick(0);
    const ghosts = view.sources.get("packet-flow-ghosts")!;
    expect(ghosts.data.features).toHaveLength(1);
    expect(view.sources.get("packet-flow-anchors")!.data.features).toHaveLength(2);
    view.rerender({ enabled: action !== "disable", region: action === "region" ? "new-region" : "all", nodes: noNodes, theme: "dark" });
    expect(ghosts.data.features).toEqual([]);
    expect(view.sources.get("packet-flow-anchors")!.data.features).toEqual([]);
    expect(frames.size).toBe(0);
    expect(view.map.removeFeatureState).toHaveBeenCalledWith({ source: "nodes", id: "A" }, "glow");
    view.unmount();
    expect(view.sources.size).toBe(0);
    expect(view.layers.size).toBe(0);
  });
});
