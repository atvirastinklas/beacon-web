import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { App } from "../src/App";
import { useRegionSelection } from "../src/hooks/useRegion";

function RegionChanger() {
  const { setSelection } = useRegionSelection();
  return <button onClick={() => setSelection({ regions: [], iatas: ["KUN"] })}>Change test region</button>;
}

const state = vi.hoisted(() => ({ mobile: false, mapMounts: 0, staleDetailHash: null as string | null }));
vi.mock("../src/hooks/useMediaQuery", async importOriginal => ({
  ...await importOriginal<typeof import("../src/hooks/useMediaQuery")>(),
  useIsMobile: () => state.mobile,
}));
vi.mock("../src/api/ws-manager", () => ({ WsManager: class {
  connect() {}
  disconnect() {}
  updateSubscription() {}
} }));
vi.mock("../src/api/client", () => ({
  getRegions: async () => [], getIatas: async () => [], getRegion: async () => ({ iatas: [] }), getScopes: async () => [],
}));
vi.mock("../src/components/SplashScreen", () => ({ SplashScreen: () => null }));
vi.mock("../src/components/AppShell", () => ({
  AppShell: ({ children, activeTab, onTabChange }: { children: ReactNode; activeTab: string; onTabChange: (tab: string) => void }) => <>
    <output data-testid="active-tab">{activeTab}</output>
    <button onClick={() => onTabChange("Map")}>Map tab</button>
    <button onClick={() => onTabChange("Packets")}>Packets tab</button>
    <RegionChanger />
    {children}
  </>,
}));
vi.mock("../src/features/map/MapView", () => ({ MapView: ({ onAnalyzePacket, onSelectNode, selectedPacketDetail }: {
  onAnalyzePacket: (hash: string) => void; onSelectNode: (id: string) => void;
  selectedPacketDetail?: { packetHash: string } | null;
}) => {
  useEffect(() => { state.mapMounts++; }, []);
  return <section aria-label="Map view">
    <output data-testid="selected-path-packet">{selectedPacketDetail?.packetHash ?? "none"}</output>
    <button onClick={() => onAnalyzePacket("aa11")}>Live packet A</button>
    <button onClick={() => onAnalyzePacket("bb22")}>Live packet B</button>
    <button onClick={() => onSelectNode("new-node")}>Visible map node</button>
  </section>;
} }));
vi.mock("../src/features/packets/PacketList", () => ({ PacketList: () => <p>Packets view</p> }));
vi.mock("../src/features/nodes/NodeDetailPanel", () => ({ NodeDetailPanel: ({ nodeId }: { nodeId: string }) => <section aria-label={`Node ${nodeId}`} /> }));
vi.mock("../src/features/InvestigationPanels", () => ({ InvestigationPanel: () => <section role="dialog" aria-label="Path investigation" /> }));
vi.mock("../src/features/packets/usePacketDetail", () => ({
  usePacketDetail: (hash: string | null) => ({ data: hash ? { packetHash: state.staleDetailHash ?? hash, observations: [], header: { payloadType: 4 } } : undefined, isLoading: false }),
}));
vi.mock("../src/features/packets/PacketAnalyzerDrawer", () => ({ PacketAnalyzerDrawer: ({ detail, selectedObservationId, onSelectObservation, onClose }: {
  detail?: { packetHash: string }; selectedObservationId: number | null; onSelectObservation: (id: number) => void; onClose: () => void;
}) => <aside data-testid="packet-analyzer-drawer">
  <span>{detail?.packetHash}</span>
  <output data-testid="selected-report">{selectedObservationId === null ? "default" : selectedObservationId}</output>
  <button onClick={() => onSelectObservation(2)}>Select report 2</button>
  <button onClick={onClose}>Close packet sidebar</button>
</aside> }));

const params = () => new URLSearchParams(window.location.search);
beforeEach(() => { state.mobile = false; state.mapMounts = 0; state.staleDetailHash = null; });

describe("live Map packet sidebar", () => {
  it("opens the existing sidebar without leaving/remounting Map or changing its view parameters", async () => {
    window.history.replaceState({}, "", "/?tab=Map&flow=on&lat=55&lng=25&zoom=13&clustering=off&iata=VNO");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Live packet A" }));
    expect(screen.getByTestId("packet-analyzer-drawer")).toHaveTextContent("aa11");
    expect(screen.getByTestId("selected-path-packet")).toHaveTextContent("aa11");
    expect(screen.getByTestId("active-tab")).toHaveTextContent("Map");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(params().get("analyze")).toBe("1");
    for (const [key, value] of [["tab", "Map"], ["flow", "on"], ["lat", "55"], ["lng", "25"], ["zoom", "13"], ["clustering", "off"], ["iata", "VNO"]]) {
      expect(params().get(key!)).toBe(value);
    }
    fireEvent.click(screen.getByRole("button", { name: "Live packet B" }));
    expect(screen.getByTestId("packet-analyzer-drawer")).toHaveTextContent("bb22");
    expect(screen.getByTestId("selected-path-packet")).toHaveTextContent("bb22");
    fireEvent.click(screen.getByRole("button", { name: "Close packet sidebar" }));
    expect(screen.queryByTestId("packet-analyzer-drawer")).not.toBeInTheDocument();
    expect(screen.getByTestId("selected-path-packet")).toHaveTextContent("none");
    expect(params().get("tab")).toBe("Map");
    expect(params().get("flow")).toBe("on");
    expect(state.mapMounts).toBe(1);
  });

  it("clears stale node and report selections even when reopening the same packet hash", async () => {
    window.history.replaceState({}, "", "/?tab=Map&flow=on&hash=aa11&analyze=1&observation=2&node=old-node&path=all");
    render(<App />);
    await screen.findByTestId("packet-analyzer-drawer");
    expect(params().get("observation")).toBe("2"); // valid explicit deep links restore their report
    expect(screen.queryByRole("region", { name: "Node old-node" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select report 2" }));
    expect(screen.getByTestId("selected-report")).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "Live packet A" }));
    expect(screen.getByTestId("selected-report")).toHaveTextContent("default");
    for (const key of ["observation", "node", "path"]) expect(params().has(key)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close packet sidebar" }));
    expect(screen.queryByRole("region", { name: "Node old-node" })).not.toBeInTheDocument();
  });

  it("replaces the Map packet sidebar when a real map node is selected", async () => {
    window.history.replaceState({}, "", "/?tab=Map&flow=on&hash=aa11&analyze=1");
    render(<App />);
    await screen.findByTestId("packet-analyzer-drawer");
    fireEvent.click(screen.getByRole("button", { name: "Visible map node" }));
    expect(screen.queryByTestId("packet-analyzer-drawer")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Node new-node" })).toBeInTheDocument();
    expect(params().has("analyze")).toBe(false);
    expect(screen.getByTestId("selected-path-packet")).toHaveTextContent("none");
  });

  it("clears the selected Map packet on a real region change, but preserves an initial deep link", async () => {
    window.history.replaceState({}, "", "/?tab=Map&flow=on&hash=aa11&analyze=1&iata=VNO");
    render(<App />);
    await screen.findByTestId("packet-analyzer-drawer");
    expect(screen.getByTestId("selected-path-packet")).toHaveTextContent("aa11");
    fireEvent.click(screen.getByRole("button", { name: "Change test region" }));
    expect(screen.queryByTestId("packet-analyzer-drawer")).not.toBeInTheDocument();
    expect(screen.getByTestId("selected-path-packet")).toHaveTextContent("none");
    expect(params().has("analyze")).toBe(false);
  });

  it("never supplies a previous packet's paths while the newly selected packet is loading", async () => {
    window.history.replaceState({}, "", "/?tab=Map&flow=on");
    const view = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Live packet A" }));
    expect(screen.getByTestId("selected-path-packet")).toHaveTextContent("aa11");
    state.staleDetailHash = "AA11";
    fireEvent.click(screen.getByRole("button", { name: "Live packet B" }));
    expect(screen.getByTestId("selected-path-packet")).toHaveTextContent("none");
    state.staleDetailHash = "BB22";
    view.rerender(<App />);
    expect(screen.getByTestId("selected-path-packet")).toHaveTextContent("BB22");
  });

  it("does not close a different tab's analyzer when its region changes", async () => {
    window.history.replaceState({}, "", "/?tab=Packets&hash=aa11&analyze=1&iata=VNO");
    render(<App />);
    await screen.findByTestId("packet-analyzer-drawer");
    fireEvent.click(screen.getByRole("button", { name: "Change test region" }));
    expect(screen.getByTestId("packet-analyzer-drawer")).toHaveTextContent("aa11");
    expect(params().get("analyze")).toBe("1");
  });

  it("doesn't carry a previous tab's analyzer into Map, but preserves a sidebar on a no-op Map tab click", async () => {
    window.history.replaceState({}, "", "/?tab=Packets&hash=aa11&analyze=1");
    render(<App />);
    await screen.findByTestId("packet-analyzer-drawer");
    fireEvent.click(screen.getByRole("button", { name: "Map tab" }));
    await screen.findByRole("button", { name: "Live packet A" });
    expect(screen.queryByTestId("packet-analyzer-drawer")).not.toBeInTheDocument();
    expect(params().has("analyze")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Live packet A" }));
    fireEvent.click(screen.getByRole("button", { name: "Map tab" }));
    expect(screen.getByTestId("packet-analyzer-drawer")).toHaveTextContent("aa11");
    expect(params().get("analyze")).toBe("1");
  });

  it("keeps the desktop-only Map sidebar hidden on mobile deep links", async () => {
    state.mobile = true;
    window.history.replaceState({}, "", "/?tab=Map&flow=on&hash=aa11&analyze=1");
    render(<App />);
    await screen.findByRole("region", { name: "Map view" });
    expect(screen.queryByTestId("packet-analyzer-drawer")).not.toBeInTheDocument();
  });
});
