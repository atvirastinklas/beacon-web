import { useState } from "react";
import type { FeatureCollection, Point } from "geojson";
import type { PacketPath } from "../map/packet-path";
import type { NodeFeatureProps } from "../map/node-geojson";

export type MeshlogMarkers = FeatureCollection<Point, NodeFeatureProps & { title: string; color: string }>;

/** Preserve a semantic publication through unrelated loading/detail/hover updates. */
export function useEqualMapInput<T>(input: T, equal: (a: T, b: T) => boolean): T {
  const [stable, setStable] = useState(input);
  if (!equal(stable, input)) { setStable(input); return input; }
  return stable;
}

export function sameMarkers(a: MeshlogMarkers, b: MeshlogMarkers): boolean {
  return a === b || (a.features.length === b.features.length && a.features.every((feature, index) => {
    const other = b.features[index]!;
    const p = feature.properties, q = other.properties;
    return feature.geometry.coordinates[0] === other.geometry.coordinates[0] && feature.geometry.coordinates[1] === other.geometry.coordinates[1]
      && p.id === q.id && p.name === q.name && p.title === q.title && p.color === q.color && p.nodeTypeName === q.nodeTypeName && p.isObserver === q.isObserver;
  }));
}

export function samePaths(a: PacketPath[], b: PacketPath[]): boolean {
  return a === b || (a.length === b.length && a.every((path, index) => {
    const other = b[index]!;
    return path === other || (path.key === other.key && path.color === other.color && path.label === other.label && path.points.length === other.points.length
      && path.points.every((point, i) => {
        const q = other.points[i]!;
        return point.id === q.id && point.name === q.name && point.lng === q.lng && point.lat === q.lat && !!point.breakBefore === !!q.breakBefore;
      }));
  }));
}
