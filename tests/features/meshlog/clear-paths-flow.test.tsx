import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";
import { MeshlogPage } from "../../../src/features/meshlog/MeshlogPage";
import type { MeshlogData, MeshlogLiveState } from "../../../src/features/meshlog/types";
import { PACKET_FLOW_HOP_MS } from "../../../src/features/map/types";
import { liveNode, liveObservation } from "./live-fixtures";

const boundary = vi.hoisted(() => ({ maps: [] as {
  emit: (event: string) => void;
  sources: Map<string, { data: FeatureCollection; setData: ReturnType<typeof vi.fn> }>;
}[] }));

vi.mock("../../../src/features/meshlog/overview-marker", () => ({
  overviewMarkerId: (type: string) => `meshlog-overview-dot-${type}`,
  rasterizeOverviewMarker: vi.fn(() => ({ data: { width: 1, height: 1, data: new Uint8ClampedArray(4) }, pixelRatio: 1 })),
}));
vi.mock("../../../src/features/map/node-icons", async original => ({
  ...await original<typeof import("../../../src/features/map/node-icons")>(),
  rasterizeNodeIcon: vi.fn(async () => ({ data: { width: 1, height: 1, data: new Uint8ClampedArray(4) }, pixelRatio: 1 })),
}));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(), NavigationControl: class {}, AttributionControl: class {},
  Map: class {
    sources = new globalThis.Map<string, { data: FeatureCollection; setData: ReturnType<typeof vi.fn> }>();
    layers = new globalThis.Map<string, { id: string; paint?: Record<string, unknown> }>();
    listeners = new globalThis.Map<string, Set<() => void>>();
    canvas = document.createElement("div");
    constructor() { boundary.maps.push(this); }
    on(event: string, callback: () => void) { const callbacks = this.listeners.get(event) ?? new Set(); callbacks.add(callback); this.listeners.set(event, callbacks); }
    off(event: string, callback: () => void) { this.listeners.get(event)?.delete(callback); }
    emit(event: string) { this.listeners.get(event)?.forEach(callback => callback()); }
    addControl() {} resize() {} fitBounds() {} remove() { this.emit("remove"); this.listeners.clear(); }
    getCanvas() { return this.canvas; } queryRenderedFeatures() { return []; }
    setMissingStyleImageResolver() {} hasImage() { return false; } addImage() {} updateImage() {}
    addSource(id: string, spec: { data: FeatureCollection }) {
      const source = { data: spec.data, setData: vi.fn((data: FeatureCollection) => { source.data = data; }) };
      this.sources.set(id, source);
    }
    getSource(id: string) { return this.sources.get(id); }
    removeSource(id: string) { this.sources.delete(id); }
    addLayer(layer: { id: string; paint?: Record<string, unknown> }) { this.layers.set(layer.id, layer); }
    getLayer(id: string) { return this.layers.get(id); }
    setFilter(id: string, filter: unknown) { Object.assign(this.layers.get(id)!, { filter }); }
    removeLayer(id: string) { this.layers.delete(id); }
    setPaintProperty(id: string, property: string, value: unknown) { const layer = this.layers.get(id)!; (layer.paint ??= {})[property] = value; }
    setFeatureState() {} removeFeatureState() {}
  },
  Popup: class { setLngLat() { return this; } setDOMContent() { return this; } addTo() { return this; } remove() { return this; } },
}));

const event = liveObservation();
const data: MeshlogData = {
  contacts: [{ id: liveNode.id, name: "Walker", kind: "client", node: liveNode, position: [liveNode.lng!, liveNode.lat!], heard: "now", firstSeen: "—" }],
  reporters: [{ id: "observer-a", name: "Observer", color: "#ff6b35" }], channels: [],
  messages: [{ id: "packet-a", senderName: "Walker", senderId: liveNode.id, time: "10:23:52", kind: "channel", payloadType: 5,
    reports: [{ reporterId: "observer-a", time: "10:23:52", path: ["aa"] }] }],
  paths: [{ key: "packet-a:observer-a", label: "Observer", color: "#ff6b35", points: [
    { id: liveNode.id, lng: liveNode.lng!, lat: liveNode.lat! }, { id: "relay", lng: 24.105, lat: 56.951 },
  ] }],
};
const state: MeshlogLiveState = { status: "connected", loading: false, error: false, gap: false, emptyRegion: false,
  regionLabel: "Test region", onRetry() {}, historyLoading: false, historyError: false, hasOlder: false,
  loadingOlder: false, loadOlder() {}, retryHistory() {}, historyRefreshing: false, refreshHistory() {} };

let now = 0;
let sequence = 0;
let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  boundary.maps.length = 0; now = 0; sequence = 0; frames = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function tick(time: number) {
  now = time;
  act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); });
}

it("clears pinned paths without clearing or restarting the real live animation engine", () => {
  const props = { data, liveState: state, onVisiblePacketsChange() {}, onInspectPacket() {} };
  const view = render(<MeshlogPage {...props} liveBatch={{ sequence: 0, observations: [] }} />);
  const map = boundary.maps[0]!;
  act(() => map.emit("load"));
  fireEvent.click(screen.getByRole("checkbox", { name: "Map path · Walker · 10:23:52" }));
  expect(map.sources.get("pp-lines")!.data.features).toHaveLength(1);
  view.rerender(<MeshlogPage {...props} liveBatch={{ sequence: 1, observations: [event] }} />);
  tick(PACKET_FLOW_HOP_MS / 2);
  const dots = map.sources.get("packet-flow-dot")!;
  const trails = map.sources.get("packet-flow-trail")!;
  expect(dots.data.features).toHaveLength(1);
  expect(trails.data.features).toHaveLength(1);
  const dotBefore = dots.data;
  const trailBefore = trails.data;
  const dotWrites = dots.setData.mock.calls.length;
  const trailWrites = trails.setData.mock.calls.length;

  fireEvent.click(screen.getByRole("button", { name: "Clear paths", exact: true }));
  expect(map.sources.get("pp-lines")!.data.features).toHaveLength(0);
  expect(dots.data).toBe(dotBefore);
  expect(trails.data).toBe(trailBefore);
  expect(dots.setData).toHaveBeenCalledTimes(dotWrites);
  expect(trails.setData).toHaveBeenCalledTimes(trailWrites);
  expect(frames.size).toBeGreaterThan(0);
  tick(PACKET_FLOW_HOP_MS);
  expect(dots.data.features).toHaveLength(1);
  expect(trails.data.features).toHaveLength(1);
  expect(dots.data).not.toEqual(dotBefore);
  expect(boundary.maps).toHaveLength(1);
  view.unmount();
  expect(frames.size).toBe(0);
});
