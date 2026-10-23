import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { PacketDetail } from "../../../src/types/api";
import type { PacketListItem } from "../../../src/features/packets/types";
import { usePacketPreviews } from "../../../src/features/packets/usePacketPreviews";
import { noteRateLimited, noteRequestOk } from "../../../src/api/rate-limit";

const getPacketDetail = vi.fn();
vi.mock("../../../src/api/client", () => ({ getPacketDetail: (...args: unknown[]) => getPacketDetail(...args) }));

const packet = (hash = "ede4a65a"): PacketListItem => ({
  packetHash: hash, payloadType: 5, payloadTypeName: "GRP_TXT", routeType: 3,
  routeTypeName: "TRANSPORT_FLOOD", firstHeardAt: 1, lastHeardAt: 2, observationCount: 15,
});
const detail = (hash = "ede4a65a"): PacketDetail => ({
  packetHash: hash, header: { raw: "17", payloadType: 5, payloadTypeName: "GRP_TXT", routeType: 3, routeTypeName: "TRANSPORT_FLOOD", payloadVersion: 0 },
  parsedPayload: { type: "GROUP_TEXT", decrypted: { sender: "Test sender 📡", content: "Test" } },
  rawPayload: "", decrypted: true, firstHeardAt: 1, lastHeardAt: 2, firstToLastMs: 1, observationCount: 15, observations: [],
});

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  getPacketDetail.mockReset();
  noteRequestOk();
});
afterEach(() => {
  qc.clear();
  noteRequestOk();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePacketPreviews", () => {
  it("loads decoded sender and text for a historical group packet without a channel event", async () => {
    getPacketDetail.mockResolvedValue(detail());
    const { result } = renderHook(() => usePacketPreviews([packet()]), { wrapper });
    await waitFor(() => expect(result.current.get("ede4a65a")).toEqual({ senderName: "Test sender 📡", content: "Test" }));
    expect(getPacketDetail).toHaveBeenCalledTimes(1);
  });

  it("reuses cached analyzer plaintext and reacts when another view loads details", async () => {
    qc.setQueryData(["packet-detail", "cached"], detail("cached"));
    const { result } = renderHook(() => usePacketPreviews([packet("cached")]), { wrapper });
    expect(result.current.get("cached")?.content).toBe("Test");
    expect(getPacketDetail).not.toHaveBeenCalled();
    act(() => qc.setQueryData(["packet-detail", "cached"], {
      ...detail("cached"), parsedPayload: { type: "GROUP_TEXT", decrypted: { sender: "Alice", content: "Updated" } },
    }));
    await waitFor(() => expect(result.current.get("cached")?.content).toBe("Updated"));
  });

  it("starts at most two detail requests at a time", async () => {
    const pending = new Map<string, (data: PacketDetail) => void>();
    getPacketDetail.mockImplementation((hash: string) => new Promise<PacketDetail>(resolve => pending.set(hash, resolve)));
    const { result } = renderHook(() => usePacketPreviews([packet("a"), packet("b"), packet("c")]), { wrapper });
    await waitFor(() => expect(getPacketDetail).toHaveBeenCalledTimes(2));
    expect(pending.has("c")).toBe(false);
    await act(async () => pending.get("a")!(detail("a")));
    await waitFor(() => expect(pending.has("c")).toBe(true));
    expect(result.current.get("a")?.content).toBe("Test");
    await act(async () => {
      pending.get("b")!(detail("b"));
      pending.get("c")!(detail("c"));
    });
    await waitFor(() => expect(result.current.size).toBe(3));
    expect(getPacketDetail).toHaveBeenCalledTimes(3);
  });

  it("does not fetch direct messages, non-message packets, or rows with live text", () => {
    renderHook(() => usePacketPreviews([
      { ...packet("direct"), payloadType: 2 }, { ...packet("advert"), payloadType: 4 },
      { ...packet("live"), message: { senderName: "Alice", content: "Live text" } },
    ]), { wrapper });
    expect(getPacketDetail).not.toHaveBeenCalled();
  });

  it("keeps requests bounded while scrolling to a new viewport", async () => {
    let active = 0;
    let maximum = 0;
    getPacketDetail.mockImplementation((_hash: string, signal: AbortSignal) => new Promise((_resolve, reject) => {
      maximum = Math.max(maximum, ++active);
      signal.addEventListener("abort", () => { active--; reject(signal.reason); }, { once: true });
    }));
    const { rerender, unmount } = renderHook(({ hashes }) => usePacketPreviews(hashes.map(hash => packet(hash))), {
      initialProps: { hashes: ["a", "b", "c"] }, wrapper,
    });
    await waitFor(() => expect(getPacketDetail).toHaveBeenCalledTimes(2));
    rerender({ hashes: ["d", "e", "f"] });
    await waitFor(() => expect(getPacketDetail).toHaveBeenCalledTimes(4));
    expect(getPacketDetail.mock.calls.map(([hash]) => hash)).toEqual(["a", "b", "d", "e"]);
    expect(maximum).toBe(2);
    unmount();
    expect(active).toBe(0);
  });

  it("aborts stalled preview requests so later visible packets can load", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return controller.signal;
    });
    getPacketDetail.mockImplementation((hash: string, signal: AbortSignal) => hash === "c" ? Promise.resolve(detail(hash)) : new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const { result } = renderHook(() => usePacketPreviews([packet("a"), packet("b"), packet("c")]), { wrapper });
    expect(getPacketDetail).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_010); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(getPacketDetail).toHaveBeenCalledTimes(3);
    expect(result.current.get("c")?.content).toBe("Test");
  });

  it("pauses remaining work after a 429 even when another request immediately succeeds", async () => {
    vi.useFakeTimers();
    getPacketDetail.mockImplementation((hash: string) => {
      if (hash === "a") {
        noteRateLimited(1000);
        return Promise.reject({ status: 429, retryAfterMs: 1000 });
      }
      noteRequestOk();
      return Promise.resolve(detail(hash));
    });
    renderHook(() => usePacketPreviews([packet("a"), packet("b"), packet("c")]), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(getPacketDetail.mock.calls.map(([hash]) => hash)).toEqual(["a", "b"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1010); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(getPacketDetail.mock.calls.map(([hash]) => hash)).toEqual(["a", "b", "c"]);
  });

  it.each([
    { parsedPayload: null },
    { parsedPayload: "ciphertext" },
    { parsedPayload: { type: "GROUP_TEXT", decrypted: null } },
    { parsedPayload: { type: "GROUP_TEXT", decrypted: { sender: {}, content: "Not text" } } },
    { parsedPayload: { type: "TEXT_MESSAGE", decrypted: { sender: "Alice", content: "Direct" } } },
    { packetHash: "different-packet" },
    { header: { ...detail().header, payloadType: 2 } },
  ])("does not expose malformed or mismatched plaintext (%j)", async (override) => {
    getPacketDetail.mockResolvedValue({ ...detail(), ...override });
    const { result } = renderHook(() => usePacketPreviews([packet()]), { wrapper });
    await waitFor(() => expect(qc.getQueryState(["packet-detail", "ede4a65a"])?.status).toBe("success"));
    expect(result.current.size).toBe(0);
    expect(getPacketDetail).toHaveBeenCalledTimes(1);
  });

  it("rechecks missing plaintext after a cooldown rather than on every render", async () => {
    vi.useFakeTimers();
    getPacketDetail.mockResolvedValueOnce({ ...detail(), parsedPayload: { type: "GROUP_TEXT", decrypted: null } }).mockResolvedValue(detail());
    const { result, rerender } = renderHook(() => usePacketPreviews([packet()]), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    rerender();
    expect(getPacketDetail).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(getPacketDetail).toHaveBeenCalledTimes(2);
    expect(result.current.get("ede4a65a")?.content).toBe("Test");
  });

  it("honors rate-limit deadlines even if an unrelated success clears the global flag", async () => {
    vi.useFakeTimers();
    noteRateLimited(1000);
    getPacketDetail.mockResolvedValue(detail());
    const { result } = renderHook(() => usePacketPreviews([packet()]), { wrapper });
    expect(getPacketDetail).not.toHaveBeenCalled();
    act(() => noteRequestOk());
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(getPacketDetail).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(getPacketDetail).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.get("ede4a65a")?.content).toBe("Test");
  });

  it("does not retry a failing packet in a loop", async () => {
    vi.useFakeTimers();
    getPacketDetail.mockRejectedValueOnce({ status: 429, retryAfterMs: 40_000 }).mockResolvedValue(detail());
    const { result } = renderHook(() => usePacketPreviews([packet()]), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(39_000); });
    expect(getPacketDetail).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1010); });
    expect(getPacketDetail).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.get("ede4a65a")?.content).toBe("Test");
  });
});
