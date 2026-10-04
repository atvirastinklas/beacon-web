import type { ResolvedHop } from "../../types/api";
import { hasMapLocation } from "./location";

// Pure helpers for drawing a packet's path — the live flow animation (modelled on MeshMapper's
// LiveViz) and the path map share them. No maplibre import, so they stay unit-testable; the hook
// owns the layers, the rAF loop, and the node flashes.

// The full chain for one observation: source → relay hops → destination. An ambiguous endpoint
// (a 1-byte prefix matching several candidate nodes) would force us to guess which node sent or
// received the packet, so only plot endpoints the backend resolved unambiguously.
export function packetChain(
  source: ResolvedHop | null | undefined,
  path: ResolvedHop[],
  destination: ResolvedHop | null | undefined,
): ResolvedHop[] {
  const confident = (hop: ResolvedHop | null | undefined) => (hop?.confidence === "high" ? hop : undefined);
  return [confident(source), ...path, confident(destination)].filter((hop): hop is ResolvedHop => hop != null);
}

export function locatedHopNode(hop: ResolvedHop) {
  if (hop.confidence !== "high" || hop.nodes.length !== 1) return undefined;
  const node = hop.nodes[0]!;
  return hasMapLocation({ lat: node.latitude, lng: node.longitude }) ? node : undefined;
}

// Animate only a completely located, unambiguous chain; skipping a hop would invent a link.
export function resolvedPathNodes(resolvedPath: ResolvedHop[]): { id: string; lng: number; lat: number }[] {
  const seen = new Set<string>();
  const out: { id: string; lng: number; lat: number }[] = [];
  for (const hop of resolvedPath) {
    const node = locatedHopNode(hop);
    if (!node) return [];
    if (!seen.has(node.id)) {
      seen.add(node.id);
      out.push({ id: node.id, lng: node.longitude!, lat: node.latitude! });
    }
  }
  return out;
}

export type LivePathStop =
  | { id: string; lng: number; lat: number; ghost: false }
  | { id: null; lng: number; lat: number; ghost: true };

const longitudeDelta = (from: number, to: number) => ((to - from + 540) % 360) - 180;
const normalizeLongitude = (lng: number) => ((lng + 540) % 360) - 180;

// Live paths can show schematic stops for unknown hops, but only between located anchors.
// Trim unlocated ends rather than extrapolating them; preserve every remaining hop slot, including
// revisits. Ghost coordinates are illustrative, never a claim about a real node's position or ID.
export function livePathStops(chain: readonly ResolvedHop[]): LivePathStop[] {
  const anchors = chain.map(locatedHopNode);
  const first = anchors.findIndex(node => node !== undefined);
  if (first < 0) return [];
  const last = anchors.findLastIndex(node => node !== undefined);
  const realStop = (index: number): LivePathStop => {
    const node = anchors[index]!;
    return { id: node.id, lng: node.longitude!, lat: node.latitude!, ghost: false };
  };
  const stops: LivePathStop[] = [realStop(first)];
  for (let left = first; left < last;) {
    let right = left + 1;
    while (!anchors[right]) right++;
    const from = anchors[left]!;
    const to = anchors[right]!;
    for (let index = left + 1; index < right; index++) {
      const fraction = (index - left) / (right - left);
      stops.push({
        id: null,
        ghost: true,
        lng: normalizeLongitude(from.longitude! + longitudeDelta(from.longitude!, to.longitude!) * fraction),
        lat: from.latitude! + (to.latitude! - from.latitude!) * fraction,
      });
    }
    stops.push(realStop(right));
    left = right;
  }
  return stops;
}

// Unwrap rendering longitudes consistently for stops, dots and trails. A dateline crossing must
// follow the short segment, not sweep across the world; actual node coordinates remain unchanged.
export function livePathCoordinates(stops: readonly LivePathStop[]): [number, number][] {
  const coords: [number, number][] = [];
  for (const stop of stops) {
    const previous = coords.at(-1);
    const lng = previous ? previous[0] + longitudeDelta(normalizeLongitude(previous[0]), stop.lng) : stop.lng;
    coords.push([lng, stop.lat]);
  }
  return coords;
}

// Position at fractional hop index t (0 .. coords.length-1): the integer part picks the hop segment,
// the fraction interpolates within it. Constant time per hop, so long and short hops feel the same.
export function posAtHop(coords: [number, number][], t: number): [number, number] {
  const n = coords.length - 1;
  if (t <= 0) return coords[0]!;
  if (t >= n) return coords[n]!;
  const s = Math.floor(t);
  const f = t - s;
  const a = coords[s]!;
  const b = coords[s + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

// The polyline the dot has traced so far: every hop coord up to the head, plus the head position.
export function trailCoords(coords: [number, number][], headT: number): [number, number][] {
  const seg = Math.floor(headT);
  const out: [number, number][] = [];
  for (let s = 0; s <= seg && s < coords.length; s++) out.push(coords[s]!);
  out.push(posAtHop(coords, headT));
  return out;
}
