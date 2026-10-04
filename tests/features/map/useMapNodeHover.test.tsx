import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
const popups = vi.hoisted(() => [] as { content?: HTMLElement; remove: ReturnType<typeof vi.fn>; setLngLat: ReturnType<typeof vi.fn> }[]);
vi.mock("maplibre-gl", () => ({ Popup: class {
  content?: HTMLElement;
  remove = vi.fn();
  constructor() { popups.push(this); }
  setLngLat = vi.fn(() => this);
  setDOMContent(content: HTMLElement) { this.content = content; return this; }
  addTo() { return this; }
} }));
import { useMapNodeHover } from "../../../src/features/map/useMapNodeHover";

function setup(props: Record<string, unknown>) {
  const canvas = document.createElement("canvas");
  const listeners = new Map<string, (...args: never[]) => void>();
  const map = {
    getCanvas: () => canvas,
    getLayersOrder: vi.fn(() => ["nodes-unclustered", "nodes-live-foreground", "nodes-clusters-spiderfy-leaf0", "nodes-selected-leaf"]),
    getLayer: vi.fn(() => ({ id: "packet-flow-ghosts" })),
    queryRenderedFeatures: vi.fn(() => [{ properties: props, layer: { id: "nodes-live-idle" }, geometry: { type: "Point", coordinates: [0, 0] } }] as Array<{ properties: Record<string, unknown>; layer: { id: string }; geometry?: { type: string; coordinates: number[] } }>), unproject: vi.fn(() => ({ lng: 0, lat: 0 })),
    project: vi.fn((coordinate: number[]) => ({ x: 40 + coordinate[0]!, y: 50 })),
    getFeatureState: vi.fn((target: { source: string; id: string }) => ({ glow: target.id === "active" ? 1 : 0 })),
    on: vi.fn((event: string, listener: (...args: never[]) => void) => listeners.set(event, listener)),
    off: vi.fn((event: string) => listeners.delete(event)),
  };
  const ref = { current: map as unknown as MapLibreMap };
  const move = () => (listeners.get("mousemove") as unknown as (e: Partial<MapMouseEvent>) => void)?.({ point: { x: 40, y: 50 } as MapMouseEvent["point"] });
  return { canvas, map, listeners, ref, move };
}
describe("live node hover", () => {
  it("safely identifies resolved context without a role, keeps its marker anchor stable and clears on expiry", () => {
    const s = setup({});
    const context = { properties: { nodeId: "backend-id", name: '<img src=x onerror="alert(1)">', resolvedAnchor: true, a: 1 }, layer: { id: "packet-flow-anchors" }, geometry: { type: "Point", coordinates: [0, 0] } };
    s.map.queryRenderedFeatures.mockReturnValue([context]);
    const { unmount } = renderHook(() => useMapNodeHover(s.ref, true, true, "dark", "scope", false));
    s.move();
    const popup = popups.at(-1)!;
    expect(popup.content!.textContent).toBe('<img src=x onerror="alert(1)">Resolved hopNot shown in the current node view');
    expect(popup.content!.querySelector("img")).toBeNull();
    expect(s.canvas.style.cursor).toBe("pointer");
    s.listeners.get("mousemove")!({ point: { x: 41, y: 51 } } as never);
    expect(popup.setLngLat).toHaveBeenCalledExactlyOnceWith([0, 0]);
    s.map.queryRenderedFeatures.mockReturnValue([{ ...context, properties: { ...context.properties, a: 0 } }]);
    s.listeners.get("idle")!();
    expect(popup.remove).toHaveBeenCalled();
    expect(s.canvas.style.cursor).toBe("");
    unmount();
    expect(s.listeners.size).toBe(0);
  });

  it.each(["replacement", "coordinate-change", "normal-arrival", "empty-name"])("handles resolved context %s without retaining the wrong tooltip", scenario => {
    const s = setup({});
    const context = { properties: { nodeId: "abcdef123456", name: null, resolvedAnchor: true, a: 1 }, layer: { id: "packet-flow-anchors" }, geometry: { type: "Point", coordinates: [0, 0] } };
    s.map.queryRenderedFeatures.mockReturnValue([context]);
    const { unmount } = renderHook(() => useMapNodeHover(s.ref, true, true, "dark", "scope", false));
    s.move();
    expect(popups.at(-1)!.content!.textContent).toContain("ABCDEF12");
    const popup = popups.at(-1)!;
    if (scenario === "replacement") s.map.queryRenderedFeatures.mockReturnValue([{ ...context, properties: { ...context.properties, nodeId: "different" } }]);
    if (scenario === "coordinate-change") s.map.queryRenderedFeatures.mockReturnValue([{ ...context, geometry: { type: "Point", coordinates: [1, 0] } }]);
    if (scenario === "normal-arrival") s.map.queryRenderedFeatures.mockReturnValue([context, { ...context, properties: { id: "normal", name: "Normal", nodeTypeName: "sensor" }, layer: { id: "nodes-live-idle" } }]);
    if (scenario !== "empty-name") {
      s.listeners.get("idle")!();
      expect(popup.remove).toHaveBeenCalled();
      expect(s.canvas.style.cursor).toBe("");
    }
    if (scenario === "normal-arrival") { s.move(); expect(popup.content!.textContent).toBe("NormalSensor"); }
    unmount();
  });
  it("anchors to the marker instead of the entry cursor and remains stable within it, then clears immediately on exit", () => {
    const s = setup({ id: "stable", name: "Stable node", nodeTypeName: "sensor" });
    const { unmount } = renderHook(() => useMapNodeHover(s.ref, true, true, "dark", "scope", false));
    s.move();
    const popup = popups.at(-1)!;
    expect(popup.setLngLat).toHaveBeenCalledExactlyOnceWith([0, 0]);
    s.listeners.get("mousemove")!({ point: { x: 41, y: 51 } } as never);
    expect(popup.setLngLat).toHaveBeenCalledTimes(1);
    expect(s.canvas.style.cursor).toBe("pointer");
    s.map.queryRenderedFeatures.mockReturnValue([]);
    s.listeners.get("mousemove")!({ point: { x: 45, y: 50 } } as never);
    expect(popup.remove).toHaveBeenCalled();
    expect(s.canvas.style.cursor).toBe("");
    unmount();
  });
  it("labels inferred stops honestly without a node identity and clears expired ghost tooltips", () => {
    const s = setup({});
    s.map.getLayersOrder.mockReturnValue(["nodes-unclustered", "nodes-live-foreground", "packet-flow-ghosts"]);
    s.map.queryRenderedFeatures.mockReturnValue([{ properties: { inferred: true, a: 1 }, layer: { id: "packet-flow-ghosts" }, geometry: { type: "Point", coordinates: [1, 51] } }]);
    const { unmount } = renderHook(() => useMapNodeHover(s.ref, true, true, "dark", "scope", false));
    s.move();
    expect(popups.at(-1)!.content!.textContent).toBe("Approximate hopPosition inferred between known nodes");
    expect(s.canvas.style.cursor).toBe("help");
    expect(s.map.getFeatureState).not.toHaveBeenCalled();
    s.map.queryRenderedFeatures.mockReturnValue([]);
    s.listeners.get("idle")!();
    expect(popups.at(-1)!.remove).toHaveBeenCalled();
    expect(s.canvas.style.cursor).toBe("");
    unmount();
    expect(s.listeners.size).toBe(0);
  });

  it("prioritizes real nodes over nearby inferred stops and ignores fully faded ghosts", () => {
    const s = setup({});
    s.map.getLayersOrder.mockReturnValue(["nodes-live-foreground", "packet-flow-ghosts"]);
    const ghost = { properties: { inferred: true, a: 1 }, layer: { id: "packet-flow-ghosts" }, geometry: { type: "Point", coordinates: [1, 51] } };
    s.map.queryRenderedFeatures.mockReturnValue([ghost, { properties: { id: "active", name: "Real repeater", nodeTypeName: "repeater" }, layer: { id: "nodes-live-foreground" }, geometry: { type: "Point", coordinates: [0, 0] } }]);
    const { unmount } = renderHook(() => useMapNodeHover(s.ref, true, true, "dark", "scope", false));
    s.move();
    expect(popups.at(-1)!.content!.textContent).toBe("Real repeaterRepeater");
    s.map.queryRenderedFeatures.mockReturnValue([{ ...ghost, properties: { inferred: true, a: 0 } }]);
    s.move();
    expect(s.canvas.style.cursor).toBe("");
    unmount();
  });
  it("shows safe names and type plus observer role for dots and leaves", () => {
    const s = setup({ id: "abcdef1234567890", name: '<img src=x onerror="alert(1)">', nodeTypeName: "repeater", isObserver: true });
    const { unmount } = renderHook(() => useMapNodeHover(s.ref, true, true, "dark", "scope", true));
    s.move();
    const content = popups.at(-1)!.content!;
    expect(content.getAttribute("role")).toBe("tooltip");
    expect(content.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(content.querySelector("img")).toBeNull();
    expect(content.textContent).toContain("Repeater · Observer");
    expect(s.map.queryRenderedFeatures).toHaveBeenCalledWith({ x: 40, y: 50 }, { layers: ["nodes-live-foreground", "nodes-live-idle", "packet-flow-anchors", "packet-flow-ghosts"] });
    s.canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(popups.at(-1)!.remove).toHaveBeenCalled();
    unmount();
  });

  it("prioritizes active foreground metadata but ignores transparent inactive cores", () => {
    const s = setup({ id: "idle", name: "Idle", nodeTypeName: "sensor" });
    s.map.queryRenderedFeatures.mockReturnValue([
      { properties: { id: "idle", name: "Idle", nodeTypeName: "sensor" }, layer: { id: "nodes-live-foreground" }, geometry: { type: "Point", coordinates: [0, 0] } },
      { properties: { id: "active", name: "Active", nodeTypeName: "repeater" }, layer: { id: "nodes-live-foreground" }, geometry: { type: "Point", coordinates: [0, 0] } },
      { properties: { id: "idle", name: "Idle", nodeTypeName: "sensor" }, layer: { id: "nodes-live-idle" }, geometry: { type: "Point", coordinates: [0, 0] } },
    ]);
    const { unmount } = renderHook(() => useMapNodeHover(s.ref, true, true, "dark", "a", false));
    s.move();
    expect(popups.at(-1)!.content!.textContent).toBe("ActiveRepeater");
    s.canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    s.map.getFeatureState.mockReturnValue({ glow: 0 });
    s.move();
    expect(popups.at(-1)!.content!.textContent).toBe("IdleSensor");
    unmount();
  });

  it("falls back for unnamed/unknown nodes and clears on exit, reset, toggle and unmount", () => {
    const s = setup({ id: "abcdef1234567890", name: " ", nodeTypeName: "unexpected" });
    const { rerender, unmount } = renderHook(({ live, resetKey, themeKey, ready }) => useMapNodeHover(s.ref, ready, live, themeKey, resetKey, false), { initialProps: { live: true, resetKey: "a", themeKey: "dark", ready: true } });
    s.move();
    expect(popups.at(-1)!.content!.textContent).toContain("ABCDEF12");
    expect(popups.at(-1)!.content!.textContent).toContain("Unknown");
    s.canvas.dispatchEvent(new Event("mouseleave"));
    expect(s.canvas.style.cursor).toBe("");
    const popup = popups.at(-1)!;
    rerender({ live: true, resetKey: "b", themeKey: "dark", ready: true });
    expect(popup.remove).toHaveBeenCalled();
    s.move();
    const next = popups.at(-1)!;
    rerender({ live: true, resetKey: "b", themeKey: "light", ready: true });
    expect(next.remove).toHaveBeenCalled();
    s.move();
    const themed = popups.at(-1)!;
    rerender({ live: true, resetKey: "b", themeKey: "light", ready: false });
    expect(themed.remove).toHaveBeenCalled();
    expect(s.listeners.size).toBe(0);
    rerender({ live: true, resetKey: "b", themeKey: "light", ready: true });
    s.move();
    const reloaded = popups.at(-1)!;
    rerender({ live: false, resetKey: "b", themeKey: "light", ready: true });
    expect(reloaded.remove).toHaveBeenCalled();
    expect(s.listeners.size).toBe(0);
    unmount();
  });
});
