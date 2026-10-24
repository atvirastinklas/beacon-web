import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FeatureCollection, LineString, Point } from "geojson";
import { PacketPathMap } from "../../../src/features/map/PacketPathMap";
import type { PacketPath } from "../../../src/features/map/packet-path";

const boundary = vi.hoisted(() => ({
  fitBounds: vi.fn(), remove: vi.fn(), popups: [] as HTMLElement[],
  map: null as null | {
    emit: (event: string, layer?: string, data?: unknown) => void;
    data: Record<string, FeatureCollection<LineString | Point>>;
    layers: Record<string, { paint?: Record<string, unknown> }>;
    canvas: { style: { cursor: string } };
  },
}));

vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(),
  Map: class {
    data: Record<string, FeatureCollection<LineString | Point>> = {};
    layers: Record<string, { paint?: Record<string, unknown> }> = {};
    events = new globalThis.Map<string, (event?: unknown) => void>();
    canvas = { style: { cursor: "" } };
    container: HTMLElement;
    constructor(options: { container: HTMLElement }) { this.container = options.container; boundary.map = this; }
    addControl() {}
    getContainer() { return this.container; }
    getCanvas() { return this.canvas; }
    on(event: string, layer: string | ((event?: unknown) => void), callback?: (event?: unknown) => void) {
      this.events.set(`${event}:${typeof layer === "string" ? layer : ""}`, typeof layer === "string" ? callback! : layer);
    }
    emit(event: string, layer = "", data?: unknown) { this.events.get(`${event}:${layer}`)?.(data); }
    addSource(id: string, source: { data: FeatureCollection<LineString | Point> }) { this.data[id] = source.data; }
    getSource(id: string) { return id in this.data ? { setData: (data: FeatureCollection<LineString | Point>) => { this.data[id] = data; } } : undefined; }
    addLayer(layer: { id: string; paint?: Record<string, unknown> }) { this.layers[layer.id] = layer; }
    getLayer(id: string) { return this.layers[id]; }
    setPaintProperty(id: string, property: string, value: unknown) { this.layers[id]!.paint![property] = value; }
    fitBounds = boundary.fitBounds;
    remove = boundary.remove;
  },
  NavigationControl: class {}, AttributionControl: class {},
  LngLatBounds: class {
    extend() { return this; }
  },
  Popup: class {
    setLngLat() { return this; }
    setDOMContent(element: HTMLElement) { boundary.popups.push(element); return this; }
    addTo() { return this; }
  },
}));

let previousText: string;
let previousBackground: string;
beforeEach(() => {
  boundary.fitBounds.mockClear(); boundary.remove.mockClear(); boundary.popups.length = 0;
  previousText = document.documentElement.style.getPropertyValue("--palette-text-bright");
  previousBackground = document.documentElement.style.getPropertyValue("--palette-bg-base");
});
afterEach(() => {
  const root = document.documentElement;
  if (previousText) root.style.setProperty("--palette-text-bright", previousText); else root.style.removeProperty("--palette-text-bright");
  if (previousBackground) root.style.setProperty("--palette-bg-base", previousBackground); else root.style.removeProperty("--palette-bg-base");
});

const paths: PacketPath[] = [
  { key: "alpha", label: "Alpha", color: "#00b4d8", points: [{ id: "a", name: "Start", lng: 24, lat: 56 }, { id: "b", name: "Alpha receiver", lng: 25, lat: 57 }] },
  { key: "bravo", label: "Bravo", color: "#e879f9", points: [{ id: "c", name: "Other start", lng: 26, lat: 58 }, { id: "d", name: "Bravo receiver", lng: 27, lat: 59 }] },
];

it("keeps Beacon path layers, selection framing, node popups and map cleanup intact", () => {
  const root = document.documentElement;
  root.style.setProperty("--palette-text-bright", "#f1f2f3");
  root.style.setProperty("--palette-bg-base", "#101112");
  const view = render(<PacketPathMap paths={paths} selectedKey={null} styleId="dark" />);
  const map = boundary.map!;
  expect(Object.keys(map.data)).toHaveLength(0);
  act(() => map.emit("load"));
  expect(map.data["pp-lines"]!.features).toHaveLength(2);
  expect(map.data["pp-nodes"]!.features).toHaveLength(4);
  expect(map.layers["pp-lines"]!.paint).toMatchObject({ "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": 0.9 });
  expect(map.layers["pp-nodes"]!.paint).toMatchObject({ "circle-stroke-width": 2, "circle-color": ["get", "color"] });
  expect(map.layers["pp-node-labels"]!.paint).toMatchObject({ "text-color": "#f1f2f3", "text-halo-color": "#101112", "text-halo-width": 1.4 });
  expect(boundary.fitBounds).toHaveBeenLastCalledWith(expect.anything(), { padding: 60, maxZoom: 9 });

  root.style.setProperty("--palette-text-bright", "#ebeef1");
  root.style.setProperty("--palette-bg-base", "#08090a");
  view.rerender(<PacketPathMap paths={paths} selectedKey="bravo" styleId="dark" />);
  expect(map.layers["pp-node-labels"]!.paint).toMatchObject({ "text-color": "#ebeef1", "text-halo-color": "#08090a" });
  expect(map.data["pp-lines"]!.features).toHaveLength(1);
  expect(map.data["pp-lines"]!.features[0]!.properties?.key).toBe("bravo");
  expect(boundary.fitBounds).toHaveBeenCalledTimes(2);
  act(() => map.emit("mouseenter", "pp-nodes"));
  expect(map.canvas.style.cursor).toBe("pointer");
  act(() => map.emit("mouseleave", "pp-nodes"));
  expect(map.canvas.style.cursor).toBe("");
  act(() => map.emit("click", "pp-nodes", { features: [map.data["pp-nodes"]!.features[1]] }));
  expect(boundary.popups[0]).toHaveTextContent("Bravo receiver");
  expect(boundary.popups[0]).toHaveTextContent("59.00000, 27.00000");
  view.unmount();
  expect(boundary.remove).toHaveBeenCalledOnce();
});
