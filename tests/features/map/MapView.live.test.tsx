import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { WsManager } from "../../../src/api/ws-manager";
import type { WsPacketObservation } from "../../../src/types/ws";
import type { ChannelMessage } from "../../../src/features/channels/types";

const captures = vi.hoisted(() => ({ nodes: vi.fn(), analyze: vi.fn(), share: {} as Record<string, string | null>, mobile: false, regionKey: "*", iatas: undefined as string[] | undefined, resolved: true }));
vi.mock("../../../src/hooks/useMediaQuery", async importOriginal => ({
  ...await importOriginal<typeof import("../../../src/hooks/useMediaQuery")>(), useIsMobile: () => captures.mobile,
}));
vi.mock("../../../src/features/map/useMapNodes", () => ({ useMapNodes: captures.nodes }));
vi.mock("../../../src/features/map/useMapLibre", () => ({ useMapLibre: () => ({ containerRef: { current: null }, mapRef: { current: null }, isReady: false, error: null, nodeIconResolverRef: { current: null } }) }));
vi.mock("../../../src/features/map/useMapPacketFlow", () => ({ useMapPacketFlow: vi.fn() }));
vi.mock("../../../src/features/map/useMapNeighbors", () => ({ useMapNeighbors: vi.fn() }));
vi.mock("../../../src/features/map/useMapBorders", () => ({ useMapBorders: vi.fn() }));
vi.mock("../../../src/features/map/useMapBordersData", () => ({ useMapBordersData: () => [] }));
vi.mock("../../../src/features/map/useMapNodesData", () => ({ useMapNodesData: () => ({ nodes: [], loadedCount: 0, isPaging: false, isError: false }) }));
vi.mock("../../../src/hooks/useRegion", () => ({
  useRegion: () => ({ iatas: captures.iatas, regionKey: captures.regionKey, isResolved: captures.resolved }),
  useRegionSelection: () => ({ selection: { regions: [], iatas: [] } }),
}));
vi.mock("../../../src/hooks/useTheme", () => ({ useTheme: () => ({ themeId: "dark", themes: [] }) }));
vi.mock("../../../src/hooks/useWsHandlers", () => ({ useWsNodeUpdateHandler: vi.fn() }));
vi.mock("../../../src/api/client", () => ({ getIatas: async () => [], getNodeNeighbors: async () => [] }));
vi.mock("../../../src/features/map/MapSettingsPanel", () => ({ MapSettingsPanel: (props: { clustered: boolean; clusteringDisabled: boolean; buildShareParams: () => Record<string, string | null> }) => <>
  <output data-testid="clustered">{String(props.clustered)}</output>
  <button disabled={props.clusteringDisabled}>Clustering</button>
  <button onClick={() => { captures.share = props.buildShareParams(); }}>Share test view</button>
</> }));
import { MapView } from "../../../src/features/map/MapView";

function mount(url = "/?tab=Map") {
  const handlers = new Set<(data: WsPacketObservation["data"]) => void>();
  const messages = new Set<(data: ChannelMessage) => void>();
  const source = {
    getStatus: () => "connected" as const,
    onStatusChange: () => () => {},
    onChannelMessage: vi.fn((handler: (data: ChannelMessage) => void) => {
      messages.add(handler);
      return () => { messages.delete(handler); };
    }),
    onPacketObservation: vi.fn((handler: (data: WsPacketObservation["data"]) => void) => {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    }),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = (show = true) => <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[url]}>{show && <MapView wsManager={source as unknown as WsManager} selectedNodeId={null} onSelectNode={vi.fn()} onAnalyzePacket={captures.analyze} />}</MemoryRouter>
  </QueryClientProvider>;
  const view = render(root());
  return { ...view, source, handlers, messages, redraw: (show = true) => view.rerender(root(show)), emit: (data: WsPacketObservation["data"]) => act(() => { for (const handler of handlers) handler(data); }), emitMessage: (data: ChannelMessage) => act(() => { for (const handler of messages) handler(data); }) };
}

function observation(summary: string): WsPacketObservation["data"] {
  return { packetHash: summary, packet: { payloadType: 4, payloadTypeName: "Advert", routeType: 1, routeTypeName: "Flood", isFirstObservation: true, observationCount: 1, summary }, observation: { observerId: "observer", observerName: "Observer", iata: "VNO", heardAt: Date.now(), rssi: -70, snr: 8, sourceBroker: "fixture" } };
}

beforeEach(() => {
  captures.mobile = false;
  captures.regionKey = "*";
  captures.iatas = undefined;
  captures.resolved = true;
  vi.clearAllMocks();
});

describe("Live Map clustering", () => {
  it.each(["on", "off"])("forces clustering off without overwriting the saved %s preference, then restores it", preference => {
    localStorage.setItem("beacon-map-clustering", preference);
    mount();
    expect(screen.getByTestId("clustered")).toHaveTextContent(String(preference === "on"));
    fireEvent.click(screen.getByRole("button", { name: "Play live map packet flow" }));
    expect(screen.getByTestId("clustered")).toHaveTextContent("false");
    expect(screen.getByRole("button", { name: "Clustering" })).toBeDisabled();
    expect(captures.nodes.mock.lastCall?.[6]).toBe(false);
    expect(localStorage.getItem("beacon-map-clustering")).toBe(preference);
    fireEvent.click(screen.getByRole("button", { name: "Share test view" }));
    expect(captures.share).toMatchObject({ flow: "on", clustering: "off" });
    fireEvent.click(screen.getByRole("button", { name: "Stop live map packet flow" }));
    expect(screen.getByTestId("clustered")).toHaveTextContent(String(preference === "on"));
    expect(screen.getByRole("button", { name: "Clustering" })).toBeEnabled();
    expect(captures.nodes.mock.lastCall?.[6]).toBe(preference === "on");
  });

  it("does not mistake forced-off clustering in a live deep link for the saved preference", () => {
    localStorage.setItem("beacon-map-clustering", "on");
    mount("/?tab=Map&flow=on&clustering=off");
    expect(screen.getByTestId("clustered")).toHaveTextContent("false");
    fireEvent.click(screen.getByRole("button", { name: "Stop live map packet flow" }));
    expect(screen.getByTestId("clustered")).toHaveTextContent("true");
    expect(localStorage.getItem("beacon-map-clustering")).toBe("on");
  });
});

describe("Map packet-log integration", () => {
  it("joins decoded group content from the existing message stream without losing packet identity or sightings", async () => {
    const view = mount("/?tab=Map&flow=on");
    const packet = observation("opaque fallback");
    packet.packet.payloadType = 5;
    const message = { id: 1, packetHash: packet.packetHash, channelHash: "public", senderName: "Alice", content: "Hello from the mesh", sentAt: Date.now() };
    view.emitMessage(message);
    view.emit(packet);
    const row = await screen.findByRole("button", { name: "Packet details: GRP_TXT · Hello from the mesh · Sender: Alice" });
    expect(row).toHaveTextContent("Hello from the mesh");
    expect(row).toHaveTextContent("Alice");
    expect(row).not.toHaveTextContent("Sender:");
    view.emit(packet);
    expect(await screen.findByLabelText("2 sightings in this feed")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    view.emitMessage({ ...message, content: "Late decoded update" });
    expect(await screen.findByText("Late decoded update")).toBeVisible();
    expect(screen.getByLabelText("2 sightings in this feed")).toBeVisible();
    fireEvent.click(row);
    expect(captures.analyze).toHaveBeenCalledExactlyOnceWith(packet.packetHash);
    fireEvent.click(screen.getByRole("button", { name: "Stop live map packet flow" }));
    expect(view.messages.size).toBe(0);
  });
  it("forwards the current packet hash after region reset without retaining inline details", async () => {
    captures.regionKey = "VNO";
    captures.iatas = ["VNO"];
    const view = mount("/?tab=Map&flow=on");
    view.emit(observation("Packet A"));
    const firstRow = await screen.findByRole("button", { name: "Packet details: ADVERT · Packet A" });
    fireEvent.click(firstRow);
    expect(firstRow).not.toHaveAttribute("aria-expanded");
    expect(captures.analyze).toHaveBeenCalledExactlyOnceWith("Packet A");
    expect(screen.queryByRole("button", { name: "Close packet details" })).not.toBeInTheDocument();

    captures.regionKey = "OTHER";
    captures.iatas = ["OTHER"];
    view.redraw();
    expect(screen.getByText("Waiting for packets…")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Close packet details" })).not.toBeInTheDocument();
    expect(screen.queryByText("Packet A")).not.toBeInTheDocument();

    const nextPacket = observation("Packet B");
    nextPacket.observation.iata = "OTHER";
    view.emit(nextPacket);
    const newRow = await screen.findByRole("button", { name: "Packet details: ADVERT · Packet B" });
    expect(newRow).not.toHaveAttribute("aria-expanded");
    fireEvent.click(newRow);
    expect(captures.analyze.mock.calls).toEqual([["Packet A"], ["Packet B"]]);
    expect(screen.queryByRole("button", { name: "Close packet details" })).not.toBeInTheDocument();
    expect(screen.queryByText("Packet A")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("updates repeated hashes in place without changing first-heard time or order", async () => {
    const view = mount("/?tab=Map&flow=on");
    const first = observation("First packet");
    first.observation.heardAt = 1_700_000_000_000;
    const second = observation("Second packet");
    second.observation.heardAt = first.observation.heardAt + 1_000;
    view.emit(first);
    view.emit(second);
    await screen.findByText("2/100");
    const repeat = observation("First packet");
    repeat.packet.observationCount = 45;
    repeat.observation.heardAt = second.observation.heardAt + 60_000;
    repeat.observation.observerName = "Latest observer";
    view.emit(repeat);
    await screen.findByLabelText("2 sightings in this feed");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Second packet");
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("First packet");
    expect(screen.getAllByRole("listitem")[1].querySelector("time")).toHaveAttribute("datetime", new Date(first.observation.heardAt).toISOString());
    fireEvent.click(screen.getByRole("button", { name: /Packet details: ADVERT · First packet/ }));
    expect(captures.analyze).toHaveBeenCalledExactlyOnceWith("First packet");
    expect(screen.getByLabelText("2 sightings in this feed")).toHaveTextContent("×2");
    expect(screen.queryByText("Server observations")).not.toBeInTheDocument();
  });

  it("only mounts and subscribes in Live mode, then restarts with a fresh expanded feed", async () => {
    const view = mount();
    expect(screen.queryByRole("region", { name: "Live packets" })).not.toBeInTheDocument();
    expect(view.handlers.size).toBe(0);
    expect(view.messages.size).toBe(0);
    view.emit(observation("Outside Live mode"));
    fireEvent.click(screen.getByRole("button", { name: "Play live map packet flow" }));
    expect(screen.getByRole("region", { name: "Live packets" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Live packets" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Waiting for packets…")).toBeVisible();
    expect(view.handlers.size).toBe(1);
    expect(view.messages.size).toBe(1);
    view.emit(observation("Live observation"));
    expect(await screen.findByText("Live observation")).toBeVisible();
    expect(screen.queryByText("Outside Live mode")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Live packets" }));
    view.emit(observation("While collapsed"));
    expect(await screen.findByText("2/100")).toBeVisible();
    expect(view.handlers.size).toBe(1);
    expect(view.messages.size).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop live map packet flow" }));
    expect(screen.queryByRole("region", { name: "Live packets" })).not.toBeInTheDocument();
    expect(view.handlers.size).toBe(0);
    expect(view.messages.size).toBe(0);
    view.emit(observation("Between Live sessions"));
    fireEvent.click(screen.getByRole("button", { name: "Play live map packet flow" }));
    expect(screen.getByRole("button", { name: "Live packets" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Waiting for packets…")).toBeVisible();
    expect(screen.getByText("0/100")).toBeVisible();
    expect(screen.queryByText("Live observation")).not.toBeInTheDocument();
    expect(screen.queryByText("While collapsed")).not.toBeInTheDocument();
    expect(screen.queryByText("Between Live sessions")).not.toBeInTheDocument();
    expect(view.handlers.size).toBe(1);
    expect(view.source.onPacketObservation).toHaveBeenCalledTimes(2);
    expect(view.source.onChannelMessage).toHaveBeenCalledTimes(2);
  });

  it("keeps collecting while collapsed, then shows newest observations first", async () => {
    const view = mount("/?tab=Map&flow=on");
    fireEvent.click(screen.getByRole("button", { name: "Live packets" }));
    view.emit(observation("Older observation"));
    view.emit(observation("Newest observation"));
    expect(await screen.findByText("2/100")).toBeVisible();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(view.handlers.size).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Live packets" }));
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Newest observation");
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("Older observation");
  });

  it("unmounts and unsubscribes on mobile or leaving the map, then starts a fresh desktop session", async () => {
    const view = mount("/?tab=Map&flow=on");
    view.emit(observation("Desktop observation"));
    await screen.findByText("Desktop observation");
    captures.mobile = true;
    view.redraw();
    expect(screen.queryByRole("region", { name: "Live packets" })).not.toBeInTheDocument();
    expect(view.handlers.size).toBe(0);
    expect(view.messages.size).toBe(0);
    captures.mobile = false;
    view.redraw();
    expect(screen.getByText("Waiting for packets…")).toBeVisible();
    expect(screen.queryByText("Desktop observation")).not.toBeInTheDocument();
    expect(view.handlers.size).toBe(1);
    view.redraw(false);
    expect(view.handlers.size).toBe(0);
    expect(view.messages.size).toBe(0);
    expect(screen.queryByRole("region", { name: "Live packets" })).not.toBeInTheDocument();
  });

  it("shows pending-region waiting without subscribing and clears rows when scope changes", async () => {
    captures.resolved = false;
    const view = mount("/?tab=Map&flow=on");
    expect(screen.getByText("Loading region…")).toBeVisible();
    expect(view.handlers.size).toBe(0);
    expect(view.messages.size).toBe(0);
    captures.resolved = true;
    view.redraw();
    view.emit(observation("Previous scope"));
    await screen.findByText("Previous scope");
    captures.regionKey = "OTHER";
    captures.iatas = ["OTHER"];
    view.redraw();
    expect(screen.queryByText("Previous scope")).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for packets…")).toBeVisible();
    view.emit(observation("Late old-scope observation"));
    expect(screen.queryByText("Late old-scope observation")).not.toBeInTheDocument();
  });
});
