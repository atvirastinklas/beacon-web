import type { Feature, FeatureCollection, Point } from "geojson";
import type { NodeFeatureProps } from "./node-geojson";
import { PACKET_FLOW_HOP_MS, PACKET_FLOW_TRAIL_FADE_MS } from "./types";

export interface LiveFlowAnchor {
  nodeId: string;
  name?: string;
  coordinates: [number, number];
}

export interface LiveAnchorProps {
  nodeId: string;
  name: string | null;
  resolvedAnchor: true;
  a: number;
}

type VisibleLocations = ReadonlyMap<string, readonly [number, number][]>;
// Floating-point equivalence only; this is not a geographic proximity or hit tolerance.
const LOCATION_EPSILON = 1e-6;
const sameLocation = (a: readonly number[], b: readonly number[]) =>
  Math.abs(((a[0]! - b[0]! + 540) % 360 + 360) % 360 - 180) <= LOCATION_EPSILON &&
  Math.abs(a[1]! - b[1]!) <= LOCATION_EPSILON;

export function visibleAnchorLocations(nodes: FeatureCollection<Point, NodeFeatureProps>): VisibleLocations {
  const locations = new Map<string, [number, number][]>();
  for (const feature of nodes.features) {
    const [lng, lat] = feature.geometry.coordinates;
    if (lng === undefined || lat === undefined) continue;
    const id = feature.properties.id;
    const existing = locations.get(id) ?? [];
    existing.push([lng, lat]);
    locations.set(id, existing);
  }
  return locations;
}

export function flowOpacity(start: number, segments: number, now: number): number {
  return Math.max(0, Math.min(1, 1 - (now - (start + segments * PACKET_FLOW_HOP_MS)) / PACKET_FLOW_TRAIL_FADE_MS));
}

// Context markers explain real bends/endpoints without merging route nodes into the map dataset.
// Shared anchors hold the strongest remaining opacity and use a flow's own rendering world copy.
export function liveAnchorFeatures(
  flows: readonly { anchors: readonly LiveFlowAnchor[]; coords: readonly [number, number][]; start: number }[],
  visible: VisibleLocations,
  now: number,
): FeatureCollection<Point, LiveAnchorProps> {
  const byNode = new Map<string, Feature<Point, LiveAnchorProps>[]>();
  for (const flow of flows) {
    const opacity = flowOpacity(flow.start, flow.coords.length - 1, now);
    if (opacity <= 0) continue;
    for (const anchor of flow.anchors) {
      if (visible.get(anchor.nodeId)?.some(location => sameLocation(location, anchor.coordinates))) continue;
      const features = byNode.get(anchor.nodeId) ?? [];
      const existing = features.find(feature => sameLocation(feature.geometry.coordinates, anchor.coordinates));
      if (existing) {
        existing.properties.a = Math.max(existing.properties.a, opacity);
        if (!existing.properties.name && anchor.name) existing.properties.name = anchor.name;
      } else {
        features.push({
          type: "Feature",
          properties: { nodeId: anchor.nodeId, name: anchor.name ?? null, resolvedAnchor: true, a: opacity },
          geometry: { type: "Point", coordinates: anchor.coordinates },
        });
      }
      byNode.set(anchor.nodeId, features);
    }
  }
  return { type: "FeatureCollection", features: [...byNode.values()].flat() };
}
