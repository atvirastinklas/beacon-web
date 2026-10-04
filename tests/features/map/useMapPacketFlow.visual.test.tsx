import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap, LayerSpecification, CircleLayerSpecification } from "maplibre-gl";
import type { WsManager } from "../../../src/api/ws-manager";
import { useMapPacketFlow } from "../../../src/features/map/useMapPacketFlow";
import { PACKET_FLOW_GHOST_LAYER_ID, PACKET_FLOW_GHOST_SOURCE_ID, PACKET_FLOW_TRAIL_LAYER_ID, PACKET_FLOW_DOT_HALO_LAYER_ID, PACKET_FLOW_DOT_LAYER_ID } from "../../../src/features/map/types";

describe("inferred stop visual layer", () => {
  it("renders hollow neutral rings with flow opacity between the trail and moving packet, and restores them after style replacement", () => {
    const layers = new Map<string, LayerSpecification>();
    const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    const map = {
      getLayer: (id: string) => layers.get(id),
      addLayer: (layer: LayerSpecification) => layers.set(layer.id, layer),
      removeLayer: (id: string) => layers.delete(id),
      getSource: (id: string) => sources.get(id),
      addSource: (id: string) => sources.set(id, { setData: vi.fn() }),
      removeSource: (id: string) => sources.delete(id),
    };
    const manager = { setResolvePath: vi.fn(), onPacketObservation: vi.fn(() => vi.fn()) };
    const ref = { current: map as unknown as MapLibreMap };
    const { rerender, unmount } = renderHook(({ theme }) => useMapPacketFlow(ref, true, false, manager as unknown as WsManager, theme, "all", { type: "FeatureCollection", features: [] }), { initialProps: { theme: "dark" } });
    const check = () => {
      const ring = layers.get(PACKET_FLOW_GHOST_LAYER_ID) as CircleLayerSpecification;
      expect(ring.source).toBe(PACKET_FLOW_GHOST_SOURCE_ID);
      expect(ring.paint).toMatchObject({ "circle-radius": 3.5, "circle-opacity": 0, "circle-stroke-color": "#7C8798", "circle-stroke-width": 1.25, "circle-stroke-opacity": ["get", "a"], "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport" });
      const order = [...layers.keys()];
      expect(order.indexOf(PACKET_FLOW_GHOST_LAYER_ID)).toBeGreaterThan(order.indexOf(PACKET_FLOW_TRAIL_LAYER_ID));
      expect(order.indexOf(PACKET_FLOW_GHOST_LAYER_ID)).toBeLessThan(order.indexOf(PACKET_FLOW_DOT_HALO_LAYER_ID));
      expect(order.indexOf(PACKET_FLOW_GHOST_LAYER_ID)).toBeLessThan(order.indexOf(PACKET_FLOW_DOT_LAYER_ID));
    };
    check();
    layers.clear();
    sources.clear();
    rerender({ theme: "light" });
    check();
    unmount();
    expect(layers.size).toBe(0);
    expect(sources.size).toBe(0);
  });
});
