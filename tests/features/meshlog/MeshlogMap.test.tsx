import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";
import { MeshlogMap } from "../../../src/features/meshlog/MeshlogMap";
import type { MeshlogContact } from "../../../src/features/meshlog/types";
import type { PacketPath } from "../../../src/features/map/packet-path";
import { liveNode } from "./live-fixtures";
import { overviewMarkerId, rasterizeOverviewMarker } from "../../../src/features/meshlog/overview-marker";
import { nodeTypeColor } from "../../../src/features/map/node-icons";
import i18n from "../../../src/i18n";

const flow = vi.hoisted(() => vi.fn());
const theme = vi.hoisted(() => ({ paletteRev: 0 }));
const boundary = vi.hoisted(() => ({ maps: [] as { emit: (event: string, payload?: unknown) => void; data: Record<string, FeatureCollection>; sources: Record<string, { promoteId?: string }>; layers: Record<string, { type: string; layout?: Record<string, unknown>; paint?: Record<string, unknown> }>; hit: unknown[]; canvas: HTMLElement; addImage: ReturnType<typeof vi.fn>; writes: Record<string, number>; fitBounds: ReturnType<typeof vi.fn>; resolveImage: (id: string) => unknown }[] }));
vi.mock("../../../src/features/meshlog/useMeshlogPacketFlow", () => ({ useMeshlogPacketFlow: flow }));
vi.mock("../../../src/hooks/useTheme", () => ({ useTheme: () => theme }));
vi.mock("../../../src/features/meshlog/overview-marker", async original => ({ ...await original<typeof import("../../../src/features/meshlog/overview-marker")>(), rasterizeOverviewMarker: vi.fn(() => ({ data: { width: 48, height: 48, data: new Uint8ClampedArray(48 * 48 * 4) }, pixelRatio: 2 })) }));
vi.mock("../../../src/features/map/node-icons", async original => ({ ...await original<typeof import("../../../src/features/map/node-icons")>(), rasterizeNodeIcon: vi.fn(async () => ({ data: { width: 1, height: 1, data: new Uint8ClampedArray(4) }, pixelRatio: 1 })) }));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(), NavigationControl: class {}, AttributionControl: class {},
  Map: class {
    data: Record<string, FeatureCollection> = {}; sources: Record<string, { promoteId?: string }> = {}; layers: Record<string, { type: string }> = {}; hit: unknown[] = [];
    writes: Record<string, number> = {}; fitBounds = vi.fn();
    resolveImage: (id: string) => unknown = () => {};
    canvas = document.createElement("div"); listeners = new globalThis.Map<string, Set<(event?: unknown) => void>>();
    images = new Set<string>(); addImage = vi.fn((id: string) => this.images.add(id));
    constructor() { boundary.maps.push(this); }
    on(event: string, fn: (event?: unknown) => void) { const set = this.listeners.get(event) ?? new Set(); set.add(fn); this.listeners.set(event, set); }
    off(event: string, fn: (event?: unknown) => void) { this.listeners.get(event)?.delete(fn); }
    emit(event: string, payload?: unknown) { this.listeners.get(event)?.forEach(fn => fn(payload)); }
    addControl() {} resize() {} remove() { this.emit("remove"); } setMissingStyleImageResolver(resolve: (id: string) => unknown) { this.resolveImage = resolve; }
    getCanvas() { return this.canvas; } queryRenderedFeatures() { return this.hit; }
    addSource(id: string, source: { data: FeatureCollection; promoteId?: string }) { this.data[id] = source.data; this.sources[id] = source; }
    getSource(id: string) { return this.sources[id] ? { setData: (data: FeatureCollection) => { this.data[id] = data; this.writes[id] = (this.writes[id] ?? 0) + 1; } } : undefined; }
    addLayer(layer: { id: string; type: string }) { this.layers[layer.id] = layer; } getLayer(id: string) { return this.layers[id]; }
    setPaintProperty(id: string, property: string, value: unknown) { const layer = this.layers[id] as { paint?: Record<string, unknown> }; (layer.paint ??= {})[property] = value; } hasImage(id: string) { return this.images.has(id); } updateImage() {}
  },
  Popup: class {
    element = document.createElement("div");
    setLngLat() { return this; } setDOMContent(content: HTMLElement) { this.element.replaceChildren(content); return this; }
    addTo() { document.body.append(this.element); return this; } remove() { this.element.remove(); return this; }
  },
}));
const contact: MeshlogContact = { id: liveNode.id, name: "<img src=x> Relay", publicKey: liveNode.publicKey, kind: "client", node: { ...liveNode, nodeTypeName: "Room_Server", isObserver: true }, position: [24, 56], heard: "now", firstSeen: "—" };
beforeEach(() => { boundary.maps.length = 0; flow.mockClear(); theme.paletteRev = 0; vi.mocked(rasterizeOverviewMarker).mockClear(); });
afterEach(() => { document.documentElement.style.removeProperty("--palette-green"); });

describe("Meshlog map controls and role assets", () => {
  const path: PacketPath = { key: "packet:rx", label: "Observer", color: "#22c55e", points: [
    { id: contact.id, name: contact.name, lng: 24, lat: 56 }, { id: "relay", name: "Relay", lng: 25, lat: 57 }, { id: "rx", lng: 26, lat: 58, breakBefore: true },
  ] };
  it("uses one non-SDF multicolor image per type, without a separate all-rings layer", () => {
    render(<MeshlogMap contacts={[contact]} />);
    const map = boundary.maps[0]!;
    const id = overviewMarkerId("room_server");
    map.resolveImage(id);
    expect(rasterizeOverviewMarker).toHaveBeenCalledExactlyOnceWith(nodeTypeColor("room_server"));
    expect(map.addImage).toHaveBeenLastCalledWith(id, expect.objectContaining({ width: 48, height: 48 }), { pixelRatio: 2 });
    map.resolveImage(id);
    expect(rasterizeOverviewMarker).toHaveBeenCalledTimes(1);
    act(() => map.emit("load"));
    expect(map.layers["meshlog-overview-rings"]).toBeUndefined();
    expect(map.layers["meshlog-nodes"]!.layout).toMatchObject({ "symbol-z-order": "source", "icon-allow-overlap": true, "icon-ignore-placement": true });
    expect(JSON.stringify(map.layers["meshlog-nodes"]!.layout!["icon-image"])).toContain(id);
    expect(map.layers["meshlog-nodes"]!.paint).not.toHaveProperty("icon-color");
    expect(map.addImage.mock.calls.filter(([imageId]) => imageId.startsWith("meshlog-overview-dot-"))).toHaveLength(5);
  });

  it("refreshes atomic overview palettes on theme changes without moving nodes or repeating unchanged image work", () => {
    const view = render(<MeshlogMap contacts={[contact]} />);
    const map = boundary.maps[0]!; act(() => map.emit("load"));
    const count = vi.mocked(rasterizeOverviewMarker).mock.calls.length;
    view.rerender(<MeshlogMap contacts={[{ ...contact, detailLoading: true }]} />);
    expect(rasterizeOverviewMarker).toHaveBeenCalledTimes(count);
    document.documentElement.style.setProperty("--palette-green", "#123456");
    theme.paletteRev++;
    view.rerender(<MeshlogMap contacts={[contact]} />);
    expect(rasterizeOverviewMarker).toHaveBeenLastCalledWith("#123456");
    expect(rasterizeOverviewMarker).toHaveBeenCalledTimes(count + 1);
    expect(map.data["meshlog-nodes"]!.features[0]!.geometry).toEqual({ type: "Point", coordinates: contact.position });
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
  });
  it("skips semantically unchanged marker/static-path writes despite new runtime objects, but publishes meaningful changes", () => {
    const view = render(<MeshlogMap contacts={[contact]} paths={[path]} pinnedPaths={[path]} />);
    const map = boundary.maps[0]!;
    act(() => map.emit("load"));
    const baseline = { ...map.writes };
    const nodes = flow.mock.lastCall![0].visibleNodes;
    for (let index = 0; index < 6; index++) view.rerender(<MeshlogMap contacts={[{ ...contact, heard: String(index), detailLoading: index % 2 === 0, node: { ...contact.node! } }]} paths={[{ ...path, points: path.points.map(point => ({ ...point })) }]} pinnedPaths={[path]} />);
    expect(map.writes).toEqual(baseline);
    expect(flow.mock.lastCall![0].visibleNodes).toBe(nodes);
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    view.rerender(<MeshlogMap contacts={[{ ...contact, name: "Renamed", position: [25, 56], node: { ...contact.node!, isObserver: false } }]} paths={[path]} />);
    expect(map.writes["meshlog-nodes"]).toBe((baseline["meshlog-nodes"] ?? 0) + 1);
    expect(map.data["meshlog-nodes"]!.features[0]!.properties).toMatchObject({ name: "Renamed", isObserver: false });
    const lineCount = map.data["pp-lines"]!.features.length;
    expect(lineCount).toBe(1); // The unknown gap never gains an invented link.
    view.rerender(<MeshlogMap contacts={[contact]} paths={[{ ...path, points: path.points.map(point => ({ ...point, breakBefore: false })) }]} />);
    expect(map.data["pp-lines"]!.features).toHaveLength(1);
    expect(map.data["pp-lines"]!.features[0]!.geometry).toMatchObject({ coordinates: [[24, 56], [25, 57], [26, 58]] });
    expect(map.writes["pp-lines"]).toBe((baseline["pp-lines"] ?? 0) + 1);
  });

  it("simplifies overview symbols, dims unrelated nodes for pins, and fits only on explicit request", () => {
    const clear = vi.fn();
    const view = render(<MeshlogMap contacts={[contact]} onClearPaths={clear} />);
    const map = boundary.maps[0]!;
    act(() => map.emit("load"));
    expect(map.sources["meshlog-nodes"]).toMatchObject({ cluster: false });
    expect(map.layers["meshlog-nodes"]!.layout).toMatchObject({ "icon-allow-overlap": true, "icon-ignore-placement": true });
    expect(JSON.stringify(map.layers["meshlog-nodes"]!.layout)).toContain("meshlog-overview-dot");
    expect(map.layers["meshlog-overview-rings"]).toBeUndefined();
    view.rerender(<MeshlogMap contacts={[contact]} paths={[path]} pinnedPaths={[path]} onClearPaths={clear} />);
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    expect(map.layers["meshlog-nodes"]!.paint!["icon-opacity"]).toEqual(["case", ["in", ["get", "id"], ["literal", [contact.id, "relay", "rx"]]], 1, .18]);
    expect(screen.getByRole("group", { name: "Pinned paths: 1" })).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Fit selected paths" }));
    expect(map.fitBounds).toHaveBeenLastCalledWith([[24, 56], [26, 58]], expect.objectContaining({ duration: 0 }));
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Clear paths" }));
    expect(clear).toHaveBeenCalledOnce();
    view.rerender(<MeshlogMap contacts={[]} paths={[]} pinnedPaths={[]} />);
    expect(map.layers["meshlog-nodes"]!.paint!["icon-opacity"]).toBe(1);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
  });
  it("keeps compact icon-only path actions fully labelled with keyboard tooltips in English and Lithuanian", async () => {
    const clear = vi.fn();
    render(<MeshlogMap contacts={[contact]} paths={[path]} pinnedPaths={[path]} onClearPaths={clear} />);
    const map = boundary.maps[0]!; act(() => map.emit("load"));
    const group = screen.getByRole("group", { name: "Pinned paths: 1" });
    expect(group.textContent).toBe("1");
    const fit = within(group).getByRole("button", { name: "Fit selected paths" });
    expect(fit.textContent).toBe("");
    expect(within(group).getByRole("button", { name: "Clear paths" }).textContent).toBe("");
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => fit.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Fit selected paths");
    fireEvent.keyDown(fit, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(fit).toHaveFocus();
    await act(async () => { await i18n.changeLanguage("lt"); });
    expect(screen.getByRole("group", { name: i18n.t("meshlog.paths.pinned", { count: 1 }) }).textContent).toBe("1");
    const translatedClear = screen.getByRole("button", { name: i18n.t("meshlog.paths.clear") });
    act(() => translatedClear.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(i18n.t("meshlog.paths.clear"));
    fireEvent.click(translatedClear);
    expect(clear).toHaveBeenCalledOnce();
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    expect(flow.mock.lastCall![0]).toMatchObject({ enabled: true, resetKey: "" });
  });
  it("keeps live flow enabled across filter changes without rendering an animation toggle", async () => {
    const keys = new Set(["packet:rx"]);
    const view = render(<MeshlogMap contacts={[contact]} visibleReportKeys={keys} flowResetKey="filters" />);
    const map = boundary.maps[0]!;
    expect(screen.queryByRole("button", { name: /live map packet flow/ })).not.toBeInTheDocument();
    act(() => map.emit("load"));
    expect(flow).toHaveBeenLastCalledWith(expect.objectContaining({ isReady: true, enabled: true, visibleReportKeys: keys, resetKey: "filters" }));
    expect(map.sources["meshlog-nodes"]).toHaveProperty("promoteId", "id");
    expect(map.layers["meshlog-nodes"]?.type).toBe("symbol");
    expect(JSON.stringify(map.layers["meshlog-nodes"])).toContain("node-room_server-observer");
    expect(map.data["meshlog-nodes"]!.features[0]!.properties).toMatchObject({ nodeTypeName: "room_server", isObserver: true });
    await waitFor(() => expect(map.addImage).toHaveBeenCalled());
    view.rerender(<MeshlogMap contacts={[contact]} visibleReportKeys={keys} flowResetKey="changed" />);
    expect(flow).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, resetKey: "changed" }));
    expect(screen.queryByRole("button", { name: /live map packet flow/ })).not.toBeInTheDocument();
    expect(boundary.maps).toHaveLength(1);
  });

  it("uses safe hover/tap tooltips with short public-key IDs and clears them on Escape and filter removal", () => {
    const view = render(<MeshlogMap contacts={[contact]} />);
    const map = boundary.maps[0]!; act(() => map.emit("load")); map.hit = [{ properties: { id: contact.id } }];
    act(() => map.emit("mousemove", { point: { x: 1, y: 1 }, originalEvent: { buttons: 0 } }));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(contact.name); expect(tooltip.querySelector(".meshlog-node-tooltip-key")).toHaveTextContent(contact.publicKey!.slice(0, 8)); expect(tooltip).toHaveTextContent("Observer");
    expect(tooltip).not.toHaveTextContent(contact.publicKey!);
    expect(tooltip.querySelector("img")).toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" }); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => map.emit("mousemove", { point: { x: 1, y: 1 }, originalEvent: { buttons: 0 } }));
    fireEvent.mouseLeave(map.canvas); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => map.emit("click", { point: { x: 1, y: 1 } })); fireEvent.mouseLeave(map.canvas); expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" }); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => map.emit("click", { point: { x: 1, y: 1 } }));
    view.rerender(<MeshlogMap contacts={[]} />); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
  it.each([[undefined, "aabbccdd"], [1, "aa"], [2, "aabb"], [3, "aabbcc"]] as const)("uses canonical %s-byte tooltip IDs without exposing full keys or UUIDs", (hashSize, expected) => {
    const publicKey = "aabbccdd".repeat(8);
    const node = { ...contact, id: "internal-tooltip-uuid", publicKey, hashSize };
    const view = render(<MeshlogMap contacts={[node]} />);
    const map = boundary.maps[0]!; act(() => map.emit("load")); map.hit = [{ properties: { id: node.id } }];
    act(() => map.emit("click", { point: { x: 1, y: 1 } }));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.querySelector(".meshlog-node-tooltip-key")!.textContent).toBe(expected);
    expect(tooltip).not.toHaveTextContent(publicKey);
    expect(tooltip).not.toHaveTextContent(node.id);
    view.rerender(<MeshlogMap contacts={[{ ...node, hashSize: 2 }]} />);
    expect(screen.getByRole("tooltip").querySelector(".meshlog-node-tooltip-key")!.textContent).toBe("aabb");
  });

  it("never substitutes an internal UUID when a node has no public key", () => {
    const node = { ...contact, id: "internal-without-key", name: "", publicKey: undefined, node: undefined };
    render(<MeshlogMap contacts={[node]} />);
    const map = boundary.maps[0]!; act(() => map.emit("load")); map.hit = [{ properties: { id: node.id } }];
    act(() => map.emit("click", { point: { x: 1, y: 1 } }));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.querySelector(".meshlog-node-tooltip-key")).toBeNull();
    expect(tooltip).toHaveTextContent("Unknown");
    expect(tooltip).not.toHaveTextContent(node.id);
  });
});
