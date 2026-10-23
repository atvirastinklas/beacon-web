import { useEffect, type RefObject } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { PacketDetail } from "../../types/api";
import { buildPacketPaths, packetPathsToFeatures } from "./packet-path";
import {
  LIVE_NODE_FOREGROUND_LAYER_ID, NODES_CLUSTER_LAYER_ID, NODES_POINT_LAYER_ID,
  NODES_SELECTED_LAYER_ID, NODES_SELECTED_LEAF_LAYER_ID,
  PACKET_FLOW_ANCHOR_LAYER_ID, PACKET_FLOW_GHOST_LAYER_ID,
  PACKET_FLOW_DOT_HALO_LAYER_ID, PACKET_FLOW_DOT_LAYER_ID,
} from "./types";

const SOURCE_ID = "selected-packet-paths";
const LINE_LAYER_ID = "selected-packet-path-lines";
const NODE_SOURCE_ID = "selected-packet-path-nodes";
const NODE_LAYER_ID = "selected-packet-path-nodes";
const NODE_LABEL_LAYER_ID = "selected-packet-path-labels";
// A separate selection role, never the live traffic color or the per-observer path palette.
const SELECTED_PATH_COLOR = "#3b82f6";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const MARKER_LAYERS = new Set<string>([
  NODES_CLUSTER_LAYER_ID, NODES_POINT_LAYER_ID, LIVE_NODE_FOREGROUND_LAYER_ID,
  NODES_SELECTED_LAYER_ID, NODES_SELECTED_LEAF_LAYER_ID,
  PACKET_FLOW_ANCHOR_LAYER_ID, PACKET_FLOW_GHOST_LAYER_ID,
  PACKET_FLOW_DOT_HALO_LAYER_ID, PACKET_FLOW_DOT_LAYER_ID,
]);
const LIVE_DOT_LAYERS = new Set<string>([PACKET_FLOW_DOT_HALO_LAYER_ID, PACKET_FLOW_DOT_LAYER_ID]);

function paletteVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Static selection context only. The caller passes null when the selected packet is hidden. */
export function useMapSelectedPacketPaths(
  mapRef: RefObject<MapLibreMap | null>,
  isReady: boolean,
  detail: PacketDetail | null,
  themeKey: string,
) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    const { lines, points } = detail ? packetPathsToFeatures(buildPacketPaths(detail), null) : { lines: EMPTY, points: EMPTY };
    for (const [id, data] of [[SOURCE_ID, lines], [NODE_SOURCE_ID, points]] as const) {
      const source = map.getSource(id) as GeoJSONSource | undefined;
      if (source) source.setData(data);
      else map.addSource(id, { type: "geojson", data });
    }

    if (!map.getLayer(LINE_LAYER_ID)) {
      // Use the actual stack order: live dots and node markers must both stay above selection.
      const beforeId = map.getStyle().layers?.find(layer => MARKER_LAYERS.has(layer.id))?.id;
      map.addLayer({
        id: LINE_LAYER_ID, source: SOURCE_ID, type: "line",
        layout: { "line-cap": "round", "line-join": "round" },
        // Solid/static also distinguishes selection from the dashed, animated orange traffic.
        paint: { "line-color": SELECTED_PATH_COLOR, "line-width": 2.5, "line-opacity": 0.9 },
      }, beforeId);
    }
    // Match Packet Path's located-node drawing; never add markers for inferred unknown hops.
    // Above normal node markers for visibility, but below moving live dots and their halos.
    const beforeDot = map.getStyle().layers?.find(layer => LIVE_DOT_LAYERS.has(layer.id))?.id;
    if (!map.getLayer(NODE_LAYER_ID)) {
      map.addLayer({
        id: NODE_LAYER_ID, type: "circle", source: NODE_SOURCE_ID,
        paint: {
          "circle-radius": ["case", ["==", ["get", "endpoint"], "mid"], 4, 6],
          "circle-color": SELECTED_PATH_COLOR,
          "circle-stroke-width": 2,
          "circle-stroke-color": ["case", ["==", ["get", "endpoint"], "end"], "#ffffff", "#00000088"],
        },
      }, beforeDot);
    }
    const textColor = paletteVar("--palette-text-bright", "#e5e7eb");
    const haloColor = paletteVar("--palette-bg-base", "#0a0a0a");
    if (!map.getLayer(NODE_LABEL_LAYER_ID)) {
      map.addLayer({
        id: NODE_LABEL_LAYER_ID, type: "symbol", source: NODE_SOURCE_ID,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11,
          "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
        paint: { "text-color": textColor, "text-halo-color": haloColor, "text-halo-width": 1.4 },
      }, beforeDot);
    } else {
      map.setPaintProperty(NODE_LABEL_LAYER_ID, "text-color", textColor);
      map.setPaintProperty(NODE_LABEL_LAYER_ID, "text-halo-color", haloColor);
    }
  }, [mapRef, isReady, detail, themeKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    return () => {
      try {
        for (const id of [NODE_LABEL_LAYER_ID, NODE_LAYER_ID, LINE_LAYER_ID]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        for (const id of [NODE_SOURCE_ID, SOURCE_ID]) {
          if (map.getSource(id)) map.removeSource(id);
        }
      } catch {
        // The style or map may already have been removed by its owner.
      }
    };
  }, [mapRef, isReady]);
}
