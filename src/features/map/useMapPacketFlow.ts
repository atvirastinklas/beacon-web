import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Map as MapLibreMap, GeoJSONSource, CircleLayerSpecification, LineLayerSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, Point, LineString } from "geojson";
import type { WsManager } from "../../api/ws-manager";
import { packetChain, locatedHopNode, livePathStops, livePathCoordinates, posAtHop, trailCoords } from "./packet-flow";
import type { NodeFeatureProps } from "./node-geojson";
import { flowOpacity, liveAnchorFeatures, visibleAnchorLocations, type LiveFlowAnchor } from "./live-path-anchors";
import { resolvedPathAnchorLayer } from "./live-path-anchor-layer";
import { LIVE_GHOST_RADIUS, LIVE_GHOST_STROKE_WIDTH } from "./live-marker-hit";
import {
  PACKET_FLOW_TRAIL_SOURCE_ID,
  PACKET_FLOW_TRAIL_LAYER_ID,
  PACKET_FLOW_DOT_SOURCE_ID,
  PACKET_FLOW_DOT_HALO_LAYER_ID,
  PACKET_FLOW_DOT_LAYER_ID,
  PACKET_FLOW_GHOST_SOURCE_ID,
  PACKET_FLOW_GHOST_LAYER_ID,
  PACKET_FLOW_ANCHOR_SOURCE_ID,
  PACKET_FLOW_ANCHOR_LAYER_ID,
  PACKET_FLOW_COLOR,
  PACKET_FLOW_HOP_MS,
  PACKET_FLOW_MAX,
  NODES_SOURCE_ID,
} from "./types";

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

// one packet riding its hop path once
interface Flow {
  coords: [number, number][];
  ids: (string | null)[];
  anchors: LiveFlowAnchor[];
  start: number;
  lastNode: number;
}

// Live mode: per observed packet shoot an orange dot along its known/inferred hop path with a fading
// dashed trail, highlighting only real nodes. Enabling it opts the WS connection into resolvedPath
// data. Geometry is pure (packet-flow.ts); here we own the packet layers, rAF loop and subscription.
export function useMapPacketFlow(
  mapRef: React.RefObject<MapLibreMap | null>,
  isReady: boolean,
  enabled: boolean,
  wsManager: WsManager,
  themeKey: string,
  resetKey: string,
  visibleNodes: FeatureCollection<Point, NodeFeatureProps>,
) {
  const flowsRef = useRef<Flow[]>([]);
  const litRef = useRef<Set<string>>(new Set()); // node ids currently lit (feature-state glow set)
  const rafRef = useRef<number | null>(null);
  const visibleLocations = useMemo(() => visibleAnchorLocations(visibleNodes), [visibleNodes]);
  const visibleLocationsRef = useRef(visibleLocations);
  const snapshotsRef = useRef<Record<string, FeatureCollection>>({});

  const updateAnchors = useCallback((now: number) => {
    const data = liveAnchorFeatures(flowsRef.current, visibleLocationsRef.current, now);
    snapshotsRef.current[PACKET_FLOW_ANCHOR_SOURCE_ID] = data;
    (mapRef.current?.getSource(PACKET_FLOW_ANCHOR_SOURCE_ID) as GeoJSONSource | undefined)?.setData(data);
  }, [mapRef]);

  // Pagination and filters change representation, not the observations' animation clocks.
  useEffect(() => {
    visibleLocationsRef.current = visibleLocations;
    if (isReady) updateAnchors(performance.now());
  }, [visibleLocations, isReady, updateAnchors]);

  const clearFlows = useCallback((map: MapLibreMap | null) => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    flowsRef.current = [];
    snapshotsRef.current = {};
    // guard the whole block: on a not-yet-ready or torn-down map, getSource/setFeatureState throw
    try {
      for (const id of litRef.current) map?.removeFeatureState({ source: NODES_SOURCE_ID, id }, "glow");
      (map?.getSource(PACKET_FLOW_TRAIL_SOURCE_ID) as GeoJSONSource | undefined)?.setData(EMPTY_FC);
      (map?.getSource(PACKET_FLOW_DOT_SOURCE_ID) as GeoJSONSource | undefined)?.setData(EMPTY_FC);
      (map?.getSource(PACKET_FLOW_GHOST_SOURCE_ID) as GeoJSONSource | undefined)?.setData(EMPTY_FC);
      (map?.getSource(PACKET_FLOW_ANCHOR_SOURCE_ID) as GeoJSONSource | undefined)?.setData(EMPTY_FC);
    } catch {
      // map style not ready / already removed
    }
    litRef.current.clear();
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) return;
    function frame() {
      const map = mapRef.current;
      const now = performance.now();

      const dots: Feature<Point>[] = [];
      const lines: Feature<LineString>[] = [];
      const ghosts: Feature<Point>[] = [];
      const glowByNode = new Map<string, number>(); // node id -> glow this frame (max across packets)

      for (let i = flowsRef.current.length - 1; i >= 0; i--) {
        const p = flowsRef.current[i]!;
        const nSeg = p.coords.length - 1;
        const t = (now - p.start) / PACKET_FLOW_HOP_MS;
        const node = Math.min(nSeg, Math.floor(t + 1e-6));
        if (node > p.lastNode) p.lastNode = node;
        const headT = Math.min(t, nSeg);
        // full while the dot is travelling, then eases out with the trail after it reaches the end
        const fade = flowOpacity(p.start, nSeg, now);

        const coords = trailCoords(p.coords, headT);
        if (coords.length >= 2) {
          lines.push({ type: "Feature", properties: { a: 0.6 * fade }, geometry: { type: "LineString", coordinates: coords } });
        }
        if (t <= nSeg) {
          dots.push({ type: "Feature", properties: { r: 5, a: 1 }, geometry: { type: "Point", coordinates: posAtHop(p.coords, headT) } });
        }
        // light every node the dot has reached; they hold at full while it travels, then fade with the trail
        if (fade > 0) {
          for (let k = 0; k < p.coords.length; k++) {
            if (p.ids[k] === null) {
              ghosts.push({ type: "Feature", properties: { a: fade, inferred: true }, geometry: { type: "Point", coordinates: p.coords[k]! } });
            }
          }
          for (let k = 0; k <= p.lastNode; k++) {
            const id = p.ids[k];
            if (id != null) glowByNode.set(id, Math.max(glowByNode.get(id) ?? 0, fade));
          }
        }
        if (t > nSeg && fade <= 0) flowsRef.current.splice(i, 1);
      }

      // apply node glows via feature-state; drop nodes that are no longer lit by any packet
      try {
        for (const [id, g] of glowByNode) map?.setFeatureState({ source: NODES_SOURCE_ID, id }, { glow: g });
        for (const id of litRef.current) {
          if (!glowByNode.has(id)) map?.removeFeatureState({ source: NODES_SOURCE_ID, id }, "glow");
        }
      } catch { /* node gone */ }
      litRef.current = new Set(glowByNode.keys());

      for (const [source, features] of [[PACKET_FLOW_TRAIL_SOURCE_ID, lines], [PACKET_FLOW_DOT_SOURCE_ID, dots], [PACKET_FLOW_GHOST_SOURCE_ID, ghosts]] as const) {
        const data: FeatureCollection = { type: "FeatureCollection", features: [...features] };
        snapshotsRef.current[source] = data;
        (map?.getSource(source) as GeoJSONSource | undefined)?.setData(data);
      }
      updateAnchors(now);

      const busy = flowsRef.current.length > 0 || litRef.current.size > 0;
      rafRef.current = busy ? requestAnimationFrame(frame) : null;
    }
    rafRef.current = requestAnimationFrame(frame);
  }, [mapRef, updateAnchors]);

  // build the trail + dot layers (re-add after a style switch); the dot is orange with a white stroke
  // and a dark halo behind it, the trail a dashed line whose opacity is data-driven
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;

    if (!map.getSource(PACKET_FLOW_TRAIL_SOURCE_ID)) {
      map.addSource(PACKET_FLOW_TRAIL_SOURCE_ID, { type: "geojson", data: snapshotsRef.current[PACKET_FLOW_TRAIL_SOURCE_ID] ?? EMPTY_FC });
    }
    if (!map.getSource(PACKET_FLOW_GHOST_SOURCE_ID)) {
      map.addSource(PACKET_FLOW_GHOST_SOURCE_ID, { type: "geojson", data: snapshotsRef.current[PACKET_FLOW_GHOST_SOURCE_ID] ?? EMPTY_FC });
    }
    if (!map.getLayer(PACKET_FLOW_TRAIL_LAYER_ID)) {
      map.addLayer({
        id: PACKET_FLOW_TRAIL_LAYER_ID,
        type: "line",
        source: PACKET_FLOW_TRAIL_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": PACKET_FLOW_COLOR, "line-width": 2.5, "line-dasharray": [2, 2], "line-opacity": ["get", "a"] },
      } as LineLayerSpecification);
    }
    if (!map.getLayer(PACKET_FLOW_GHOST_LAYER_ID)) {
      map.addLayer({
        id: PACKET_FLOW_GHOST_LAYER_ID,
        type: "circle",
        source: PACKET_FLOW_GHOST_SOURCE_ID,
        paint: {
          "circle-radius": LIVE_GHOST_RADIUS,
          "circle-pitch-alignment": "viewport",
          "circle-pitch-scale": "viewport",
          "circle-opacity": 0,
          // Hollow neutral rings denote inferred positions, never a real node role.
          // This midtone contrasts with both light and dark basemaps.
          "circle-stroke-color": "#7C8798",
          "circle-stroke-width": LIVE_GHOST_STROKE_WIDTH,
          "circle-stroke-opacity": ["get", "a"],
        },
      } satisfies CircleLayerSpecification, map.getLayer(PACKET_FLOW_DOT_HALO_LAYER_ID) ? PACKET_FLOW_DOT_HALO_LAYER_ID : undefined);
    }
    if (!map.getSource(PACKET_FLOW_ANCHOR_SOURCE_ID)) {
      map.addSource(PACKET_FLOW_ANCHOR_SOURCE_ID, { type: "geojson", data: snapshotsRef.current[PACKET_FLOW_ANCHOR_SOURCE_ID] ?? EMPTY_FC });
    }
    if (!map.getLayer(PACKET_FLOW_ANCHOR_LAYER_ID)) {
      map.addLayer(resolvedPathAnchorLayer(), map.getLayer(PACKET_FLOW_DOT_HALO_LAYER_ID) ? PACKET_FLOW_DOT_HALO_LAYER_ID : undefined);
    }
    if (!map.getSource(PACKET_FLOW_DOT_SOURCE_ID)) {
      map.addSource(PACKET_FLOW_DOT_SOURCE_ID, { type: "geojson", data: snapshotsRef.current[PACKET_FLOW_DOT_SOURCE_ID] ?? EMPTY_FC });
    }
    if (!map.getLayer(PACKET_FLOW_DOT_HALO_LAYER_ID)) {
      map.addLayer({
        id: PACKET_FLOW_DOT_HALO_LAYER_ID,
        type: "circle",
        source: PACKET_FLOW_DOT_SOURCE_ID,
        paint: { "circle-radius": ["+", ["get", "r"], 2.4], "circle-color": "rgba(0,0,0,0.5)", "circle-opacity": ["*", ["get", "a"], 0.5], "circle-blur": 0.5 },
      } as CircleLayerSpecification);
    }
    if (!map.getLayer(PACKET_FLOW_DOT_LAYER_ID)) {
      map.addLayer({
        id: PACKET_FLOW_DOT_LAYER_ID,
        type: "circle",
        source: PACKET_FLOW_DOT_SOURCE_ID,
        paint: {
          "circle-radius": ["get", "r"],
          "circle-color": PACKET_FLOW_COLOR,
          "circle-opacity": ["get", "a"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["*", ["get", "a"], 1.1],
        },
      } as CircleLayerSpecification);
    }
  }, [mapRef, isReady, themeKey]);

  // connection-wide resolvePath toggle: on while enabled, off otherwise
  useEffect(() => {
    wsManager.setResolvePath(enabled);
    return () => wsManager.setResolvePath(false);
  }, [enabled, wsManager]);

  // Node styling and foreground activity are owned by useMapNodes; here we only feed it the
  // per-node glow feature-state so idle dots remain visible independently of packet activity.

  // launch a flow per observed packet; tear the animation down when disabled
  useEffect(() => {
    if (!enabled) return;
    const map = mapRef.current;
    const unsub = wsManager.onPacketObservation((data) => {
      const obs = data.observation;
      // resolvedPath is opt-in and the toggle above lands a beat after connect, but the endpoints
      // always ship — bail rather than animate a bare source→destination hop that never happened.
      if (!obs?.resolvedPath) return;
      const chain = packetChain(obs.resolvedSource, obs.resolvedPath, obs.resolvedDestination);
      const stops = livePathStops(chain);
      if (stops.length < 2) return; // need two located anchors; unknown ends are never extrapolated
      const coords = livePathCoordinates(stops);
      const names = new Map(chain.map(locatedHopNode).filter(node => node !== undefined).map(node => [node.id, node.name]));
      while (flowsRef.current.length >= PACKET_FLOW_MAX) flowsRef.current.shift();
      flowsRef.current.push({
        coords,
        ids: stops.map(stop => stop.id),
        anchors: stops.flatMap((stop, index) => stop.id === null ? [] : [{ nodeId: stop.id, name: names.get(stop.id), coordinates: coords[index]! }]),
        start: performance.now(),
        lastNode: -1,
      });
      updateAnchors(performance.now());
      startLoop();
    });

    return () => {
      unsub();
      clearFlows(map);
    };
  }, [enabled, wsManager, mapRef, startLoop, clearFlows, updateAnchors]);

  // clear on region change (paths came from the old dataset)
  useEffect(() => {
    clearFlows(mapRef.current);
  }, [resetKey, mapRef, clearFlows]);

  // remove layers + sources on unmount (after useMapLibre's map.remove(), hence the try)
  useEffect(() => {
    const map = mapRef.current;
    return () => {
      clearFlows(map);
      if (!map) return;
      try {
        for (const id of [PACKET_FLOW_TRAIL_LAYER_ID, PACKET_FLOW_GHOST_LAYER_ID, PACKET_FLOW_ANCHOR_LAYER_ID, PACKET_FLOW_DOT_HALO_LAYER_ID, PACKET_FLOW_DOT_LAYER_ID]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        for (const id of [PACKET_FLOW_TRAIL_SOURCE_ID, PACKET_FLOW_DOT_SOURCE_ID, PACKET_FLOW_GHOST_SOURCE_ID, PACKET_FLOW_ANCHOR_SOURCE_ID]) {
          if (map.getSource(id)) map.removeSource(id);
        }
      } catch {
        // map may already be torn down
      }
    };
  }, [mapRef, clearFlows]);
}
