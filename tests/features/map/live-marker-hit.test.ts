import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap, MapGeoJSONFeature, MapMouseEvent } from "maplibre-gl";
import { liveMarkerAnchor, queryLiveMarkerHits, LIVE_NODE_RADIUS, LIVE_NODE_STROKE_WIDTH, LIVE_GHOST_RADIUS, LIVE_GHOST_STROKE_WIDTH } from "../../../src/features/map/live-marker-hit";

type Point = MapMouseEvent["point"];
const feature = (layer: string, properties: Record<string, unknown>, coordinate = [0, 0]) => ({ layer: { id: layer }, properties, geometry: { type: "Point", coordinates: coordinate } }) as unknown as MapGeoJSONFeature;

describe("live marker hit contract", () => {
  const radius = LIVE_NODE_RADIUS + LIVE_NODE_STROKE_WIDTH;
  it("matches real and ghost outer sizes without including halos or symbol padding", () => {
    expect(radius).toBe(4.75);
    expect(LIVE_GHOST_RADIUS + LIVE_GHOST_STROKE_WIDTH).toBe(radius);
  });

  it.each([[4.5, 0, true], [-4.5, 0, true], [0, 4.5, true], [0, -4.5, true], [3.2, 3.2, true], [4.9, 0, false], [-4.9, 0, false], [0, 4.9, false], [0, -4.9, false], [3.5, 3.5, false]])("queries the exact point (%s,%s) for circle hits, never an expanded rectangle", (x, y, inside) => {
    // Stand-in for the renderer's radial circle intersection; the actual renderer is covered in Chromium.
    const query = vi.fn((point: Point) => point.x ** 2 + point.y ** 2 <= radius ** 2 ? [feature("nodes-live-idle", { id: "idle" })] : []);
    const map = { getLayer: () => ({}), queryRenderedFeatures: query, getFeatureState: () => ({ glow: 0 }) } as unknown as MapLibreMap;
    const point = { x, y } as Point;
    expect(Boolean(queryLiveMarkerHits(map, point).node)).toBe(inside);
    expect(query).toHaveBeenCalledExactlyOnceWith(point, { layers: ["nodes-live-foreground", "nodes-live-idle", "packet-flow-anchors", "packet-flow-ghosts"] });
  });

  it("only prioritizes an active foreground returned by visible-core picking and never treats a ghost as a node", () => {
    const query = vi.fn(() => [feature("nodes-live-foreground", { id: "inactive" }), feature("nodes-live-idle", { id: "idle" }), feature("packet-flow-ghosts", { inferred: true, a: 1 })]);
    const state = vi.fn(() => ({ glow: 0 }));
    const map = { getLayer: () => ({}), queryRenderedFeatures: query, getFeatureState: state } as unknown as MapLibreMap;
    expect(queryLiveMarkerHits(map, { x: 0, y: 0 } as Point).node?.properties.id).toBe("idle");
    state.mockReturnValue({ glow: 1 });
    expect(queryLiveMarkerHits(map, { x: 0, y: 0 } as Point).node?.properties.id).toBe("inactive");
    query.mockReturnValue([feature("packet-flow-ghosts", { inferred: true, a: 1 })]);
    const hits = queryLiveMarkerHits(map, { x: 10, y: 0 } as Point);
    expect(hits.node).toBeUndefined();
    expect(hits.ghost?.properties.inferred).toBe(true);
    query.mockReturnValue([feature("packet-flow-ghosts", { inferred: true, a: 0 })]);
    expect(queryLiveMarkerHits(map, { x: 10, y: 0 } as Point).ghost).toBeUndefined();
  });

  it("anchors the nearest rendered world copy through terrain-aware project/unproject APIs", () => {
    const map = { unproject: () => ({ lng: 181, lat: 0 }), project: vi.fn((coordinate: number[]) => ({ x: coordinate[0], y: coordinate[1] })) } as unknown as MapLibreMap;
    expect(liveMarkerAnchor(map, feature("nodes-live-idle", { id: "dateline" }, [-179, 0]), { x: 181, y: 0 } as Point)).toEqual([181, 0]);
    expect(map.project).toHaveBeenCalled();
  });

  it("returns resolved context separately with actual nodeId, rejecting expired or invalid context", () => {
    const context = feature("packet-flow-anchors", { nodeId: "backend-id", resolvedAnchor: true, a: 1 });
    const query = vi.fn(() => [context]);
    const map = { getLayer: () => ({}), queryRenderedFeatures: query, getFeatureState: () => ({ glow: 0 }) } as unknown as MapLibreMap;
    const point = { x: 0, y: 0 } as Point;
    expect(queryLiveMarkerHits(map, point)).toEqual({ node: undefined, anchor: context, ghost: undefined });
    for (const props of [{ nodeId: "backend-id", resolvedAnchor: true, a: 0 }, { id: "wrong-contract", resolvedAnchor: true, a: 1 }, { nodeId: "backend-id", a: 1 }]) {
      query.mockReturnValue([feature("packet-flow-anchors", props)]);
      expect(queryLiveMarkerHits(map, point).anchor).toBeUndefined();
    }
  });
});
