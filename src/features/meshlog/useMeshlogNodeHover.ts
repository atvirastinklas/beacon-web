import { useEffect, useRef, type RefObject } from "react";
import { Popup, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useTranslation } from "react-i18next";
import type { MeshlogContact } from "./types";
import { contactNodeType } from "./contact-node-type";
import { shortNodeKey } from "./short-node-key";
import "../map/node-hover.css";

export function useMeshlogNodeHover(mapRef: RefObject<MapLibreMap | null>, ready: boolean, contacts: MeshlogContact[], resetKey: string) {
  const { t } = useTranslation();
  const visible = useRef(new Map<string, MeshlogContact>());
  const shown = useRef<string | null>(null);
  const clearRef = useRef<() => void>(() => {});
  const refreshRef = useRef<(contact: MeshlogContact) => void>(() => {});
  useEffect(() => {
    visible.current = new Map(contacts.map(contact => [contact.id, contact]));
    if (shown.current) {
      const contact = visible.current.get(shown.current);
      if (contact) refreshRef.current(contact); else clearRef.current();
    }
  }, [contacts]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const canvas = map.getCanvas();
    const popup = new Popup({ closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: 12, maxWidth: "280px", className: "node-hover-popup meshlog-node-tooltip" });
    let pinned = false;
    const clear = () => { shown.current = null; pinned = false; popup.remove(); canvas.style.cursor = ""; };
    const show = (contact: MeshlogContact) => {
      if (!contact.position) return clear();
      const content = document.createElement("div"); content.setAttribute("role", "tooltip");
      const publicKey = contact.publicKey ?? contact.node?.publicKey ?? contact.detail?.publicKey;
      const shortId = shortNodeKey(publicKey, contact.hashSize);
      const name = document.createElement("div"); name.className = "node-hover-name";
      name.textContent = contact.name.trim() || shortId || t("traces.unknown");
      const role = document.createElement("div"); role.className = "node-hover-role";
      const type = contactNodeType(contact);
      role.textContent = (type === "unknown" ? t("traces.unknown") : t(`nodeTypes.${type}`)) + (contact.node?.isObserver ? ` · ${t("nodes.observer")}` : "");
      content.append(name, role);
      if (shortId) { const key = document.createElement("div"); key.className = "node-hover-role meshlog-node-tooltip-key"; key.textContent = shortId; content.append(key); }
      popup.setLngLat(contact.position).setDOMContent(content).addTo(map);
      shown.current = contact.id; canvas.style.cursor = "pointer";
    };
    const hit = (event: MapMouseEvent) => {
      if (!map.getLayer("meshlog-nodes")) return undefined;
      const feature = map.queryRenderedFeatures(event.point, { layers: ["meshlog-nodes"] })[0];
      return feature ? visible.current.get(String(feature.properties.id)) : undefined;
    };
    const move = (event: MapMouseEvent) => {
      if (event.originalEvent?.buttons) return clear();
      if (pinned) return;
      const contact = hit(event); if (contact) show(contact); else clear();
    };
    const click = (event: MapMouseEvent) => {
      const contact = hit(event);
      if (!contact || (pinned && shown.current === contact.id)) return clear();
      pinned = true; show(contact);
    };
    const leave = () => { if (!pinned) clear(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") clear(); };
    clearRef.current = clear; refreshRef.current = show;
    map.on("mousemove", move); map.on("click", click); map.on("movestart", clear); map.on("remove", clear);
    canvas.addEventListener("mouseleave", leave); canvas.addEventListener("keydown", key);
    canvas.ownerDocument.addEventListener("keydown", key);
    return () => {
      map.off("mousemove", move); map.off("click", click); map.off("movestart", clear); map.off("remove", clear);
      canvas.removeEventListener("mouseleave", leave); canvas.removeEventListener("keydown", key); clear();
      canvas.ownerDocument.removeEventListener("keydown", key);
      clearRef.current = () => {}; refreshRef.current = () => {};
    };
  }, [mapRef, ready, resetKey, t]);
}
