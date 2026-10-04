import type { CircleLayerSpecification } from "maplibre-gl";
import { PACKET_FLOW_ANCHOR_LAYER_ID, PACKET_FLOW_ANCHOR_SOURCE_ID } from "./types";
import { LIVE_NODE_RADIUS, LIVE_NODE_STROKE_WIDTH } from "./live-marker-hit";

// Temporary, resolved path context. Neutral filled dots are real located hops, not ghost estimates
// or a claim about node role. Keep the same viewport footprint and native picking as live nodes.
export function resolvedPathAnchorLayer(): CircleLayerSpecification {
  return {
    id: PACKET_FLOW_ANCHOR_LAYER_ID,
    type: "circle",
    source: PACKET_FLOW_ANCHOR_SOURCE_ID,
    paint: {
      "circle-radius": LIVE_NODE_RADIUS,
      "circle-pitch-alignment": "viewport",
      "circle-pitch-scale": "viewport",
      "circle-color": "#7C8798",
      "circle-stroke-color": "#7C8798",
      "circle-stroke-width": LIVE_NODE_STROKE_WIDTH,
      "circle-opacity": ["get", "a"],
      "circle-stroke-opacity": ["get", "a"],
    },
  };
}
