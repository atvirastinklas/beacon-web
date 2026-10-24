// src/features/map/PacketPathMap.tsx
import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, AttributionControl, Popup, LngLatBounds } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import type { Point } from "geojson";
import type { PacketPath } from "./packet-path";
import { PACKET_PATH_NODE_LAYER as NODE_LAYER, updatePacketPathLayers } from "./packet-path-layers";
import { resolveMapStyle, DEFAULT_CENTER, DEFAULT_ZOOM, IATA_ZOOM } from "./types";
import { mapLocale } from "./useMapLibre";

// A self-contained MapLibre map that draws a packet's resolved path(s). Owns its own instance so it
// never touches the Map tab's map; the pure builders shape the data, this wires it to GL.
export function PacketPathMap({ paths, selectedKey, styleId }: {
  paths: PacketPath[];
  selectedKey: string | null;
  styleId: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  // build the map once (styleId is read at creation; the popup doesn't hot-swap basemaps)
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: resolveMapStyle(styleId).url,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      locale: mapLocale(),
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new AttributionControl({ compact: true }));
    // start the attribution as a bare (i) instead of the wide expanded bar it pops open on load —
    // on mobile that bar overlaps the observer list beneath the map (same trick as useMapLibre)
    const attrib = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
    attrib?.classList.add("maplibregl-compact");
    attrib?.classList.remove("maplibregl-compact-show");
    // click a path node → popup with its name and raw-decimal coords; pointer cursor on hover
    map.on("mouseenter", NODE_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", NODE_LAYER, () => { map.getCanvas().style.cursor = ""; });
    map.on("click", NODE_LAYER, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const [lng, lat] = (f.geometry as Point).coordinates as [number, number];
      const el = document.createElement("div");
      const name = document.createElement("div");
      name.className = "pp-popup-name";
      name.textContent = (f.properties?.title as string) ?? "";
      const coords = document.createElement("div");
      coords.className = "pp-popup-coords";
      coords.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      el.append(name, coords);
      // a fresh popup per click; closeOnClick removes the previous one on the same click
      new Popup({ closeButton: false, closeOnClick: true, offset: 10 })
        .setLngLat([lng, lat]).setDOMContent(el).addTo(map);
    });
    const onLoad = () => setReady(true);
    map.on("load", onLoad);
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [styleId]);

  // (re)build layers, push data, and frame the shown paths whenever data or selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const bounds = updatePacketPathLayers(map, paths, selectedKey);

    if (bounds.length) {
      const b = bounds.reduce((acc, p) => acc.extend(p), new LngLatBounds(bounds[0], bounds[0]));
      map.fitBounds(b, { padding: 60, maxZoom: IATA_ZOOM });
    }
  }, [ready, paths, selectedKey]);

  return <div ref={containerRef} data-dark={resolveMapStyle(styleId).dark} className="w-full h-full" />;
}
