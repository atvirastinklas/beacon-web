import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RegionProvider } from "../../../src/hooks/useRegion";
import { useMeshlogLiveData } from "../../../src/features/meshlog/useMeshlogLiveData";
import type { RegionSelection } from "../../../src/hooks/region-selection";
import { heardAt, liveMessage, liveNode, liveNodeDetail, liveObservation, historySummary, historyDetail, liveObserver } from "./live-fixtures";

class Socket {
  static instances: Socket[] = [];
  static OPEN = 1; static CLOSED = 3; static CONNECTING = 0; static CLOSING = 2;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Record<string, unknown>[] = [];
  constructor() { Socket.instances.push(this); }
  send(message: string) { this.sent.push(JSON.parse(message)); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  open() { this.readyState = 1; this.onopen?.(); this.emit({ v: 1, type: "hello", serverTime: heardAt, connectionId: "test" }); }
  emit(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
const empty = { items: [], hasMore: false, nextCursor: null };
let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  fetch = vi.fn((input: string) => {
    const path = new URL(input, "http://localhost").pathname;
    if (path.endsWith("/regions")) return json([]);
    if (path.endsWith("/scopes")) return json(["#north", "#south"]);
    if (path.endsWith("/nodes")) return json({ ...empty, items: [liveNode] });
    if (path.endsWith(`/nodes/${liveNode.id}`)) return json(liveNodeDetail());
    if (path.endsWith("/observers")) return json({ ...empty, items: [{ id: "observer-a", displayName: "Live RX A", iata: "RIX", status: "online" }] });
    if (path.includes("/observers/")) return json(liveObserver(path.split("/").at(-1)!));
    if (path.endsWith("/channels")) return json({ ...empty, items: [{ id: 1, channelHash: "channel-a", name: "Community", keyKnown: true, isHashtag: true, lastSeen: heardAt }] });
    if (path.endsWith("/packets")) return json(empty);
    if (path.includes("/packets/")) return json(historyDetail(path.split("/").at(-1)!));
    throw new Error(`Unexpected REST path ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => vi.unstubAllGlobals());

function mount(selection: RegionSelection = { regions: [], iatas: ["RIX"] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <StrictMode><QueryClientProvider client={client}><RegionProvider defaultSelection={selection}>{children}</RegionProvider></QueryClientProvider></StrictMode>;
  }
  return renderHook(useMeshlogLiveData, { wrapper: Wrapper });
}

it("exposes the dedicated stream's last-event timestamp for Beacon's shared live badge", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(heardAt);
  const view = mount();
  try {
    await waitFor(() => expect(view.result.current.state.loading).toBe(false));
    expect(view.result.current.state.lastEventTimestamp).toBe(heardAt);
    clock.mockReturnValue(heardAt + 5000);
    act(() => {
      const socket = Socket.instances.at(-1)!;
      socket.open();
      socket.emit({ v: 1, type: "event", event: "packetObservation", data: liveObservation() });
    });
    await waitFor(() => expect(view.result.current.data.messages).toHaveLength(1));
    expect(view.result.current.state.lastEventTimestamp).toBe(heardAt + 5000);
  } finally {
    view.unmount();
    clock.mockRestore();
  }
});

it("hydrates only inspected contacts with Beacon's real node fields and timestamps", async () => {
  const view = mount();
  await waitFor(() => expect(view.result.current.state.loading).toBe(false));
  expect(view.result.current.data.contacts[0]).toMatchObject({ node: liveNode, firstSeen: "—" });
  expect(view.result.current.data.contacts[0]!.firstSeenAt).toBeUndefined();
  expect(fetch.mock.calls.some(([url]) => String(url).includes(`/nodes/${liveNode.id}`))).toBe(false);
  act(() => view.result.current.onInspectContact(liveNode.id));
  await waitFor(() => expect(view.result.current.data.contacts[0]!.detail).toBeDefined());
  const contact = view.result.current.data.contacts[0]!;
  expect(contact.firstSeenAt).toBe(liveNodeDetail().firstSeen);
  expect(contact.node).toMatchObject({ knownNeighborCount: 7, radio: "868,250,11", defaultScope: "#north" });
  expect(contact.detail).toMatchObject({ supportsMultibytePaths: true, supportsMultibyteTraces: false, locationSource: "advert", lastAdvertAt: heardAt - 60_000 });
  expect(contact.interval).toBeUndefined();
  expect(contact.battery).toBeUndefined();
  const count = fetch.mock.calls.length;
  act(() => view.result.current.onInspectContact(liveNode.id));
  expect(fetch).toHaveBeenCalledTimes(count);
  view.unmount();
});

it("keeps newer live contact data without regressing fetched neighbor counts or capabilities", async () => {
  const view = mount();
  await waitFor(() => expect(view.result.current.state.loading).toBe(false));
  act(() => view.result.current.onInspectContact(liveNode.id));
  await waitFor(() => expect(view.result.current.data.contacts[0]!.detail).toBeDefined());
  act(() => {
    const socket = Socket.instances.at(-1)!;
    socket.open();
    socket.emit({ v: 1, type: "event", event: "nodeUpdate", data: {
      nodeId: liveNode.id, publicKey: liveNode.publicKey, name: "New live name", nodeType: 2, nodeTypeName: "repeater",
      radio: "868,125,9", defaultScope: "#south", isObserver: true, possiblyForeign: false,
      iata: "RIX", iatas: [{ iata: "RIX", lastHeard: heardAt + 60_000 }], lat: 56.95, lng: 24.1,
    } });
  });
  await waitFor(() => expect(view.result.current.data.contacts[0]!.name).toBe("New live name"));
  expect(view.result.current.data.contacts[0]).toMatchObject({ kind: "repeater", position: [24.1, 56.95], detail: {
    knownNeighborCount: 7, supportsMultibytePaths: true, radio: "868,125,9", defaultScope: "#south", isObserver: true, lastSeen: heardAt + 60_000,
  } });
  view.unmount();
});

it("shows a failed contact detail locally and retries only by explicit action", async () => {
  const defaults = fetch.getMockImplementation()!;
  let fail = true;
  fetch.mockImplementation((input: string) => input.endsWith(`/nodes/${liveNode.id}`) && fail ? json({ error: { code: "test", message: "Unavailable" } }, 503) : defaults(input));
  const view = mount();
  await waitFor(() => expect(view.result.current.state.loading).toBe(false));
  act(() => view.result.current.onInspectContact(liveNode.id));
  await waitFor(() => expect(view.result.current.data.contacts[0]!.detailError).toBe(true));
  expect(view.result.current.state.error).toBe(false);
  fail = false;
  act(() => view.result.current.onRetryContact(liveNode.id));
  await waitFor(() => expect(view.result.current.data.contacts[0]!.detail).toBeDefined());
  expect(view.result.current.data.contacts[0]!.detailError).toBe(false);
  view.unmount();
});

it("loads live directories and preserves two report paths with decoded text in either event order", async () => {
  const view = mount();
  await waitFor(() => expect(view.result.current.state.loading).toBe(false));
  expect(view.result.current.data.contacts[0]).toMatchObject({ name: "Live Walker", position: [24.087, 56.943] });
  expect(view.result.current.data.channels).toEqual([{ id: "channel-a", name: "Community", keyKnown: true }]);
  expect(view.result.current.data.scopes).toEqual(["#north", "#south"]);
  expect(view.result.current.data.messages).toHaveLength(0);
  const socket = Socket.instances.at(-1)!;
  act(() => socket.open());
  expect(socket.sent).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "configure", resolvePath: true }),
    expect.objectContaining({ type: "subscribe", scope: expect.objectContaining({ iatas: ["RIX"] }) }),
  ]));
  act(() => {
    socket.emit({ v: 1, type: "event", event: "channelMessage", data: liveMessage });
    socket.emit({ v: 1, type: "event", event: "packetObservation", data: liveObservation() });
    socket.emit({ v: 1, type: "event", event: "packetObservation", data: liveObservation("observer-b") });
    const outside = liveObservation("outside", "outside"); outside.observation.iata = "OTHER";
    socket.emit({ v: 1, type: "event", event: "packetObservation", data: outside });
  });
  await waitFor(() => expect(view.result.current.data.paths).toHaveLength(2));
  expect(view.result.current.data.messages).toHaveLength(1);
  expect(view.result.current.data.messages[0]).toMatchObject({ text: liveMessage.content, channel: "Community" });
  expect(view.result.current.data.messages[0]!.reports).toHaveLength(2);
  expect(view.result.current.liveBatch.sequence).toBe(1);
  expect(view.result.current.liveBatch.observations.map(event => event.observation.observerId)).toEqual(["observer-a", "observer-b"]);
  expect(view.result.current.data.reporters.find(observer => observer.id === "observer-a")).toMatchObject({ code: "a1", iata: "RIX", observerType: "repeater", status: "online" });
  expect(view.result.current.data.messages[0]!.reports[0]!.observerCode).toBe("a1");
  act(() => socket.emit({ v: 1, type: "lagged", droppedCount: 2, since: heardAt }));
  await waitFor(() => expect(view.result.current.state.gap).toBe(true));
  expect(fetch.mock.calls.some(([url]) => /\/packets\//.test(String(url)))).toBe(false);
  view.unmount();
  expect(Socket.instances.every(socket => socket.readyState === Socket.CLOSED)).toBe(true);
  expect(socket.onmessage).toBeNull();
});

it("loads regional scope names and retries a failed scope directory through the existing header action", async () => {
  const defaults = fetch.getMockImplementation()!;
  let fail = true;
  fetch.mockImplementation((input: string) => {
    if (new URL(input).pathname.endsWith("/scopes") && fail) {
      fail = false;
      return json({ error: { code: "test", message: "Unavailable" } }, 503);
    }
    return defaults(input);
  });
  const view = mount();
  await waitFor(() => expect(view.result.current.state.error).toBe(true));
  expect(view.result.current.data.scopes).toEqual([]);
  act(() => view.result.current.state.onRetry());
  await waitFor(() => expect(view.result.current.data.scopes).toEqual(["#north", "#south"]));
  expect(view.result.current.state.error).toBe(false);
  const scopeRequests = fetch.mock.calls.map(([url]) => new URL(String(url))).filter(url => url.pathname.endsWith("/scopes"));
  expect(scopeRequests.map(url => url.searchParams.get("iatas"))).toEqual(["RIX", "RIX"]);
  view.unmount();
});

it("merges initial history, lazy details and older pages with traffic already arriving", async () => {
  let resolveHistory!: (response: Response) => void;
  const defaults = fetch.getMockImplementation()!;
  fetch.mockImplementation((input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/packets")) return url.searchParams.has("cursor")
      ? json({ ...empty, items: [historySummary("older", heardAt - 1000)] })
      : new Promise<Response>(resolve => { resolveHistory = resolve; });
    return defaults(input);
  });
  const view = mount();
  await waitFor(() => expect(resolveHistory).toBeDefined());
  const initialRequest = fetch.mock.calls.map(([url]) => new URL(String(url))).find(url => url.pathname.endsWith("/packets"))!;
  expect(initialRequest.searchParams.get("limit")).toBe("30");
  const socket = Socket.instances.at(-1)!;
  act(() => {
    socket.open();
    socket.emit({ v: 1, type: "event", event: "packetObservation", data: liveObservation("observer-b", "packet-a", heardAt + 100) });
  });
  await act(async () => resolveHistory(new Response(JSON.stringify({ items: [historySummary()], hasMore: true, nextCursor: 20 }))));
  await waitFor(() => expect(view.result.current.data.messages).toHaveLength(1));
  await waitFor(() => expect(view.result.current.state.hasOlder).toBe(true));
  act(() => view.result.current.onVisiblePacketsChange(["packet-a"]));
  await waitFor(() => expect(view.result.current.data.messages[0]!.text).toBe(liveMessage.content));
  expect(view.result.current.data.messages[0]!.reports).toHaveLength(2);
  expect(view.result.current.data.paths).toHaveLength(2);
  act(() => view.result.current.state.loadOlder());
  await waitFor(() => expect(view.result.current.data.messages).toHaveLength(2));
  act(() => socket.emit({ v: 1, type: "event", event: "packetObservation", data: liveObservation("observer-a", "new", heardAt + 1000) }));
  await waitFor(() => expect(view.result.current.data.messages.map(message => message.id)).toEqual(["new", "packet-a", "older"]));
  expect(fetch.mock.calls.some(([url]) => String(url).includes("cursor=20"))).toBe(true);
  const olderRequest = fetch.mock.calls.map(([url]) => new URL(String(url))).find(url => url.searchParams.get("cursor") === "20")!;
  expect(olderRequest.searchParams.get("limit")).toBe("50");
  view.unmount();
});

it("hydrates only supplied candidates with at most two concurrent detail requests", async () => {
  const defaults = fetch.getMockImplementation()!;
  const completions: (() => void)[] = [];
  let active = 0; let peak = 0; let detailCalls = 0;
  fetch.mockImplementation((input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/packets")) return json({ ...empty, items: Array.from({ length: 10 }, (_, index) => historySummary(`packet-${index}`, heardAt - index)) });
    if (url.pathname.includes("/packets/")) {
      detailCalls++; active++; peak = Math.max(peak, active);
      return new Promise<Response>(resolve => completions.push(() => {
        active--; resolve(new Response(JSON.stringify(historyDetail(url.pathname.split("/").at(-1)!))));
      }));
    }
    return defaults(input);
  });
  const view = mount();
  await waitFor(() => expect(view.result.current.data.messages).toHaveLength(10));
  expect(detailCalls).toBe(0);
  act(() => view.result.current.onVisiblePacketsChange(Array.from({ length: 6 }, (_, index) => `packet-${index}`)));
  for (let expected = 2; expected <= 6; expected += 2) {
    await waitFor(() => expect(detailCalls).toBe(expected));
    expect(active).toBe(2);
    await act(async () => { completions.splice(0).forEach(complete => complete()); });
  }
  await waitFor(() => expect(view.result.current.data.messages.filter(message => message.text)).toHaveLength(6));
  expect(peak).toBe(2);
  expect(detailCalls).toBe(6);
  view.unmount();
});

it("does not connect or fetch directories for an unresolved or empty selected region", async () => {
  let resolveRegions!: (response: Response) => void;
  fetch.mockImplementation((input: string) => {
    const path = new URL(input).pathname;
    if (path.endsWith("/regions")) return new Promise<Response>(resolve => { resolveRegions = resolve; });
    if (path.endsWith("/regions/1")) return json({ id: 1, slug: "empty", name: "Empty", iatas: [] });
    throw new Error(`Unexpected request ${path}`);
  });
  const view = mount({ regions: ["empty"], iatas: [] });
  await waitFor(() => expect(resolveRegions).toBeDefined());
  expect(view.result.current.state.status).toBe("resolving");
  expect(Socket.instances).toHaveLength(0);
  expect(fetch.mock.calls.every(([url]) => String(url).endsWith("/regions"))).toBe(true);
  await act(async () => resolveRegions(new Response(JSON.stringify([{ id: 1, slug: "empty" }]))));
  await waitFor(() => expect(view.result.current.state.emptyRegion).toBe(true));
  expect(Socket.instances).toHaveLength(0);
  expect(view.result.current.data.contacts).toHaveLength(0);
  view.unmount();
});

it("refreshes packet history in the current region without resetting live data or claiming the gap is healed", async () => {
  const defaults = fetch.getMockImplementation()!;
  let resolveRefresh!: (response: Response) => void;
  let requests = 0;
  fetch.mockImplementation((input: string) => {
    if (!new URL(input).pathname.endsWith("/packets")) return defaults(input);
    requests++;
    return requests === 1 ? json({ items: [historySummary("older")], hasMore: true, nextCursor: 123 })
      : new Promise<Response>(resolve => { resolveRefresh = resolve; });
  });
  const view = mount();
  await waitFor(() => expect(view.result.current.data.messages.map(message => message.id)).toContain("older"));
  const socket = Socket.instances.at(-1)!;
  act(() => {
    socket.open();
    socket.emit({ v: 1, type: "lagged", droppedCount: 2, since: heardAt });
  });
  await waitFor(() => expect(view.result.current.state.gap).toBe(true));
  const connections = Socket.instances.length;
  const beforeRefresh = fetch.mock.calls.length;
  act(() => {
    view.result.current.state.refreshHistory();
    view.result.current.state.refreshHistory();
  });
  await waitFor(() => expect(view.result.current.state.historyRefreshing).toBe(true));
  act(() => {
    view.result.current.state.loadOlder();
    view.result.current.state.retryHistory();
  });
  expect(requests).toBe(2);
  expect(fetch.mock.calls.slice(beforeRefresh)).toHaveLength(1);
  const url = new URL(String(fetch.mock.calls.at(-1)![0]));
  expect(url.searchParams.get("iatas")).toBe("RIX");
  expect(url.searchParams.get("limit")).toBe("30");
  expect(url.searchParams.has("cursor")).toBe(false);
  act(() => socket.emit({ v: 1, type: "event", event: "packetObservation", data: liveObservation("observer-a", "during-refresh") }));
  await waitFor(() => expect(view.result.current.data.messages.map(message => message.id)).toContain("during-refresh"));
  await act(async () => resolveRefresh(new Response(JSON.stringify({ ...empty, items: [historySummary("refreshed", heardAt + 1000)] }))));
  await waitFor(() => expect(view.result.current.state.historyRefreshing).toBe(false));
  expect(view.result.current.data.messages.map(message => message.id)).toEqual(expect.arrayContaining(["older", "during-refresh", "refreshed"]));
  expect(view.result.current.state.gap).toBe(true);
  expect(Socket.instances).toHaveLength(connections);
  expect(socket.readyState).toBe(Socket.OPEN);
  view.unmount();
});

it("keeps existing packets and the gap warning after refresh failure and allows another refresh", async () => {
  const defaults = fetch.getMockImplementation()!;
  let fail = false;
  fetch.mockImplementation((input: string) => new URL(input).pathname.endsWith("/packets")
    ? fail ? json({ error: { code: "test", message: "Unavailable" } }, 503) : json({ ...empty, items: [historySummary("retained")] })
    : defaults(input));
  const view = mount();
  await waitFor(() => expect(view.result.current.data.messages.map(message => message.id)).toContain("retained"));
  act(() => {
    const socket = Socket.instances.at(-1)!;
    socket.open();
    socket.emit({ v: 1, type: "lagged", droppedCount: 2, since: heardAt });
  });
  await waitFor(() => expect(view.result.current.state.gap).toBe(true));
  fail = true;
  act(() => view.result.current.state.refreshHistory());
  await waitFor(() => expect(view.result.current.state.historyError).toBe(true));
  expect(view.result.current.state.historyRefreshing).toBe(false);
  expect(view.result.current.state.gap).toBe(true);
  expect(view.result.current.data.messages.map(message => message.id)).toContain("retained");
  fail = false;
  act(() => view.result.current.state.refreshHistory());
  await waitFor(() => expect(view.result.current.state.historyError).toBe(false));
  view.unmount();
});

it("does not interrupt loading older packets to refresh history", async () => {
  const defaults = fetch.getMockImplementation()!;
  let resolveOlder!: (response: Response) => void;
  let requests = 0;
  fetch.mockImplementation((input: string) => {
    const url = new URL(input);
    if (!url.pathname.endsWith("/packets")) return defaults(input);
    requests++;
    return url.searchParams.has("cursor") ? new Promise<Response>(resolve => { resolveOlder = resolve; })
      : json({ items: [historySummary("head")], hasMore: true, nextCursor: 123 });
  });
  const view = mount();
  await waitFor(() => expect(view.result.current.state.hasOlder).toBe(true));
  act(() => view.result.current.state.loadOlder());
  await waitFor(() => expect(view.result.current.state.loadingOlder).toBe(true));
  expect(view.result.current.state.historyRefreshing).toBe(true);
  act(() => view.result.current.state.refreshHistory());
  expect(requests).toBe(2);
  await act(async () => resolveOlder(new Response(JSON.stringify({ ...empty, items: [historySummary("older", heardAt - 1000)] }))));
  await waitFor(() => expect(view.result.current.state.historyRefreshing).toBe(false));
  expect(view.result.current.data.messages.map(message => message.id)).toEqual(["head", "older"]);
  view.unmount();
});

it("surfaces metadata failures and supports explicit retry without polling", async () => {
  let failing = true;
  const defaults = fetch.getMockImplementation()!;
  fetch.mockImplementation((input: string) => input.includes("/nodes") && failing ? json({ error: { code: "test", message: "Unavailable" } }, 503) : defaults(input));
  const view = mount();
  await waitFor(() => expect(view.result.current.state.error).toBe(true));
  failing = false;
  act(() => view.result.current.state.onRetry());
  await waitFor(() => expect(view.result.current.data.contacts).toHaveLength(1));
  await waitFor(() => expect(view.result.current.state.error).toBe(false));
  view.unmount();
});

it("keeps websocket node updates authoritative when stale REST metadata arrives later", async () => {
  let resolveNodes!: (response: Response) => void;
  const defaults = fetch.getMockImplementation()!;
  fetch.mockImplementation((input: string) => input.includes("/nodes") ? new Promise<Response>(resolve => { resolveNodes = resolve; }) : defaults(input));
  const view = mount();
  await waitFor(() => expect(resolveNodes).toBeDefined());
  const socket = Socket.instances.at(-1)!;
  act(() => {
    socket.open();
    socket.emit({ v: 1, type: "event", event: "nodeUpdate", data: {
      nodeId: liveNode.id, publicKey: liveNode.publicKey, name: "Updated live", nodeType: 1,
      nodeTypeName: "Companion", iata: "RIX", iatas: liveNode.iatas, isObserver: false, lat: null, lng: null,
    } });
  });
  await act(async () => resolveNodes(new Response(JSON.stringify({ ...empty, items: [liveNode] }))));
  await waitFor(() => expect(view.result.current.data.contacts[0]).toMatchObject({ name: "Updated live", position: null }));
  view.unmount();
});

it("does not reconnect or report a stream gap when region metadata resolves to the same IATAs", async () => {
  let resolveRegions!: (response: Response) => void;
  const defaults = fetch.getMockImplementation()!;
  fetch.mockImplementation((input: string) => input.endsWith("/regions") ? new Promise<Response>(resolve => { resolveRegions = resolve; }) : defaults(input));
  const view = mount();
  await waitFor(() => expect(resolveRegions).toBeDefined());
  const socket = Socket.instances.at(-1)!;
  act(() => socket.open());
  const connections = Socket.instances.length;
  await act(async () => resolveRegions(new Response("[]")));
  await waitFor(() => expect(view.result.current.state.loading).toBe(false));
  expect(Socket.instances).toHaveLength(connections);
  expect(socket.readyState).toBe(Socket.OPEN);
  expect(view.result.current.state.gap).toBe(false);
  view.unmount();
});

it("reuses an explicit node observer key instead of requesting it by name or UUID prefix", async () => {
  const defaults = fetch.getMockImplementation()!;
  fetch.mockImplementation((input: string) => input.includes("/nodes") ? json({ ...empty, items: [{ ...liveNode,
    observerId: "observer-a", isObserver: true, publicKey: liveObserver().publicKey,
  }] }) : defaults(input));
  const view = mount();
  await waitFor(() => expect(view.result.current.state.loading).toBe(false));
  expect(view.result.current.data.reporters[0]!.code).toBe("a1b2c3d4");
  expect(fetch.mock.calls.some(([url]) => String(url).includes("/observers/"))).toBe(false);
  view.unmount();
});

it("loads missing observer keys at most two at a time", async () => {
  const defaults = fetch.getMockImplementation()!;
  const completions: (() => void)[] = [];
  let active = 0; let peak = 0; let detailCalls = 0;
  fetch.mockImplementation((input: string) => {
    const path = new URL(input).pathname;
    if (path.endsWith("/observers")) return json({ ...empty, items: Array.from({ length: 5 }, (_, index) => ({ id: `rx-${index}`, displayName: `Receiver ${index}`, iata: "RIX", status: "online" })) });
    if (path.includes("/observers/")) {
      detailCalls++; active++; peak = Math.max(peak, active);
      return new Promise<Response>(resolve => completions.push(() => { active--; resolve(new Response(JSON.stringify(liveObserver(path.split("/").at(-1)!)))); }));
    }
    return defaults(input);
  });
  const view = mount();
  for (const [expected, inFlight] of [[2, 2], [4, 2], [5, 1]]) {
    await waitFor(() => expect(detailCalls).toBe(expected));
    expect(active).toBe(inFlight);
    await act(async () => completions.splice(0).forEach(complete => complete()));
  }
  await waitFor(() => expect(view.result.current.state.loading).toBe(false));
  expect(view.result.current.data.reporters.every(observer => observer.code)).toBe(true);
  expect(peak).toBe(2);
  view.unmount();
});
