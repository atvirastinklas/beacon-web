import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Map as MapLibreMap, LayerSpecification } from "maplibre-gl";
import { NODES_POINT_LAYER_ID, NODES_CLUSTER_LAYER_ID, LIVE_DIM_OPACITY, LIVE_NODE_FOREGROUND_LAYER_ID } from "../../../src/features/map/types";
import { LIVE_NODE_IDLE_LAYER_ID } from "../../../src/features/map/live-marker-hit";

const spiders = vi.hoisted(() => [] as { options: Record<string, unknown>; unspiderfyAll: ReturnType<typeof vi.fn> }[]);
vi.mock("@nazka/map-gl-js-spiderfy", () => ({ default: class {
  applyTo = vi.fn();
  unspiderfyAll = vi.fn();
  constructor(_map: unknown, options: Record<string, unknown>) { spiders.push({ options, unspiderfyAll: this.unspiderfyAll }); }
} }));
vi.mock("../../../src/features/map/node-icons", async importOriginal => ({
  ...await importOriginal<typeof import("../../../src/features/map/node-icons")>(), rasterizeNodeIcon: vi.fn(async () => null),
}));
import { useMapNodes } from "../../../src/features/map/useMapNodes";

function stubMap() {
  const layers = new Map<string, LayerSpecification>();
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const listeners = new Map<string, Set<(...args: never[]) => void>>();
  const canvas = document.createElement("canvas");
  const map = {
    getCanvas: () => canvas,
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: LayerSpecification) => layers.set(layer.id, layer),
    removeLayer: (id: string) => layers.delete(id),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => sources.set(id, { setData: vi.fn() }),
    removeSource: (id: string) => sources.delete(id),
    getStyle: () => ({ layers: [...layers.values()] }),
    getLayersOrder: () => [...layers.keys()],
    setPaintProperty: vi.fn((id: string, key: string, value: unknown) => Object.assign(layers.get(id)!.paint!, { [key]: value })),
    setLayoutProperty: vi.fn((id: string, key: string, value: unknown) => { const layer = layers.get(id)!; layer.layout ??= {}; Object.assign(layer.layout, { [key]: value }); }),
    getLayoutProperty: (id: string, key: string) => (layers.get(id)?.layout as Record<string, unknown>)?.[key],
    getFeatureState: vi.fn((target: { source: string; id: string }) => ({ glow: target.id ? 1 : 0 })),
    queryRenderedFeatures: vi.fn((): { properties: Record<string, unknown>; layer: { id: string } }[] => []),
    querySourceFeatures: vi.fn(() => [{ properties: { id: "one" }, geometry: { type: "Point", coordinates: [10, 20] } }]),
    setFilter: vi.fn(),
    hasImage: vi.fn(), removeImage: vi.fn(), addImage: vi.fn(),
    on: vi.fn((event: string, ...args: unknown[]) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(args.at(-1) as (...args: never[]) => void); }),
    off: vi.fn((event: string, ...args: unknown[]) => listeners.get(event)?.delete(args.at(-1) as (...args: never[]) => void)),
  };
  return { map, layers, sources, listeners, ref: { current: map as unknown as MapLibreMap } };
}

describe("live map markers", () => {
  it("clicks resolved path context through actual nodeId and gives normal nodes priority, never ghosts", () => {
    const { ref, map, layers, listeners } = stubMap();
    const select = vi.fn();
    const { unmount } = renderHook(() => useMapNodes(ref, { current: null }, true, { type: "FeatureCollection", features: [] }, true, "dark", false, select, null, true, null, "a"));
    layers.set("packet-flow-anchors", { id: "packet-flow-anchors", type: "circle", source: "packet-flow-anchors" });
    const context = { properties: { nodeId: "backend-id", resolvedAnchor: true, a: 1 }, layer: { id: "packet-flow-anchors" } };
    map.queryRenderedFeatures.mockReturnValue([context]);
    const click = [...listeners.get("click")!][0] as unknown as (e: { point: { x: number; y: number } }) => void;
    click({ point: { x: 20, y: 30 } });
    expect(select).toHaveBeenLastCalledWith("backend-id");
    map.queryRenderedFeatures.mockReturnValue([context, { properties: { id: "normal-id" }, layer: { id: LIVE_NODE_IDLE_LAYER_ID } }]);
    click({ point: { x: 20, y: 30 } });
    expect(select).toHaveBeenLastCalledWith("normal-id");
    map.queryRenderedFeatures.mockReturnValue([{ properties: { inferred: true, a: 1 }, layer: { id: "packet-flow-ghosts" } }]);
    click({ point: { x: 20, y: 30 } });
    expect(select).toHaveBeenCalledTimes(2);
    unmount();
  });
  it("uses opaque type-colored dot images, hides labels, keeps clusters usable and restores normal focus", () => {
    const { ref, layers, sources } = stubMap();
    const iconRef = { current: null };
    const fc = { type: "FeatureCollection" as const, features: [] };
    const { rerender, unmount } = renderHook(({ live }) => useMapNodes(ref, iconRef, true, fc, true, "dark", true, vi.fn(), null, live, ["one"], "scope"), { initialProps: { live: false } });
    const originalLayout = layers.get(NODES_POINT_LAYER_ID)!.layout;
    const originalImage = (originalLayout as Record<string, unknown>)["icon-image"];
    const source = sources.get("nodes");
    expect((layers.get(NODES_POINT_LAYER_ID)!.paint as Record<string, unknown>)["icon-opacity"]).toEqual(["case", ["in", ["get", "id"], ["literal", ["one"]]], 1, LIVE_DIM_OPACITY]);
    rerender({ live: true });
    const paint = layers.get(NODES_POINT_LAYER_ID)!.paint as Record<string, unknown>;
    expect(paint["icon-opacity"]).toBe(0);
    expect(layers.get(LIVE_NODE_IDLE_LAYER_ID)!.layout).toMatchObject({ visibility: "visible" });
    expect(layers.get(LIVE_NODE_IDLE_LAYER_ID)!.paint).toMatchObject({ "circle-radius": 4, "circle-stroke-width": 0.75, "circle-pitch-scale": "viewport" });
    expect(paint["text-opacity"]).toBe(0);
    expect((layers.get(NODES_POINT_LAYER_ID)!.layout as Record<string, unknown>)["icon-image"]).toEqual(["match", ["get", "nodeTypeName"], "companion", "node-live-companion", "repeater", "node-live-repeater", "room_server", "node-live-room_server", "sensor", "node-live-sensor", "node-live-unknown"]);
    expect(layers.get(NODES_CLUSTER_LAYER_ID)!.paint).toMatchObject({ "icon-opacity": 1, "text-opacity": 1 });
    expect(layers.get("nodes-live-activity")!.layout).toMatchObject({ visibility: "visible" });
    expect(layers.get("nodes-live-activity")!.paint).toMatchObject({ "circle-opacity": ["*", 0.5, ["coalesce", ["feature-state", "glow"], 0]] });
    expect(layers.get(LIVE_NODE_FOREGROUND_LAYER_ID)!.layout).toMatchObject({ visibility: "visible" });
    expect(layers.get(LIVE_NODE_FOREGROUND_LAYER_ID)!.paint).toMatchObject({
      "circle-radius": 4, "circle-opacity": ["case", [">", ["coalesce", ["feature-state", "glow"], 0], 0], 1, 0],
      "circle-stroke-opacity": ["case", [">", ["coalesce", ["feature-state", "glow"], 0], 0], 1, 0],
    });
    expect(sources.get("nodes")).toBe(source);
    rerender({ live: false });
    expect((layers.get(NODES_POINT_LAYER_ID)!.layout as Record<string, unknown>)["icon-image"]).toEqual(originalImage);
    expect(paint["icon-opacity"]).toEqual(["case", ["in", ["get", "id"], ["literal", ["one"]]], 1, LIVE_DIM_OPACITY]);
    expect(layers.get("nodes-live-activity")!.layout).toMatchObject({ visibility: "none" });
    expect(layers.get(LIVE_NODE_FOREGROUND_LAYER_ID)!.layout).toMatchObject({ visibility: "none" });
    unmount();
  });

  it("selects the active foreground node once and ignores transparent inactive cores", () => {
    const { ref, map, listeners, sources } = stubMap();
    const select = vi.fn();
    const { unmount } = renderHook(() => useMapNodes(ref, { current: null }, true, { type: "FeatureCollection", features: [] }, true, "dark", false, select, null, true, null, "a"));
    const source = sources.get("nodes")!;
    const calls = source.setData.mock.calls.length;
    map.queryRenderedFeatures.mockReturnValue([
      { properties: { id: "idle" }, layer: { id: LIVE_NODE_FOREGROUND_LAYER_ID } },
      { properties: { id: "active" }, layer: { id: LIVE_NODE_FOREGROUND_LAYER_ID } },
      { properties: { id: "idle" }, layer: { id: LIVE_NODE_IDLE_LAYER_ID } },
    ]);
    map.getFeatureState.mockImplementation(({ id }) => ({ glow: id === "active" ? 1 : 0 }));
    const clickHandlers = [...listeners.get("click")!];
    const selectHandler = clickHandlers[0] as unknown as (e: { point: { x: number; y: number } }) => void;
    selectHandler({ point: { x: 20, y: 30 } });
    expect(select).toHaveBeenCalledExactlyOnceWith("active");
    expect(source.setData.mock.calls.length).toBe(calls);
    expect(listeners.get("render")?.size ?? 0).toBe(0);
    unmount();
  });

  it("rebuilds fans with dot leaves, applies activity size without idle dimming and tears listeners down", () => {
    const { ref, map, layers, listeners } = stubMap();
    const { rerender, unmount } = renderHook(({ live, resetKey }) => useMapNodes(ref, { current: null }, true, { type: "FeatureCollection", features: [] }, true, "dark", true, vi.fn(), null, live, null, resetKey), { initialProps: { live: false, resetKey: "a" } });
    const normal = spiders.at(-1)!;
    rerender({ live: true, resetKey: "a" });
    expect(normal.unspiderfyAll).toHaveBeenCalledOnce();
    const active = spiders.at(-1)!;
    expect(active.options.spiderLeavesPaint).toEqual({ "icon-opacity": 1, "text-opacity": 0 });
    expect(active.options.spiderLeavesLayout).toMatchObject({ "icon-image": expect.arrayContaining(["node-live-repeater"]) });
    layers.set("nodes-clusters-spiderfy-leaf0", { id: "nodes-clusters-spiderfy-leaf0", type: "symbol", source: "leaf", layout: { "icon-size": 1, "icon-offset": [50, 10] } });
    for (const listener of listeners.get("render") ?? []) listener();
    expect(map.setLayoutProperty).toHaveBeenCalledWith("nodes-clusters-spiderfy-leaf0", "icon-size", 1.5);
    expect(map.setLayoutProperty).toHaveBeenCalledWith("nodes-clusters-spiderfy-leaf0", "icon-offset", [50 / 1.5, 10 / 1.5]);
    map.getFeatureState.mockReturnValue({ glow: 0 });
    for (const listener of listeners.get("render") ?? []) listener();
    expect(map.setLayoutProperty).toHaveBeenCalledWith("nodes-clusters-spiderfy-leaf0", "icon-size", 1);
    rerender({ live: true, resetKey: "b" });
    expect(active.unspiderfyAll).toHaveBeenCalledOnce();
    unmount();
    for (const handlers of listeners.values()) expect(handlers.size).toBe(0);
  });

  it.each([1, 1.5])("keeps a selected leaf's ring aligned at activity size %s", size => {
    const { ref, map, layers } = stubMap();
    const { rerender, unmount } = renderHook(({ selected }: { selected: string | null }) => useMapNodes(ref, { current: null }, true, { type: "FeatureCollection", features: [] }, true, "dark", true, vi.fn(), selected, true, null, "a"), { initialProps: { selected: null } });
    layers.set("nodes-clusters-spiderfy-leaf0", { id: "nodes-clusters-spiderfy-leaf0", type: "symbol", source: "leaf", layout: { "icon-size": size, "icon-offset": [50 / size, 10 / size] } });
    rerender({ selected: "one" });
    expect(map.getLayoutProperty("nodes-selected-leaf", "icon-offset")).toEqual([50, 10]);
    unmount();
  });
});
