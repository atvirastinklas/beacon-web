import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map, NavigationControl, AttributionControl, type GeoJSONSource, type ExpressionSpecification } from "maplibre-gl";
import { useTranslation } from "react-i18next";
import "../map/maplibre-worker";
import "maplibre-gl/dist/maplibre-gl.css";
import { resolveMapStyle, DEFAULT_CENTER, DEFAULT_ZOOM, NODE_TYPE_NAMES, NODE_ICON_UNKNOWN, nodeIconId, PACKET_FLOW_TRAIL_LAYER_ID, PACKET_FLOW_DOT_LAYER_ID, PACKET_FLOW_DOT_HALO_LAYER_ID, PACKET_FLOW_GHOST_LAYER_ID, PACKET_FLOW_ANCHOR_LAYER_ID } from "../map/types";
import type { MeshlogContact, MeshlogLiveBatch } from "./types";
import type { PacketPath } from "../map/packet-path";
import { updatePacketPathLayers } from "../map/packet-path-layers";
import { useTheme } from "../../hooks/useTheme";
import { shortNodeKey } from "./short-node-key";
import { useMeshlogPacketFlow } from "./useMeshlogPacketFlow";
import { contactNodeType } from "./contact-node-type";
import { nodeObserverIconId, nodeTypeColor, rasterizeNodeIcon } from "../map/node-icons";
import { useMeshlogNodeHover } from "./useMeshlogNodeHover";
import { sameMarkers, samePaths, useEqualMapInput, type MeshlogMarkers } from "./stable-map-inputs";
import { overviewMarkerId, rasterizeOverviewMarker } from "./overview-marker";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip";
import { X } from "../../lib/icons";

const EMPTY_PATHS: PacketPath[] = [];
const EMPTY_REPORT_KEYS: ReadonlySet<string> = new Set();
const ROLE_ICON_IDS = [...NODE_TYPE_NAMES.flatMap(type => [nodeIconId(type), nodeObserverIconId(type)]), NODE_ICON_UNKNOWN];
const ICON_IMAGE = ["match", ["get", "nodeTypeName"], ...NODE_TYPE_NAMES.flatMap(type => [type, ["case", ["to-boolean", ["get", "isObserver"]], nodeObserverIconId(type), nodeIconId(type)]]), NODE_ICON_UNKNOWN] as unknown as ExpressionSpecification;
const GLOW: ExpressionSpecification = ["coalesce", ["feature-state", "glow"], 0];
const OVERVIEW_TYPES = [...NODE_TYPE_NAMES, "unknown"];
const OVERVIEW_IMAGE = ["match", ["get", "nodeTypeName"], ...NODE_TYPE_NAMES.flatMap(type => [type, overviewMarkerId(type)]), overviewMarkerId("unknown")] as unknown as ExpressionSpecification;

export function MeshlogMap({ contacts, framingContacts = contacts, paths: pathInput = EMPTY_PATHS, pinnedPaths: pinnedInput = EMPTY_PATHS, onClearPaths, regionLabel, liveBatch, visibleReportKeys = EMPTY_REPORT_KEYS, flowResetKey = "" }: {
  contacts: MeshlogContact[]; framingContacts?: MeshlogContact[]; paths?: PacketPath[]; regionLabel?: string;
  pinnedPaths?: PacketPath[]; onClearPaths?: () => void;
  liveBatch?: MeshlogLiveBatch; visibleReportKeys?: ReadonlySet<string>; flowResetKey?: string;
}) {
  const { t } = useTranslation();
  const { paletteRev } = useTheme();
  const map = useRef<Map | null>(null);
  const mapReady = useRef(false);
  const framed = useRef(false);
  const writtenMarkers = useRef<MeshlogMarkers | null>(null);
  const overviewColors = useRef(new globalThis.Map<string, string>());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const nodePalette = useMemo(() => ({ revision: paletteRev, colors: Object.fromEntries([...NODE_TYPE_NAMES, "unknown"].map(type => [type, nodeTypeColor(type)])) }), [paletteRev]);
  const paths = useEqualMapInput(pathInput, samePaths);
  const pinnedPaths = useEqualMapInput(pinnedInput, samePaths);
  // The page supplies the union of pinned paths and the current hover preview.
  const activeNodeIds = useMemo(() => new Set(paths.flatMap(path => path.points.map(point => point.id))), [paths]);
  const markerInput = useMemo<MeshlogMarkers>(() => ({
    type: "FeatureCollection", features: contacts.filter(contact => contact.position && contact.position.every(Number.isFinite))
      // Source-order symbols must draw inspected nodes after unrelated ones.
      .sort((a, b) => Number(activeNodeIds.has(a.id)) - Number(activeNodeIds.has(b.id)) || a.id.localeCompare(b.id)).map(contact => ({
      type: "Feature", geometry: { type: "Point", coordinates: contact.position! },
      properties: { id: contact.id, name: contact.name, nodeTypeName: contactNodeType(contact), isObserver: !!contact.node?.isObserver,
        title: `${contact.name}${contact.publicKey ? ` · ${shortNodeKey(contact.publicKey, contact.hashSize)}` : ""}`, color: nodePalette.colors[contactNodeType(contact)]! },
    })),
  }), [contacts, nodePalette, activeNodeIds]);
  const visibleNodes = useEqualMapInput(markerInput, sameMarkers);
  useMeshlogPacketFlow({ mapRef: map, isReady: status === "ready", enabled: true, batch: liveBatch, visibleReportKeys, themeKey: String(nodePalette.revision), resetKey: flowResetKey, visibleNodes });
  const interactiveContacts = useMemo(() => activeNodeIds.size ? contacts.filter(contact => activeNodeIds.has(contact.id)) : contacts, [contacts, activeNodeIds]);
  useMeshlogNodeHover(map, status === "ready", interactiveContacts, flowResetKey);
  const installOverviewImage = useCallback((instance: Map, type: string, color: string) => {
    const id = overviewMarkerId(type);
    const exists = instance.hasImage(id);
    if (exists && overviewColors.current.get(id) === color) return;
    const icon = rasterizeOverviewMarker(color);
    if (exists) instance.updateImage(id, icon.data); else instance.addImage(id, icon.data, { pixelRatio: icon.pixelRatio });
    overviewColors.current.set(id, color);
  }, []);
  // Bind MapLibre to the DOM node's lifecycle; React 19 invokes the returned
  // cleanup when the canvas host unmounts, including StrictMode checks.
  const attachMap = useCallback((container: HTMLDivElement | null) => {
    if (!container) return;
    let instance: Map | undefined;
    try {
      instance = new Map({
        container, center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM,
        attributionControl: false,
        style: resolveMapStyle("dark").url,
      });
      map.current = instance;
      const owner = instance;
      const pendingImages = new globalThis.Map<string, Promise<void>>();
      owner.setMissingStyleImageResolver(id => {
        const overviewType = OVERVIEW_TYPES.find(type => overviewMarkerId(type) === id);
        if (overviewType) {
          installOverviewImage(owner, overviewType, nodeTypeColor(overviewType));
          return;
        }
        if (!ROLE_ICON_IDS.includes(id)) {
          if (!owner.hasImage(id)) owner.addImage(id, new ImageData(1, 1));
          return;
        }
        const pending = pendingImages.get(id);
        if (pending) return pending;
        const work = rasterizeNodeIcon(id, true).then(icon => {
          if (map.current === owner && icon && !owner.hasImage(id)) owner.addImage(id, icon.data, { pixelRatio: icon.pixelRatio });
        }).finally(() => pendingImages.delete(id));
        pendingImages.set(id, work);
        return work;
      });
      instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
      instance.addControl(new AttributionControl({ compact: false }), "bottom-right");
      instance.on("load", () => {
        mapReady.current = true;
        setStatus(previous => previous === "error" ? "error" : "ready");
      });
      instance.on("error", () => setStatus("error"));
    } catch {
      instance?.remove();
      map.current = null;
      mapReady.current = false;
      setStatus("error");
      return;
    }
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => instance?.resize()) : null;
    observer?.observe(container);
    return () => { observer?.disconnect(); instance?.remove(); map.current = null; mapReady.current = false; framed.current = false; writtenMarkers.current = null; overviewColors.current.clear(); };
  }, [installOverviewImage]);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const draw = () => {
      if (!mapReady.current) return;
      const source = instance.getSource<GeoJSONSource>("meshlog-nodes");
      if (source) {
        if (writtenMarkers.current !== visibleNodes) source.setData(visibleNodes);
      }
      else {
        instance.addSource("meshlog-nodes", { type: "geojson", data: visibleNodes, promoteId: "id", cluster: false });
        instance.addLayer({ id: "meshlog-node-glow", type: "circle", source: "meshlog-nodes", paint: {
          "circle-radius": ["interpolate", ["linear"], GLOW, 0, 0, 1, 22], "circle-color": ["get", "color"], "circle-opacity": ["*", GLOW, .35], "circle-blur": .5,
        } });
        // Every symbol contains its own fill and both rings. Source-order
        // overdraw preserves the complete foreground outline, without moving,
        // clustering or culling nodes. Zoom >= 9 keeps Beacon's role assets.
        instance.addLayer({ id: "meshlog-nodes", type: "symbol", source: "meshlog-nodes", layout: { "icon-image": ["step", ["zoom"], OVERVIEW_IMAGE, 9, ICON_IMAGE], "icon-size": 1, "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-z-order": "source" }, paint: { "icon-opacity": 1 } });
        instance.addLayer({ id: "meshlog-node-observer-pips", type: "circle", source: "meshlog-nodes", minzoom: 9, filter: ["all", ["==", ["get", "nodeTypeName"], "unknown"], ["==", ["get", "isObserver"], true]], paint: {
          "circle-radius": 3, "circle-color": "#c79bff", "circle-stroke-color": "#111827", "circle-stroke-width": 1, "circle-translate": [7, -7], "circle-translate-anchor": "viewport",
        } });
        instance.addLayer({ id: "meshlog-node-labels", type: "symbol", source: "meshlog-nodes", minzoom: 12, layout: {
          "text-field": ["get", "title"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top",
        }, paint: { "text-color": "#e5e7eb", "text-halo-color": "#111827", "text-halo-width": 1.5 } });
      }
      writtenMarkers.current = visibleNodes;
      // Use the unfiltered directory once, not packet/path or filter changes.
      const positions = framingContacts.flatMap(contact => contact.position && contact.position.every(Number.isFinite) ? [contact.position] : []);
      if (!framed.current && positions.length) {
        let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
        for (const [lng, lat] of positions) { west = Math.min(west, lng); east = Math.max(east, lng); south = Math.min(south, lat); north = Math.max(north, lat); }
        instance.fitBounds([[west, south], [east, north]], { padding: 40, maxZoom: 13, duration: 0 });
        framed.current = true;
      }
    };
    instance.on("load", draw);
    draw();
    return () => { instance.off("load", draw); };
  }, [visibleNodes, framingContacts]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || status !== "ready") return;
    let cancelled = false;
    for (const type of OVERVIEW_TYPES) installOverviewImage(instance, type, nodePalette.colors[type]!);
    for (const id of ROLE_ICON_IDS) void rasterizeNodeIcon(id, true).then(icon => {
      if (cancelled || !icon) return;
      if (instance.hasImage(id)) instance.updateImage(id, icon.data); else instance.addImage(id, icon.data, { pixelRatio: icon.pixelRatio });
    }).catch(() => { /* Labels and hover information remain available if a browser cannot rasterize an asset. */ });
    return () => { cancelled = true; };
  }, [status, paletteRev, nodePalette, installOverviewImage]);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const draw = () => {
      // Install after the ready-state live-flow effect so paths cover its markers.
      // After initial load, pending tiles/GeoJSON must not delay clearing paths.
      if (!mapReady.current || status === "loading") return;
      const css = getComputedStyle(document.documentElement);
      const resolvedPaths = paths.map(path => {
        const token = /^var\((--[\w-]+)\)$/.exec(path.color)?.[1];
        const color = token ? css.getPropertyValue(token).trim() : path.color;
        return { ...path, color: color || css.getPropertyValue("--palette-primary").trim() || "#3b82f6" };
      });
      updatePacketPathLayers(instance, resolvedPaths, null);
    };
    instance.on("load", draw);
    draw();
    return () => { instance.off("load", draw); };
  }, [paths, paletteRev, status]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || status !== "ready") return;
    const ids = [...activeNodeIds];
    const opacity: ExpressionSpecification | number = ids.length ? ["case", ["in", ["get", "id"], ["literal", ids]], 1, 0] : 1;
    instance.setPaintProperty("meshlog-nodes", "icon-opacity", opacity);
    instance.setPaintProperty("meshlog-node-observer-pips", "circle-opacity", opacity);
    instance.setPaintProperty("meshlog-node-observer-pips", "circle-stroke-opacity", opacity);
    instance.setPaintProperty("meshlog-node-labels", "text-opacity", opacity);
    instance.setPaintProperty("meshlog-node-glow", "circle-opacity", ["*", GLOW, .12, opacity]);
    // Keep live activity as background context, preserving each animation's fade.
    // These overrides belong to MeshLog; the main map keeps its existing style.
    const liveOpacity = ids.length ? .15 : .45;
    for (const [id, property, scale] of [
      [PACKET_FLOW_TRAIL_LAYER_ID, "line-opacity", 1],
      [PACKET_FLOW_DOT_LAYER_ID, "circle-opacity", 1],
      [PACKET_FLOW_DOT_LAYER_ID, "circle-stroke-opacity", 1],
      [PACKET_FLOW_DOT_HALO_LAYER_ID, "circle-opacity", .5],
      [PACKET_FLOW_GHOST_LAYER_ID, "circle-stroke-opacity", 1],
      [PACKET_FLOW_ANCHOR_LAYER_ID, "circle-opacity", 1],
      [PACKET_FLOW_ANCHOR_LAYER_ID, "circle-stroke-opacity", 1],
    ] as const) {
      if (instance.getLayer(id)) instance.setPaintProperty(id, property, ["*", ["get", "a"], liveOpacity * scale]);
    }
  }, [activeNodeIds, status]);
  const fitSelectedPaths = () => {
    const positions = pinnedPaths.flatMap(path => path.points.map(point => [point.lng, point.lat] as const)).filter(point => point.every(Number.isFinite));
    if (!positions.length || !mapReady.current) return;
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const [lng, lat] of positions) { west = Math.min(west, lng); east = Math.max(east, lng); south = Math.min(south, lat); north = Math.max(north, lat); }
    map.current?.fitBounds([[west, south], [east, north]], { padding: 48, maxZoom: 13, duration: 0 });
  };
  return <>
    <div className="meshlog-map-canvas" data-dark="true" ref={attachMap} />
    <div className="meshlog-map-caption">{regionLabel || t("tabs.Map")}</div>
    {pinnedPaths.length > 0 && <TooltipProvider delay={200}><div className="meshlog-path-actions" role="group" aria-label={t("meshlog.paths.pinned", { count: pinnedPaths.length })}>
      <span className="meshlog-path-count" aria-hidden="true" title={t("meshlog.paths.pinned", { count: pinnedPaths.length })}>{pinnedPaths.length}</span>
      <Tooltip>
        <TooltipTrigger render={<button type="button" />} onClick={fitSelectedPaths} disabled={status !== "ready"} aria-label={t("meshlog.paths.fit")}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M5.5 2.5h-3v3m8-3h3v3m0 5v3h-3m-5 0h-3v-3" /></svg>
        </TooltipTrigger>
        <TooltipContent role="tooltip">{t("meshlog.paths.fit")}</TooltipContent>
      </Tooltip>
      {onClearPaths && <Tooltip>
        <TooltipTrigger render={<button type="button" />} onClick={onClearPaths} aria-label={t("meshlog.paths.clear")}><X /></TooltipTrigger>
        <TooltipContent role="tooltip">{t("meshlog.paths.clear")}</TooltipContent>
      </Tooltip>}
    </div></TooltipProvider>}
    {status !== "ready" && <div className="meshlog-map-status" role="status">
      {status === "error" ? <>{t("map.loadFailed")} · {t("map.loadFailedHint")}</> : t("common.loading")}
    </div>}
  </>;
}
