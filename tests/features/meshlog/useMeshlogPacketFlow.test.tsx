import { useEffect } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { FeatureCollection, Point } from "geojson";
import type { PacketFlowSource } from "../../../src/features/map/useMapPacketFlow";
import type { NodeFeatureProps } from "../../../src/features/map/node-geojson";
import type { MeshlogLiveBatch } from "../../../src/features/meshlog/types";
import { useMeshlogPacketFlow } from "../../../src/features/meshlog/useMeshlogPacketFlow";
import { liveObservation } from "./live-fixtures";

const engine = vi.hoisted(() => ({ events: vi.fn(), calls: vi.fn() }));
vi.mock("../../../src/features/map/useMapPacketFlow", () => ({
  useMapPacketFlow: function useMapPacketFlow(_map: unknown, _ready: boolean, enabled: boolean, source: PacketFlowSource, theme: string, reset: string, _nodes: unknown, nodeSource: string) {
    engine.calls({ source, enabled, theme, reset, nodeSource });
    useEffect(() => enabled ? source.onPacketObservation(engine.events) : undefined, [enabled, source]);
  },
}));

const nodes: FeatureCollection<Point, NodeFeatureProps> = { type: "FeatureCollection", features: [] };
const emptyBatch: MeshlogLiveBatch = { sequence: 0, observations: [] };
const event = liveObservation();
const key = `${event.packetHash}:${event.observation.observerId}`;
function mount() {
  const mapRef = { current: null };
  return renderHook(props => useMeshlogPacketFlow({ mapRef, visibleNodes: nodes, themeKey: "dark", ...props }), {
    initialProps: { enabled: true, isReady: true, batch: emptyBatch, visibleReportKeys: new Set([key]), resetKey: "all" },
  });
}
beforeEach(() => vi.clearAllMocks());

it("shares Beacon's renderer and Meshlog's node source without changing socket configuration", () => {
  const view = mount();
  const call = engine.calls.mock.calls[0]![0];
  expect(call.nodeSource).toBe("meshlog-nodes");
  expect(call.source).not.toHaveProperty("setResolvePath");
  view.rerender({ enabled: true, isReady: true, batch: { sequence: 1, observations: [event] }, visibleReportKeys: new Set([key]), resetKey: "all" });
  expect(engine.events).toHaveBeenCalledExactlyOnceWith(event);
  expect(engine.calls.mock.calls.at(-1)![0].source).toBe(call.source);
});

it("emits each publication once and filters individual observer reports", () => {
  const view = mount();
  const batch = { sequence: 1, observations: [event, liveObservation("observer-b")] };
  view.rerender({ enabled: true, isReady: true, batch, visibleReportKeys: new Set([key]), resetKey: "all" });
  expect(engine.events).toHaveBeenCalledExactlyOnceWith(event);
  // Directory, hydration, pinning, filter, and history renders cannot replay a live batch.
  view.rerender({ enabled: true, isReady: true, batch, visibleReportKeys: new Set([key, `${event.packetHash}:observer-b`]), resetKey: "filtered" });
  expect(engine.events).toHaveBeenCalledTimes(1);
  expect(engine.calls.mock.calls.at(-1)![0].reset).toBe("filtered");
});

it.each(["disabled", "loading", "excluded"] as const)("drops %s events instead of replaying after later eligibility", state => {
  const view = mount();
  const batch = { sequence: 1, observations: [event] };
  view.rerender({ enabled: state !== "disabled", isReady: state !== "loading", batch, visibleReportKeys: new Set(state === "excluded" ? [] : [key]), resetKey: "all" });
  view.rerender({ enabled: true, isReady: true, batch, visibleReportKeys: new Set([key]), resetKey: "all" });
  expect(engine.events).not.toHaveBeenCalled();
  view.rerender({ enabled: true, isReady: true, batch: { sequence: 2, observations: [event] }, visibleReportKeys: new Set([key]), resetKey: "all" });
  expect(engine.events).toHaveBeenCalledExactlyOnceWith(event);
});

it("starts from the current batch on mount and normalizes packet hash identity", () => {
  const mapRef = { current: null };
  const view = renderHook(({ batch }) => useMeshlogPacketFlow({ mapRef, visibleNodes: nodes, themeKey: "dark", resetKey: "all", enabled: true, isReady: true, batch, visibleReportKeys: new Set([key]) }), {
    initialProps: { batch: { sequence: 7, observations: [event] } },
  });
  expect(engine.events).not.toHaveBeenCalled();
  const uppercase = { ...event, packetHash: event.packetHash.toUpperCase() };
  view.rerender({ batch: { sequence: 8, observations: [uppercase] } });
  expect(engine.events).toHaveBeenCalledExactlyOnceWith(uppercase);
});
