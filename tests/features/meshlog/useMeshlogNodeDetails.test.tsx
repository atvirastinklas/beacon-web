import { type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useMeshlogNodeDetails } from "../../../src/features/meshlog/useMeshlogNodeDetails";
import { liveNodeDetail } from "./live-fixtures";

afterEach(() => vi.unstubAllGlobals());

it("fetches only inspected nodes, with no more than two concurrent detail requests", async () => {
  const pending = new Map<string, (response: Response) => void>();
  const fetch = vi.fn((input: string) => new Promise<Response>(resolve => { pending.set(input.split("/").at(-1)!, resolve); }));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(({ ids }) => useMeshlogNodeDetails(ids), { wrapper, initialProps: { ids: [] as string[] } });
  expect(fetch).not.toHaveBeenCalled();
  view.rerender({ ids: ["one", "two", "three"] });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(view.result.current.loading).toEqual(new Set(["one", "two", "three"]));
  const respond = (id: string) => act(() => pending.get(id)!(new Response(JSON.stringify({ ...liveNodeDetail(), id }), { headers: { "Content-Type": "application/json" } })));
  respond("one");
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(view.result.current.details.get("one")?.knownNeighborCount).toBe(7);
  respond("two"); respond("three");
  await waitFor(() => expect(view.result.current.loading.size).toBe(0));
  view.rerender({ ids: ["three", "two", "one"] });
  expect(fetch).toHaveBeenCalledTimes(3);
  view.unmount();
});

it("does not attach a response for a different node or silently retry it", async () => {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(liveNodeDetail()), { headers: { "Content-Type": "application/json" } })));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => useMeshlogNodeDetails(["wrong-node"]), { wrapper });
  await waitFor(() => expect(view.result.current.errors.has("wrong-node")).toBe(true));
  expect(view.result.current.details.size).toBe(0);
  expect(view.result.current.loading.size).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(1);
});
