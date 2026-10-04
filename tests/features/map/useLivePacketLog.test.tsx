import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WsManager } from "../../../src/api/ws-manager";
import type { WsPacketObservation } from "../../../src/types/ws";
import { LIVE_PACKET_LOG_CAP, LIVE_PACKET_LOG_GROUP_MS, useLivePacketLog } from "../../../src/features/map/useLivePacketLog";

type Data = WsPacketObservation["data"];

function observation(hash: string, iata = "VNO"): Data {
  return {
    packetHash: hash,
    packet: { payloadType: 4, payloadTypeName: "Advert", routeType: 1, routeTypeName: "Flood", isFirstObservation: true, observationCount: 1 },
    observation: { observerId: "observer", observerName: "Observer", iata, heardAt: 1_700_000_000_000, rssi: -70, snr: 8, sourceBroker: "test" },
  };
}

function manager() {
  const handlers = new Set<(data: Data) => void>();
  const unsubscribe = vi.fn();
  const onPacketObservation = vi.fn((handler: (data: Data) => void) => {
    handlers.add(handler);
    return () => { handlers.delete(handler); unsubscribe(); };
  });
  return {
    ws: { onPacketObservation } as unknown as WsManager,
    handlers,
    onPacketObservation,
    unsubscribe,
    emit: (data: Data) => { for (const handler of handlers) handler(data); },
  };
}

let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let now: number;
function flush() {
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(0);
  });
}

beforeEach(() => {
  frames = new Map();
  frameId = 0;
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { frames.delete(id); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("useLivePacketLog", () => {
  it("batches a burst into one frame, grouping repeat sightings with the latest payload", () => {
    const source = manager();
    const { result, unmount } = renderHook(() => useLivePacketLog(source.ws, true, "VNO", ["VNO"]));
    act(() => {
      source.emit(observation("same"));
      source.emit({ ...observation("same"), packet: { ...observation("same").packet, summary: "latest hearing" } });
      source.emit(observation("latest"));
    });
    expect(result.current).toEqual([]);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    flush();
    expect(result.current.map(entry => entry.data.packetHash)).toEqual(["latest", "same"]);
    expect(result.current[1].seenCount).toBe(2);
    expect(result.current[1].data.packet.summary).toBe("latest hearing");
    expect(new Set(result.current.map(entry => entry.id)).size).toBe(2);
    // The hook's own render created a fresh-but-equivalent IATA array; it must not reset/re-subscribe.
    expect(source.onPacketObservation).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("moves repeated packets to the front without mutating a published snapshot", () => {
    const source = manager();
    const { result, unmount } = renderHook(() => useLivePacketLog(source.ws, true, "all", undefined));
    act(() => { source.emit(observation("first")); source.emit(observation("second")); });
    flush();
    const snapshot = result.current;
    const previous = snapshot[1];
    now = 1_000;
    act(() => { source.emit(observation("first")); });
    flush();
    expect(result.current.map(entry => entry.data.packetHash)).toEqual(["first", "second"]);
    expect(result.current[0].id).toBe(previous.id);
    expect(result.current[0].seenCount).toBe(2);
    expect(result.current[0].firstReceivedAt).toBe(0);
    expect(result.current[0].lastReceivedAt).toBe(1_000);
    expect(snapshot.map(entry => entry.data.packetHash)).toEqual(["second", "first"]);
    expect(previous.seenCount).toBe(1);
    expect(previous.lastReceivedAt).toBe(0);
    unmount();
  });

  it("uses a fixed 30-second arrival window, not a sliding latest-heard window", () => {
    const source = manager();
    const { result, unmount } = renderHook(() => useLivePacketLog(source.ws, true, "all", undefined));
    act(() => { source.emit(observation("same")); });
    flush();
    const id = result.current[0].id;
    now = LIVE_PACKET_LOG_GROUP_MS - 1;
    act(() => { source.emit(observation("same")); });
    flush();
    expect(result.current).toHaveLength(1);
    expect(result.current[0].seenCount).toBe(2);
    now = LIVE_PACKET_LOG_GROUP_MS;
    act(() => { source.emit(observation("same")); });
    flush();
    expect(result.current).toHaveLength(2);
    expect(result.current[0].id).not.toBe(id);
    expect(result.current[0].seenCount).toBe(1);
    expect(result.current[1].id).toBe(id);
    unmount();
  });

  it("doesn't sum cumulative server counts or use out-of-order heardAt to group sightings", () => {
    const source = manager();
    const { result, unmount } = renderHook(() => useLivePacketLog(source.ws, true, "all", undefined));
    const first = observation("same");
    first.packet.observationCount = 500;
    first.observation.heardAt = 9_999_999_999_999;
    act(() => { source.emit(first); });
    flush();
    now = 10;
    const later = observation("same");
    later.packet.observationCount = 503;
    later.observation.heardAt = 1;
    act(() => { source.emit(later); });
    flush();
    expect(result.current).toHaveLength(1);
    expect(result.current[0].seenCount).toBe(2);
    expect(result.current[0].data).toBe(later);
    unmount();
  });

  it("bounds both pending bursts and published history to the most recent observations", () => {
    const source = manager();
    const { result, unmount } = renderHook(() => useLivePacketLog(source.ws, true, "all", undefined));
    act(() => { for (let i = 0; i < LIVE_PACKET_LOG_CAP + 30; i++) source.emit(observation(String(i))); });
    flush();
    expect(result.current).toHaveLength(LIVE_PACKET_LOG_CAP);
    expect(result.current[0].data.packetHash).toBe(String(LIVE_PACKET_LOG_CAP + 29));
    expect(result.current.at(-1)?.data.packetHash).toBe("30");
    act(() => { source.emit(observation("next")); });
    flush();
    expect(result.current).toHaveLength(LIVE_PACKET_LOG_CAP);
    expect(result.current[0].data.packetHash).toBe("next");
    // Evicted packets have no retained grouping state and start at one sighting when seen again.
    act(() => { source.emit(observation("0")); });
    flush();
    expect(result.current).toHaveLength(LIVE_PACKET_LOG_CAP);
    expect(result.current[0].data.packetHash).toBe("0");
    expect(result.current[0].seenCount).toBe(1);
    unmount();
  });

  it("subscribes only when enabled and starts an empty session on restart", () => {
    const source = manager();
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useLivePacketLog(source.ws, enabled, "VNO", ["VNO"]),
      { initialProps: { enabled: false } },
    );
    expect(source.onPacketObservation).not.toHaveBeenCalled();
    rerender({ enabled: true });
    act(() => { source.emit(observation("old")); });
    flush();
    expect(result.current).toHaveLength(1);
    act(() => { source.emit(observation("pending")); });
    rerender({ enabled: false });
    expect(result.current).toEqual([]);
    expect(source.handlers.size).toBe(0);
    expect(frames.size).toBe(0);
    rerender({ enabled: true });
    expect(result.current).toEqual([]);
    unmount();
  });

  it("clears on region change and ignores late/out-of-region events from the old subscription", () => {
    const source = manager();
    const { result, rerender, unmount } = renderHook(
      ({ region }) => useLivePacketLog(source.ws, true, region, [region]),
      { initialProps: { region: "VNO" } },
    );
    const oldHandler = [...source.handlers][0];
    act(() => { source.emit(observation("old")); });
    flush();
    rerender({ region: "KUN" });
    expect(result.current).toEqual([]);
    act(() => {
      oldHandler(observation("late-old"));
      source.emit(observation("wrong-region"));
      source.emit(observation("new-region", "KUN"));
    });
    flush();
    expect(result.current.map(entry => entry.data.packetHash)).toEqual(["new-region"]);
    expect(source.handlers.size).toBe(1);
    unmount();
  });

  it("accepts all regions for undefined IATAs, but no observations for an empty region", () => {
    const source = manager();
    const { result, rerender, unmount } = renderHook(
      ({ iatas }) => useLivePacketLog(source.ws, true, "region", iatas),
      { initialProps: { iatas: undefined as string[] | undefined } },
    );
    act(() => { source.emit(observation("any-region", "KUN")); });
    flush();
    expect(result.current).toHaveLength(1);
    rerender({ iatas: [] });
    act(() => { source.emit(observation("nothing", "KUN")); });
    flush();
    expect(result.current).toEqual([]);
    unmount();
  });

  it("cancels work and detaches safely on StrictMode unmount", () => {
    const source = manager();
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { unmount } = renderHook(() => useLivePacketLog(source.ws, true, "all", undefined), { wrapper });
    expect(source.handlers.size).toBe(1);
    const staleHandler = [...source.handlers][0];
    act(() => { source.emit(observation("pending")); });
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
    expect(source.handlers.size).toBe(0);
    act(() => { staleHandler(observation("after-unmount")); });
    expect(frames.size).toBe(0);
  });
});
