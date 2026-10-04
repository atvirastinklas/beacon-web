import type { Map as MapLibreMap, MapMouseEvent, MapGeoJSONFeature } from "maplibre-gl";
import { LIVE_NODE_FOREGROUND_LAYER_ID, NODES_SOURCE_ID, PACKET_FLOW_GHOST_LAYER_ID, PACKET_FLOW_ANCHOR_LAYER_ID } from "./types";

export const LIVE_NODE_IDLE_LAYER_ID = "nodes-live-idle";
export const LIVE_NODE_RADIUS = 4;
export const LIVE_NODE_STROKE_WIDTH = 0.75;
export const LIVE_GHOST_RADIUS = 3.5;
export const LIVE_GHOST_STROKE_WIDTH = 1.25;

// Rendered features may use a canonical longitude while the visible marker is a world copy.
// Project the nearby copies with MapLibre's terrain-aware public API and anchor to the hit copy.
export function liveMarkerAnchor(map: MapLibreMap, feature: MapGeoJSONFeature, point: MapMouseEvent["point"]): [number, number] | null {
  if (feature.geometry.type !== "Point") return null;
  const [lng, lat] = feature.geometry.coordinates;
  if (lng === undefined || lat === undefined) return null;
  const wrap = Math.round((map.unproject(point).lng - lng) / 360);
  let closest: [number, number] = [lng + wrap * 360, lat];
  let distance = Infinity;
  for (const offset of [-1, 0, 1]) {
    const coordinate: [number, number] = [lng + (wrap + offset) * 360, lat];
    const projected = map.project(coordinate);
    const squared = (projected.x - point.x) ** 2 + (projected.y - point.y) ** 2;
    if (squared < distance) { closest = coordinate; distance = squared; }
  }
  return closest;
}

// Use the renderer's circle intersection at the exact pointer, not a symbol's padded rectangle.
// MapLibre applies the same pitch, terrain elevation and radius+stroke projection as the paint.
// Halos, selection rings, normal symbols and transparent foreground cores are never hit targets.
export function queryLiveMarkerHits(map: MapLibreMap, point: MapMouseEvent["point"]): {
  node: MapGeoJSONFeature | undefined;
  anchor: MapGeoJSONFeature | undefined;
  ghost: MapGeoJSONFeature | undefined;
} {
  const layers = [LIVE_NODE_FOREGROUND_LAYER_ID, LIVE_NODE_IDLE_LAYER_ID, PACKET_FLOW_ANCHOR_LAYER_ID, PACKET_FLOW_GHOST_LAYER_ID]
    .filter(id => map.getLayer(id));
  const features = layers.length ? map.queryRenderedFeatures(point, { layers }) : [];
  const active = features.find(f => f.layer.id === LIVE_NODE_FOREGROUND_LAYER_ID && typeof f.properties.id === "string" &&
    Number(map.getFeatureState({ source: NODES_SOURCE_ID, id: f.properties.id }).glow) > 0);
  const node = active ?? features.find(f => f.layer.id === LIVE_NODE_IDLE_LAYER_ID && typeof f.properties.id === "string");
  const anchor = features.find(f => f.layer.id === PACKET_FLOW_ANCHOR_LAYER_ID && f.properties.resolvedAnchor === true &&
    typeof f.properties.nodeId === "string" && Number(f.properties.a) > 0);
  const ghost = features.find(f => f.layer.id === PACKET_FLOW_GHOST_LAYER_ID && f.properties.inferred === true && Number(f.properties.a) > 0);
  return { node, anchor, ghost };
}
