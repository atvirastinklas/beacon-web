import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Popup, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { NODE_TYPE_NAMES } from "./types";
import { liveMarkerAnchor, queryLiveMarkerHits } from "./live-marker-hit";
import { formatHex } from "../../lib/formatters";
import "./node-hover.css";

// Live dots intentionally omit labels; hover reveals the same metadata for base markers and fan leaves.
export function useMapNodeHover(
  mapRef: React.RefObject<MapLibreMap | null>,
  isReady: boolean,
  live: boolean,
  themeKey: string,
  resetKey: string,
  clustered: boolean,
) {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady || !live) return;
    const canvas = map.getCanvas();
    const popup = new Popup({ closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: 12, maxWidth: "260px", className: "node-hover-popup" });
    let hoveredId: unknown = null;
    let transientHit: { point: MapMouseEvent["point"]; kind: "ghost" | "anchor"; key: string } | null = null;
    const clear = () => {
      hoveredId = null;
      transientHit = null;
      popup.remove();
      canvas.style.cursor = "";
    };
    const onMove = (e: MapMouseEvent) => {
      if (e.originalEvent?.buttons) return clear();
      const { node: feature, anchor: candidateAnchor, ghost: candidateGhost } = queryLiveMarkerHits(map, e.point);
      const context = !feature && candidateAnchor;
      const ghost = !feature && !context && candidateGhost;
      if (!feature && !context && !ghost) return clear();
      if (context) {
        const anchor = liveMarkerAnchor(map, context, e.point);
        if (!anchor) return clear();
        const props = context.properties;
        const key = `anchor:${props.nodeId}:${anchor.join(",")}`;
        canvas.style.cursor = "pointer";
        transientHit = { point: e.point, kind: "anchor", key };
        if (hoveredId === key) return;
        hoveredId = key;
        const content = document.createElement("div");
        content.setAttribute("role", "tooltip");
        const name = document.createElement("div");
        name.className = "node-hover-name";
        name.textContent = typeof props.name === "string" && props.name.trim() ? props.name : formatHex(props.nodeId);
        const label = document.createElement("div");
        label.className = "node-hover-role";
        label.textContent = t("map.resolvedHop", { defaultValue: "Resolved hop" });
        const hint = document.createElement("div");
        hint.className = "node-hover-role";
        hint.textContent = t("map.resolvedHopHint", { defaultValue: "Not shown in the current node view" });
        content.append(name, label, hint);
        popup.setLngLat(anchor).setDOMContent(content).addTo(map);
        return;
      }
      if (ghost) {
        const anchor = liveMarkerAnchor(map, ghost, e.point);
        if (!anchor) return clear();
        canvas.style.cursor = "help";
        const key = `ghost:${anchor.join(",")}`;
        transientHit = { point: e.point, kind: "ghost", key };
        if (hoveredId === key) return;
        hoveredId = key;
        const content = document.createElement("div");
        content.setAttribute("role", "tooltip");
        const label = document.createElement("div");
        label.className = "node-hover-name";
        label.textContent = t("map.approximateHop", { defaultValue: "Approximate hop" });
        const hint = document.createElement("div");
        hint.className = "node-hover-role";
        hint.textContent = t("map.approximateHopHint", { defaultValue: "Position inferred between known nodes" });
        content.append(label, hint);
        popup.setLngLat(anchor).setDOMContent(content).addTo(map);
        return;
      }
      if (!feature) return clear();
      const anchor = liveMarkerAnchor(map, feature, e.point);
      if (!anchor) return clear();
      transientHit = null;
      canvas.style.cursor = "pointer";
      const props = feature.properties;
      const key = `node:${props.id}:${anchor.join(",")}`;
      if (hoveredId === key) return;
      hoveredId = key;
      const content = document.createElement("div");
      content.setAttribute("role", "tooltip");
      const name = document.createElement("div");
      name.className = "node-hover-name";
      name.textContent = typeof props.name === "string" && props.name.trim() ? props.name : formatHex(props.id);
      const role = document.createElement("div");
      role.className = "node-hover-role";
      const type = NODE_TYPE_NAMES.find(type => type === props.nodeTypeName);
      role.textContent = type ? t(`nodeTypes.${type}`) : t("packetRow.unknown");
      if (props.isObserver === true || props.isObserver === "true") role.textContent += ` · ${t("nodes.observer")}`;
      content.append(name, role);
      // Stay anchored to the marker, not whichever edge the pointer first entered.
      popup.setLngLat(anchor).setDOMContent(content).addTo(map);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") clear(); };
    // Once the animation settles, only keep a transient tooltip for the same current hit/copy.
    // This also clears context when an ordinary node replaces it at that position.
    const onIdle = () => {
      if (!transientHit) return;
      const { node, anchor, ghost } = queryLiveMarkerHits(map, transientHit.point);
      const current = transientHit.kind === "anchor" ? !node && anchor : !node && !anchor && ghost;
      const coordinate = current && liveMarkerAnchor(map, current, transientHit.point);
      const key = current && coordinate ? transientHit.kind === "anchor"
        ? `anchor:${current.properties.nodeId}:${coordinate.join(",")}` : `ghost:${coordinate.join(",")}` : null;
      if (key !== transientHit.key) clear();
    };
    map.on("mousemove", onMove);
    map.on("movestart", clear);
    map.on("remove", clear);
    map.on("idle", onIdle);
    canvas.addEventListener("mouseleave", clear);
    canvas.addEventListener("keydown", onKey);
    return () => {
      map.off("mousemove", onMove);
      map.off("movestart", clear);
      map.off("remove", clear);
      map.off("idle", onIdle);
      canvas.removeEventListener("mouseleave", clear);
      canvas.removeEventListener("keydown", onKey);
      clear();
    };
  }, [mapRef, isReady, live, themeKey, resetKey, clustered, t, i18n.resolvedLanguage]);
}
