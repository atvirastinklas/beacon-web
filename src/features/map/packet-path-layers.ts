import type { Map as MapLibreMap, GeoJSONSource, LineLayerSpecification, CircleLayerSpecification, SymbolLayerSpecification } from "maplibre-gl";
import { packetPathsToFeatures, type PacketPath } from "./packet-path";

// These maps own dedicated instances, so the packet-path ids need no registry.
const LINE_SOURCE = "pp-lines";
const LINE_LAYER = "pp-lines";
const NODE_SOURCE = "pp-nodes";
export const PACKET_PATH_NODE_LAYER = "pp-nodes";
const NODE_LABEL_LAYER = "pp-node-labels";

function paletteVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Update Beacon's packet-path visual layers. The caller owns readiness and framing. */
export function updatePacketPathLayers(map: MapLibreMap, paths: PacketPath[], selectedKey: string | null): [number, number][] {
  const { lines, points, bounds } = packetPathsToFeatures(paths, selectedKey);

  if (!map.getSource(LINE_SOURCE)) map.addSource(LINE_SOURCE, { type: "geojson", data: lines });
  if (!map.getLayer(LINE_LAYER)) {
    map.addLayer({
      id: LINE_LAYER, type: "line", source: LINE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": 0.9 },
    } as LineLayerSpecification);
  }
  if (!map.getSource(NODE_SOURCE)) map.addSource(NODE_SOURCE, { type: "geojson", data: points });
  if (!map.getLayer(PACKET_PATH_NODE_LAYER)) {
    map.addLayer({
      id: PACKET_PATH_NODE_LAYER, type: "circle", source: NODE_SOURCE,
      paint: {
        "circle-radius": ["case", ["==", ["get", "endpoint"], "mid"], 4, 6],
        "circle-color": ["get", "color"],
        // White ring marks the observer end; every other node gets a dark ring.
        "circle-stroke-width": 2,
        "circle-stroke-color": ["case", ["==", ["get", "endpoint"], "end"], "#ffffff", "#00000088"],
      },
    } as CircleLayerSpecification);
  }
  const textColor = paletteVar("--palette-text-bright", "#e5e7eb");
  const haloColor = paletteVar("--palette-bg-base", "#0a0a0a");
  if (!map.getLayer(NODE_LABEL_LAYER)) {
    map.addLayer({
      id: NODE_LABEL_LAYER, type: "symbol", source: NODE_SOURCE,
      layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": textColor, "text-halo-color": haloColor, "text-halo-width": 1.4 },
    } as SymbolLayerSpecification);
  } else {
    map.setPaintProperty(NODE_LABEL_LAYER, "text-color", textColor);
    map.setPaintProperty(NODE_LABEL_LAYER, "text-halo-color", haloColor);
  }

  (map.getSource(LINE_SOURCE) as GeoJSONSource).setData(lines);
  (map.getSource(NODE_SOURCE) as GeoJSONSource).setData(points);
  return bounds;
}
