import { describe, expect, it } from "vitest";
import type { FeatureCollection, Point } from "geojson";
import type { NodeFeatureProps } from "../../../src/features/map/node-geojson";
import { liveAnchorFeatures, visibleAnchorLocations, type LiveFlowAnchor } from "../../../src/features/map/live-path-anchors";

const empty: FeatureCollection<Point, NodeFeatureProps> = { type: "FeatureCollection", features: [] };
const anchor = (nodeId: string, lng = 25, lat = 54): LiveFlowAnchor => ({ nodeId, name: nodeId, coordinates: [lng, lat] });
const flow = (anchors: LiveFlowAnchor[], start = 0) => ({ anchors, start, coords: [[23, 55], [25, 54]] as [number, number][] });
const visible = (id: string, lng: number, lat: number) => visibleAnchorLocations({
  type: "FeatureCollection", features: [{ type: "Feature", properties: { id, name: id, nodeTypeName: "Repeater", isObserver: false }, geometry: { type: "Point", coordinates: [lng, lat] } }],
});

describe("live resolved anchor context", () => {
  it("suppresses only real nodes represented at the same coordinates", () => {
    expect(liveAnchorFeatures([flow([anchor("A")])], visible("A", 25, 54), 0).features).toEqual([]);
    expect(liveAnchorFeatures([flow([anchor("A")])], visible("A", 25, 55), 0).features).toHaveLength(1);
    expect(liveAnchorFeatures([flow([anchor("A")])], visible("B", 25, 54), 0).features).toHaveLength(1);
  });

  it("deduplicates shared identities/locations using the strongest remaining fade", () => {
    const features = liveAnchorFeatures([flow([anchor("A")]), flow([anchor("A"), anchor("A", 26)], 500)], visibleAnchorLocations(empty), 1000).features;
    expect(features).toHaveLength(2);
    expect(features.map(feature => feature.properties.a)).toEqual([0.98, 0.98]);
    expect(features.every(feature => feature.properties.nodeId === "A" && feature.properties.resolvedAnchor)).toBe(true);
    expect(features.every(feature => !("nodeTypeName" in feature.properties))).toBe(true);
  });

  it("compares equivalent dateline coordinates without rewriting the flow's world copy", () => {
    expect(liveAnchorFeatures([flow([anchor("A", 181)])], visible("A", -179, 54), 0).features).toEqual([]);
    const features = liveAnchorFeatures([flow([anchor("A", 181)]), flow([anchor("A", -179)])], visibleAnchorLocations(empty), 0).features;
    expect(features).toHaveLength(1);
    expect(features[0]!.geometry.coordinates).toEqual([181, 54]);
  });

  it("tolerates rounding but doesn't collapse distinct anchor locations", () => {
    expect(liveAnchorFeatures([flow([anchor("A")])], visible("A", 25 + 5e-7, 54), 0).features).toEqual([]);
    expect(liveAnchorFeatures([flow([anchor("A")])], visible("A", 25 + 1e-5, 54), 0).features).toHaveLength(1);
  });

  it("removes anchors when the last associated trail expires", () => {
    expect(liveAnchorFeatures([flow([anchor("A")])], visibleAnchorLocations(empty), 1481).features).toEqual([]);
  });
});
