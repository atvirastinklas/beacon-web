import { describe, it, expect } from "vitest";
import { packetChain, resolvedPathNodes, livePathStops, livePathCoordinates, posAtHop, trailCoords } from "../../../src/features/map/packet-flow";
import type { ResolvedHop } from "../../../src/types/api";

function hop(id: string, lng: number, lat: number): ResolvedHop {
  return { confidence: "high", nodes: [{ id, publicKey: "pk", longitude: lng, latitude: lat }] };
}

describe("packetChain", () => {
  const relay = hop("r", -75, 45);

  it("wraps the relay hops in a high-confidence source and destination", () => {
    const src = hop("s", -70, 40);
    const dst = hop("d", -80, 50);
    expect(packetChain(src, [relay], dst)).toEqual([src, relay, dst]);
  });

  it("drops ambiguous and unresolved endpoints", () => {
    const ambiguous: ResolvedHop = { confidence: "ambiguous", nodes: [{ id: "x", publicKey: "pk", longitude: -70, latitude: 40 }] };
    expect(packetChain(ambiguous, [relay], { confidence: "none", nodes: [] })).toEqual([relay]);
  });

  it("accepts null or absent endpoints and leaves relay hops untouched", () => {
    const ambiguousRelay: ResolvedHop = { confidence: "ambiguous", nodes: [{ id: "y", publicKey: "pk", longitude: -76, latitude: 46 }] };
    expect(packetChain(null, [relay, ambiguousRelay], undefined)).toEqual([relay, ambiguousRelay]);
  });
});

describe("resolvedPathNodes", () => {
  it("suppresses an animation when a gap would invent a link", () => {
    const path: ResolvedHop[] = [hop("a", -75, 45), { confidence: "none", nodes: [] }, hop("a", -75, 45), hop("b", -76, 46)];
    expect(resolvedPathNodes(path)).toEqual([]);
    expect(resolvedPathNodes([hop("a", -75, 45), hop("a", -75, 45), hop("b", -76, 46)])).toEqual([{ id: "a", lng: -75, lat: 45 }, { id: "b", lng: -76, lat: 46 }]);
  });

  it("skips hops with no located candidate", () => {
    expect(resolvedPathNodes([{ confidence: "ambiguous", nodes: [{ id: "x", publicKey: "pk" }] }])).toEqual([]);
  });

  it("rejects reset/invalid and ambiguous locations while accepting valid zero axes", () => {
    const candidates: ResolvedHop = { confidence: "ambiguous", nodes: [...hop("reset", 0, 0).nodes, ...hop("invalid", 10, 91).nodes, ...hop("valid", 0, 45).nodes] };
    expect(resolvedPathNodes([hop("unknown", 0, 0), candidates, hop("bad", Infinity, 10)])).toEqual([]);
    expect(resolvedPathNodes([hop("valid", 0, 45)])).toEqual([{ id: "valid", lng: 0, lat: 45 }]);
  });
});

describe("livePathStops", () => {
  const unknown: ResolvedHop = { confidence: "none", nodes: [] };

  it("places two ghost stops between located A and D without assigning real node IDs", () => {
    expect(livePathStops([hop("A", 0, 50), unknown, unknown, hop("D", 3, 53)])).toEqual([
      { id: "A", lng: 0, lat: 50, ghost: false },
      { id: null, lng: 1, lat: 51, ghost: true },
      { id: null, lng: 2, lat: 52, ghost: true },
      { id: "D", lng: 3, lat: 53, ghost: false },
    ]);
  });

  it("stops at C when D is unlocated, trimming both unknown prefixes and suffixes", () => {
    const a = hop("A", 0, 50), b = hop("B", 1, 51), c = hop("C", 2, 52);
    expect(livePathStops([unknown, a, b, c, unknown, unknown])).toEqual([
      { id: "A", lng: 0, lat: 50, ghost: false },
      { id: "B", lng: 1, lat: 51, ghost: false },
      { id: "C", lng: 2, lat: 52, ghost: false },
    ]);
  });

  it("fills each interior unknown run independently without moving known anchors", () => {
    const stops = livePathStops([hop("A", 0, 50), unknown, hop("C", 2, 52), unknown, unknown, hop("F", 8, 58)]);
    expect(stops.map(stop => [stop.lng, stop.lat])).toEqual([[0, 50], [1, 51], [2, 52], [4, 54], [6, 56], [8, 58]]);
    expect(stops.filter(stop => !stop.ghost).map(stop => stop.id)).toEqual(["A", "C", "F"]);
  });

  it("keeps interpolated hops straight and preserves a turn only at the resolved intermediate node", () => {
    const a = hop("Kaunas", 23.9, 54.9);
    const b = hop("Turn", 25, 54.7);
    const c = hop("Next repeater", 24.9, 54.5);
    const stops = livePathStops([a, unknown, unknown, b, c]);
    expect(stops.map(stop => stop.id)).toEqual(["Kaunas", null, null, "Turn", "Next repeater"]);
    const coords = livePathCoordinates(stops);
    const [start, end] = [coords[0]!, coords[3]!];
    for (const point of coords.slice(1, 3)) {
      const crossProduct = (point[0] - start[0]) * (end[1] - start[1]) - (point[1] - start[1]) * (end[0] - start[0]);
      expect(crossProduct).toBeCloseTo(0, 10);
    }
    expect(coords[3]![0]).toBeCloseTo(25, 10);
    expect(coords[3]![1]).toBe(54.7);
    expect(coords[4]![0]).toBeCloseTo(24.9, 10);
    expect(coords[4]![1]).toBe(54.5);
  });

  it("requires located anchors and doesn't extrapolate from a single node", () => {
    expect(livePathStops([])).toEqual([]);
    expect(livePathStops([unknown, unknown])).toEqual([]);
    expect(livePathStops([unknown, hop("B", 1, 51), unknown])).toEqual([{ id: "B", lng: 1, lat: 51, ghost: false }]);
  });

  it("treats ambiguous, missing, reset and invalid coordinates as unknown rather than guessing a candidate", () => {
    const ambiguous: ResolvedHop = { confidence: "ambiguous", nodes: hop("candidate", 20, 60).nodes };
    const multiple: ResolvedHop = { confidence: "high", nodes: [...hop("one", 20, 60).nodes, ...hop("two", 21, 61).nodes] };
    const missing: ResolvedHop = { confidence: "high", nodes: [{ id: "missing", publicKey: "pk" }] };
    const middle = [ambiguous, multiple, missing, hop("reset", 0, 0), hop("invalid", Infinity, 91)];
    const stops = livePathStops([hop("A", 0, 50), ...middle, hop("G", 6, 56)]);
    expect(stops).toHaveLength(7);
    expect(stops.slice(1, -1).every(stop => stop.ghost && stop.id === null)).toBe(true);
    expect(stops.map(stop => stop.lng)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("preserves return visits, adjacent repeats and distinct nodes at the same position", () => {
    const a = hop("A", 0, 50), b = hop("B", 1, 51);
    expect(livePathStops([a, b, a]).map(stop => stop.id)).toEqual(["A", "B", "A"]);
    expect(livePathStops([a, a, hop("other", 0, 50)]).map(stop => stop.id)).toEqual(["A", "A", "other"]);
    expect(livePathStops([a, unknown, a])[1]).toEqual({ id: null, lng: 0, lat: 50, ghost: true });
  });

  it.each([[179, -179, [179, 180, 181]], [-179, 179, [-179, -180, -181]]] as const)(
    "takes the short dateline route from %s to %s for ghost stops, dot and trail geometry", (from, to, expected) => {
      const stops = livePathStops([hop("A", from, 50), unknown, hop("C", to, 52)]);
      expect(stops[0].lng).toBe(from);
      expect(stops[2].lng).toBe(to);
      const coords = livePathCoordinates(stops);
      expect(coords.map(coord => coord[0])).toEqual([...expected]);
      expect(posAtHop(coords, 0.5)[0]).toBe((expected[0] + expected[1]) / 2);
      expect(trailCoords(coords, 2)).toEqual([...coords, coords.at(-1)]);
    },
  );
});

describe("posAtHop", () => {
  const coords: [number, number][] = [[0, 0], [10, 0], [10, 10]];

  it("returns hop endpoints at integer t and interpolates within a segment", () => {
    expect(posAtHop(coords, 0)).toEqual([0, 0]);
    expect(posAtHop(coords, 1)).toEqual([10, 0]);
    expect(posAtHop(coords, 2)).toEqual([10, 10]);
    expect(posAtHop(coords, 0.5)).toEqual([5, 0]); // halfway through hop 0
    expect(posAtHop(coords, 1.5)).toEqual([10, 5]); // halfway through hop 1
  });

  it("clamps beyond either end", () => {
    expect(posAtHop(coords, -1)).toEqual([0, 0]);
    expect(posAtHop(coords, 9)).toEqual([10, 10]);
  });
});

describe("trailCoords", () => {
  const coords: [number, number][] = [[0, 0], [10, 0], [10, 10]];

  it("traces every crossed hop plus the current head position", () => {
    expect(trailCoords(coords, 1.5)).toEqual([[0, 0], [10, 0], [10, 5]]);
  });
});
