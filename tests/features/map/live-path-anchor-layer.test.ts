import { describe, expect, it } from "vitest";
import { resolvedPathAnchorLayer } from "../../../src/features/map/live-path-anchor-layer";
import { PACKET_FLOW_ANCHOR_LAYER_ID, PACKET_FLOW_ANCHOR_SOURCE_ID } from "../../../src/features/map/types";
import { LIVE_NODE_RADIUS, LIVE_NODE_STROKE_WIDTH } from "../../../src/features/map/live-marker-hit";

describe("resolved path context paint", () => {
  it("renders a neutral filled tiny viewport circle with whole-flow fade and exact live hit extent", () => {
    const layer = resolvedPathAnchorLayer();
    expect(layer).toMatchObject({ id: PACKET_FLOW_ANCHOR_LAYER_ID, source: PACKET_FLOW_ANCHOR_SOURCE_ID, type: "circle" });
    expect(layer.paint).toEqual({
      "circle-radius": LIVE_NODE_RADIUS, "circle-stroke-width": LIVE_NODE_STROKE_WIDTH,
      "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport",
      "circle-color": "#7C8798", "circle-stroke-color": "#7C8798",
      "circle-opacity": ["get", "a"], "circle-stroke-opacity": ["get", "a"],
    });
    expect(LIVE_NODE_RADIUS + LIVE_NODE_STROKE_WIDTH).toBe(4.75);
    expect(JSON.stringify(layer)).not.toMatch(/nodeType|role|feature-state/);
  });
});
