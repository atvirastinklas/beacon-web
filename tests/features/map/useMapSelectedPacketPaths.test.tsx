import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection, LineString } from "geojson";
import type { LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { Observation, PacketDetail, ResolvedHop } from "../../../src/types/api";
import { PayloadType } from "../../../src/types/enums";
import { useMapSelectedPacketPaths } from "../../../src/features/map/useMapSelectedPacketPaths";

const SOURCE = "selected-packet-paths";
const LAYER = "selected-packet-path-lines";
const NODE_SOURCE = "selected-packet-path-nodes";
const NODE_LAYER = "selected-packet-path-nodes";
const LABEL_LAYER = "selected-packet-path-labels";
const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
const hop = (id: string, lng: number, lat: number): ResolvedHop => ({
  confidence: "high", nodes: [{ id, publicKey: id, longitude: lng, latitude: lat }],
});
function observation(id: number, resolvedPath: ResolvedHop[], extra: Partial<Observation> = {}): Observation {
  return { id, observerId: `observer-${id}`, iata: "VNO", heardAt: id,
    pathLength: { raw: "", hashSize: 1, hopCount: resolvedPath.length },
    sourceBroker: "test", resolvedPath, ...extra };
}
function detail(observations: Observation[], extra: Partial<PacketDetail> = {}): PacketDetail {
  return { packetHash: "selected", header: { raw: "11", routeType: 1, routeTypeName: "FLOOD",
    payloadType: PayloadType.TEXT, payloadTypeName: "TEXT", payloadVersion: 0 },
  rawPayload: "", decrypted: false, firstHeardAt: 1, lastHeardAt: 2, firstToLastMs: 1,
  observationCount: observations.length, observations, ...extra };
}
function mapStub(initialLayers = ["basemap", "nodes-clusters", "nodes-unclustered", "nodes-live-foreground",
  "packet-flow-trail", "packet-flow-dot-halo", "packet-flow-dot"]) {
  const sources = new Map<string, { data: FeatureCollection; setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, LayerSpecification>();
  const stack = [...initialLayers];
  const map = {
    getStyle: () => ({ layers: stack.map(id => ({ id })) }),
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id: string, spec: { data: FeatureCollection }) => {
      if (sources.has(id)) throw new Error(`Duplicate source ${id}`);
      const source = { data: spec.data, setData: vi.fn((data: FeatureCollection) => { source.data = data; }) };
      sources.set(id, source);
    }),
    getLayer: (id: string) => layers.get(id) ?? (stack.includes(id) ? { id } : undefined),
    addLayer: vi.fn((layer: LayerSpecification, beforeId?: string) => {
      if (stack.includes(layer.id)) throw new Error(`Duplicate layer ${layer.id}`);
      if (beforeId && !stack.includes(beforeId)) throw new Error(`Missing beforeId ${beforeId}`);
      stack.splice(beforeId ? stack.indexOf(beforeId) : stack.length, 0, layer.id);
      layers.set(layer.id, layer);
    }),
    removeLayer: vi.fn((id: string) => { stack.splice(stack.indexOf(id), 1); layers.delete(id); }),
    removeSource: vi.fn((id: string) => {
      if ([...layers.values()].some(layer => "source" in layer && layer.source === id)) throw new Error("Source still in use");
      sources.delete(id);
    }),
    setPaintProperty: vi.fn((id: string, name: string, value: unknown) => {
      const layer = layers.get(id)!;
      layer.paint = { ...layer.paint, [name]: value };
    }),
    setFeatureState: vi.fn(), removeFeatureState: vi.fn(), fitBounds: vi.fn(), flyTo: vi.fn(), easeTo: vi.fn(),
    on: vi.fn(), off: vi.fn(),
  };
  const ref = { current: map as unknown as MapLibreMap | null };
  return { map, ref, stack, sources, layers };
}
const coordinates = (data: FeatureCollection) => data.features.map(feature => (feature.geometry as LineString).coordinates);

describe("selected packet map paths", () => {
  afterEach(() => vi.restoreAllMocks());
  it("draws every route in blue with Packet Path lines, circles and labels, without touching live traffic or camera", () => {
    const view = mapStub();
    view.map.addSource("packet-flow-trail", { data: empty });
    const liveSource = view.sources.get("packet-flow-trail")!;
    view.map.addSource.mockClear();
    renderHook(() => useMapSelectedPacketPaths(view.ref, true, detail([
      observation(1, [hop("relay", 24, 55)], {
        resolvedSource: hop("start", 23, 54), resolvedDestination: hop("end", 25, 56), propagationTimeMs: 100,
      }),
      observation(2, [hop("other-start", 22, 53), hop("other-end", 26, 57)], { propagationTimeMs: 200 }),
    ]), "dark"));

    expect(coordinates(view.sources.get(SOURCE)!.data)).toEqual([
      [[23, 54], [24, 55], [25, 56]], [[22, 53], [26, 57]],
    ]);
    expect(view.sources.get(SOURCE)!.data.features.map(feature => feature.properties?.key)).toEqual(["observer-1", "observer-2"]);
    expect(view.layers.get(LAYER)).toMatchObject({ type: "line", source: SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#3b82f6", "line-width": 2.5, "line-opacity": 0.9 },
    });
    expect(view.layers.get(LAYER)).not.toHaveProperty("paint.line-dasharray");
    for (const id of ["nodes-clusters", "nodes-unclustered", "nodes-live-foreground", "packet-flow-dot-halo", "packet-flow-dot"]) {
      expect(view.stack.indexOf(LAYER)).toBeLessThan(view.stack.indexOf(id));
    }
    expect(coordinates(view.sources.get(NODE_SOURCE)!.data)).toEqual([
      [23, 54], [24, 55], [25, 56], [22, 53], [26, 57],
    ]);
    expect(view.sources.get(NODE_SOURCE)!.data.features.map(feature => feature.properties?.endpoint)).toEqual(["start", "mid", "end", "start", "end"]);
    expect(view.layers.get(NODE_LAYER)).toEqual({ id: NODE_LAYER, type: "circle", source: NODE_SOURCE,
      paint: {
        "circle-radius": ["case", ["==", ["get", "endpoint"], "mid"], 4, 6],
        "circle-color": "#3b82f6", "circle-stroke-width": 2,
        "circle-stroke-color": ["case", ["==", ["get", "endpoint"], "end"], "#ffffff", "#00000088"],
      },
    });
    expect(view.layers.get(LABEL_LAYER)).toEqual({ id: LABEL_LAYER, type: "symbol", source: NODE_SOURCE,
      layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11,
        "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#e5e7eb", "text-halo-color": "#0a0a0a", "text-halo-width": 1.4 },
    });
    expect(view.stack.indexOf(NODE_LAYER)).toBeGreaterThan(view.stack.indexOf("nodes-live-foreground"));
    expect(view.stack.indexOf(LABEL_LAYER)).toBeGreaterThan(view.stack.indexOf(NODE_LAYER));
    for (const layer of [NODE_LAYER, LABEL_LAYER]) {
      expect(view.stack.indexOf(layer)).toBeLessThan(view.stack.indexOf("packet-flow-dot-halo"));
      expect(view.stack.indexOf(layer)).toBeLessThan(view.stack.indexOf("packet-flow-dot"));
    }
    expect(view.map.addSource).toHaveBeenCalledTimes(2);
    expect(view.map.addLayer).toHaveBeenCalledTimes(3);
    expect(liveSource.setData).not.toHaveBeenCalled();
    expect(view.map.setFeatureState).not.toHaveBeenCalled();
    expect(view.map.removeFeatureState).not.toHaveBeenCalled();
    expect(view.map.fitBounds).not.toHaveBeenCalled();
    expect(view.map.flyTo).not.toHaveBeenCalled();
    expect(view.map.easeTo).not.toHaveBeenCalled();
    expect(view.map.on).not.toHaveBeenCalled();
  });

  it("waits for a ready map, then removes only its labels, circles, line and sources on unmount", () => {
    const view = mapStub();
    const packet = detail([observation(1, [hop("a", 23, 54), hop("b", 24, 55)])]);
    const currentMap = view.ref.current;
    view.ref.current = null;
    const hook = renderHook(({ ready }) => useMapSelectedPacketPaths(view.ref, ready, packet, "dark"), {
      initialProps: { ready: false },
    });
    expect(view.map.addSource).not.toHaveBeenCalled();
    view.ref.current = currentMap;
    hook.rerender({ ready: false });
    expect(view.map.addSource).not.toHaveBeenCalled();
    hook.rerender({ ready: true });
    expect(view.sources.get(SOURCE)!.data.features).toHaveLength(1);
    expect(view.sources.get(NODE_SOURCE)!.data.features).toHaveLength(2);
    view.map.addSource("packet-flow-dot", { data: empty });
    const stackBefore = view.stack.filter(id => ![LAYER, NODE_LAYER, LABEL_LAYER].includes(id));
    // The map-owning hook can clear the shared ref before this hook's cleanup.
    view.ref.current = null;
    hook.unmount();
    expect(view.map.removeLayer.mock.calls).toEqual([[LABEL_LAYER], [NODE_LAYER], [LAYER]]);
    expect(view.map.removeSource.mock.calls).toEqual([[NODE_SOURCE], [SOURCE]]);
    expect(view.stack).toEqual(stackBefore);
    expect([...view.sources.keys()]).toEqual(["packet-flow-dot"]);
    expect(view.map.removeFeatureState).not.toHaveBeenCalled();
  });

  it("replaces selection geometry and clears it on null or unresolvable detail without changing live traffic", () => {
    const view = mapStub();
    view.map.addSource("packet-flow-trail", { data: empty });
    const live = view.sources.get("packet-flow-trail")!;
    view.map.addSource.mockClear();
    const first = detail([observation(1, [hop("a", 23, 54), hop("b", 24, 55)])]);
    const second = detail([observation(2, [hop("c", 25, 56), hop("d", 26, 57)])], { packetHash: "second" });
    const hook = renderHook(({ packet }: { packet: PacketDetail | null }) =>
      useMapSelectedPacketPaths(view.ref, true, packet, "dark"), { initialProps: { packet: first } });
    const selected = view.sources.get(SOURCE)!;
    const selectedNodes = view.sources.get(NODE_SOURCE)!;
    hook.rerender({ packet: second });
    expect(coordinates(selected.data)).toEqual([[[25, 56], [26, 57]]]);
    expect(coordinates(selectedNodes.data)).toEqual([[25, 56], [26, 57]]);
    hook.rerender({ packet: null });
    expect(selected.data).toEqual(empty);
    expect(selectedNodes.data).toEqual(empty);
    hook.rerender({ packet: first });
    expect(coordinates(selected.data)).toEqual([[[23, 54], [24, 55]]]);
    hook.rerender({ packet: detail([observation(3, [hop("only", 25, 54)])]) });
    expect(selected.data).toEqual(empty);
    expect(selectedNodes.data).toEqual(empty);
    expect(view.map.addSource).toHaveBeenCalledTimes(2);
    expect(view.map.addLayer).toHaveBeenCalledTimes(3);
    expect(view.map.removeLayer).not.toHaveBeenCalled();
    expect(view.map.removeSource).not.toHaveBeenCalled();
    expect(view.sources.get("packet-flow-trail")).toBe(live);
    expect(live.data).toBe(empty);
    expect(live.setData).not.toHaveBeenCalled();
    expect(view.map.fitBounds).not.toHaveBeenCalled();
  });

  it("restores the current geometry after a theme style reload and never restores a cleared selection", () => {
    const view = mapStub();
    const packet = detail([observation(1, [hop("a", 23, 54), hop("b", 24, 55)])]);
    const hook = renderHook(({ packet, theme }: { packet: PacketDetail | null; theme: string }) =>
      useMapSelectedPacketPaths(view.ref, true, packet, theme), { initialProps: { packet, theme: "dark" } });
    const beforeReload = view.sources.get(SOURCE)!.data;
    const nodesBeforeReload = view.sources.get(NODE_SOURCE)!.data;
    const resetStyle = () => {
      view.sources.clear();
      view.layers.clear();
      for (const id of [LAYER, NODE_LAYER, LABEL_LAYER]) view.stack.splice(view.stack.indexOf(id), 1);
    };
    resetStyle();
    hook.rerender({ packet, theme: "light" });
    expect(view.sources.get(SOURCE)!.data).toEqual(beforeReload);
    expect(view.sources.get(NODE_SOURCE)!.data).toEqual(nodesBeforeReload);
    expect(view.layers.get(LAYER)).toMatchObject({ paint: { "line-color": "#3b82f6" } });
    expect(view.layers.get(NODE_LAYER)).toMatchObject({ paint: { "circle-color": "#3b82f6" } });
    expect(view.layers.has(LABEL_LAYER)).toBe(true);
    expect(view.stack.indexOf(LAYER)).toBeLessThan(view.stack.indexOf("nodes-clusters"));
    hook.rerender({ packet: null, theme: "light" });
    resetStyle();
    hook.rerender({ packet: null, theme: "liberty" });
    expect(view.sources.get(SOURCE)!.data).toEqual(empty);
    expect(view.sources.get(NODE_SOURCE)!.data).toEqual(empty);
    expect(view.map.addSource).toHaveBeenCalledTimes(6);
    expect(view.map.addLayer).toHaveBeenCalledTimes(9);
    expect(view.map.fitBounds).not.toHaveBeenCalled();
  });

  it("retains gaps at unknown and ambiguous hops rather than drawing invented connecting segments", () => {
    const view = mapStub();
    const ambiguous: ResolvedHop = { confidence: "ambiguous", nodes: [
      ...hop("candidate-a", 27, 55).nodes, ...hop("candidate-b", 28, 56).nodes,
    ] };
    renderHook(() => useMapSelectedPacketPaths(view.ref, true, detail([
      observation(1, [hop("a", 23, 54), hop("b", 24, 55), { confidence: "none", nodes: [] },
        hop("c", 25, 56), hop("d", 26, 57)]),
      observation(2, [hop("e", 21, 52), ambiguous, hop("f", 22, 53)]),
    ]), "dark"));
    expect(coordinates(view.sources.get(SOURCE)!.data)).toEqual([
      [[23, 54], [24, 55]], [[25, 56], [26, 57]],
    ]);
    expect(coordinates(view.sources.get(NODE_SOURCE)!.data)).toEqual([
      [23, 54], [24, 55], [25, 56], [26, 57], [21, 52], [22, 53],
    ]); // only real located nodes; no markers for unknown/ambiguous candidates
  });

  it("uses the current palette for Packet Path labels and updates it when the theme changes without replacing geometry", () => {
    let text = "#abcdef";
    let halo = "#123456";
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation(() => ({
      getPropertyValue: (name: string) => name === "--palette-text-bright" ? text : name === "--palette-bg-base" ? halo : "",
    }) as CSSStyleDeclaration);
    const view = mapStub();
    const start = hop("start", 23, 54);
    start.nodes[0]!.name = "Named start";
    const packet = detail([observation(1, [start, hop("abcdef123456", 24, 55)])]);
    const hook = renderHook(({ theme }) => useMapSelectedPacketPaths(view.ref, true, packet, theme), { initialProps: { theme: "dark" } });
    expect(view.layers.get(LABEL_LAYER)).toMatchObject({ paint: {
      "text-color": "#abcdef", "text-halo-color": "#123456", "text-halo-width": 1.4,
    } });
    expect(view.sources.get(NODE_SOURCE)!.data.features.map(feature => feature.properties?.label)).toEqual(["Named start", "abcdef"]);
    const points = view.sources.get(NODE_SOURCE)!.data;
    text = "#112233";
    halo = "#ddeeff";
    hook.rerender({ theme: "light" });
    expect(view.layers.get(LABEL_LAYER)).toMatchObject({ paint: {
      "text-color": "#112233", "text-halo-color": "#ddeeff", "text-halo-width": 1.4,
    } });
    expect(view.sources.get(NODE_SOURCE)!.data).toEqual(points);
    expect(view.map.setPaintProperty.mock.calls.map(([id]) => id)).toEqual([LABEL_LAYER, LABEL_LAYER]);
    expect(view.map.addLayer).toHaveBeenCalledTimes(3);
    expect(view.map.fitBounds).not.toHaveBeenCalled();
  });

  it("draws only the resolved TRACE route, suppressing duplicate observation routes", () => {
    const view = mapStub();
    const packet = detail([observation(1, [hop("a", 23, 54), hop("b", 24, 55)])]);
    packet.header.payloadType = PayloadType.TRACE;
    packet.resolvedRoute = [hop("trace-start", 25, 56), hop("trace-end", 26, 57)];
    const hook = renderHook(({ packet }) => useMapSelectedPacketPaths(view.ref, true, packet, "dark"), { initialProps: { packet } });
    expect(coordinates(view.sources.get(SOURCE)!.data)).toEqual([[[25, 56], [26, 57]]]);
    expect(view.sources.get(SOURCE)!.data.features[0]!.properties?.key).toBe("trace");
    expect(coordinates(view.sources.get(NODE_SOURCE)!.data)).toEqual([[25, 56], [26, 57]]);
    hook.rerender({ packet: { ...packet, resolvedRoute: undefined } });
    expect(view.sources.get(SOURCE)!.data).toEqual(empty);
    expect(view.sources.get(NODE_SOURCE)!.data).toEqual(empty);
  });

  it.each([
    { stack: ["basemap", "packet-flow-dot-halo", "nodes-clusters", "packet-flow-dot"], before: "packet-flow-dot-halo" },
    { stack: ["basemap", "nodes-selected-leaf", "nodes-unclustered"], before: "nodes-selected-leaf" },
    { stack: ["basemap", "packet-flow-dot"], before: "packet-flow-dot" },
    { stack: ["basemap"], before: undefined },
  ])("uses the earliest existing marker as its insertion point, falling back safely: $stack", ({ stack, before }) => {
    const view = mapStub(stack);
    renderHook(() => useMapSelectedPacketPaths(view.ref, true, null, "dark"));
    expect(view.map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: LAYER }), before);
  });

  it("cleans up when readiness is lost, restores on readiness, and tolerates an already removed map", () => {
    const view = mapStub();
    const packet = detail([observation(1, [hop("a", 23, 54), hop("b", 24, 55)])]);
    const hook = renderHook(({ ready }) => useMapSelectedPacketPaths(view.ref, ready, packet, "dark"), {
      initialProps: { ready: true },
    });
    hook.rerender({ ready: false });
    expect(view.sources.has(SOURCE)).toBe(false);
    expect(view.sources.has(NODE_SOURCE)).toBe(false);
    expect(view.stack.includes(LAYER)).toBe(false);
    expect(view.stack.includes(NODE_LAYER)).toBe(false);
    expect(view.stack.includes(LABEL_LAYER)).toBe(false);
    hook.rerender({ ready: true });
    expect(view.sources.get(SOURCE)!.data.features).toHaveLength(1);
    vi.spyOn(view.map, "getLayer").mockImplementation(() => { throw new Error("Map removed"); });
    expect(() => hook.unmount()).not.toThrow();
  });
});
