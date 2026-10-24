import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import type { NodeFeatureProps } from "../map/node-geojson";
import { useMapPacketFlow, type PacketFlowSource } from "../map/useMapPacketFlow";
import type { MeshlogLiveBatch } from "./types";

interface MeshlogPacketFlowOptions {
  mapRef: RefObject<MapLibreMap | null>;
  isReady: boolean;
  enabled: boolean;
  batch?: MeshlogLiveBatch;
  visibleReportKeys: ReadonlySet<string>;
  themeKey: string;
  resetKey: string;
  visibleNodes: FeatureCollection<Point, NodeFeatureProps>;
}

/** Drain each real-time publication once, never replaying history or later hydration. */
export function useMeshlogPacketFlow({ mapRef, isReady, enabled, batch, visibleReportKeys, themeKey, resetKey, visibleNodes }: MeshlogPacketFlowOptions) {
  const listeners = useRef(new Set<Parameters<PacketFlowSource["onPacketObservation"]>[0]>());
  const consumed = useRef(batch?.sequence ?? 0);
  const source = useMemo<PacketFlowSource>(() => ({
    onPacketObservation(listener) {
      listeners.current.add(listener);
      return () => { listeners.current.delete(listener); };
    },
  }), []);

  // Socket resolution is owned by the Meshlog session, not by this animation switch.
  useMapPacketFlow(mapRef, isReady, enabled && isReady, source, themeKey, resetKey, visibleNodes, "meshlog-nodes");

  useEffect(() => {
    if (!batch || batch.sequence === consumed.current) return;
    consumed.current = batch.sequence;
    if (!enabled || !isReady) return;
    for (const observation of batch.observations) {
      const key = `${observation.packetHash.toLowerCase()}:${observation.observation.observerId}`;
      if (visibleReportKeys.has(key)) {
        for (const listener of listeners.current) listener(observation);
      }
    }
  }, [batch, enabled, isReady, visibleReportKeys]);
}
