import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { App } from "../src/App";

const state = vi.hoisted(() => ({ mobile: false, mapMounts: 0 }));
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
    {children}
  </>,
}));
vi.mock("../src/features/map/MapView", () => ({ MapView: ({ onAnalyzePacket, onSelectNode }: {
  onAnalyzePacket: (hash: string) => void; onSelectNode: (id: string) => void;
}) => {
  const [mount] = useState(() => ++state.mapMounts);
  return <section aria-label="Map view">
    <output data-testid="map-mount">{mount}</output>
    <button onClick={() => onAnalyzePacket("aa11")}>Live packet A</button>
    <button onClick={() => onAnalyzePacket("bb22")}>Live packet B</button>
    <button onClick={() => onSelectNode("new-node")}>Visible map node</button>
  </section>;
} }));
vi.mock("../src/features/packets/PacketList", () => ({ PacketList: () => <p>Packets view</p> }));
vi.mock("../src/features/nodes/NodeDetailPanel", () => ({ NodeDetailPanel: ({ nodeId }: { nodeId: string }) => <section aria-label={`Node ${nodeId}`} /> }));
vi.mock("../src/features/InvestigationPanels", () => ({ InvestigationPanel: () => <section role="dialog" aria-label="Path investigation" /> }));
vi.mock("../src/features/packets/usePacketDetail", () => ({
  usePacketDetail: (hash: string | null) => ({ data: hash ? { packetHash: hash, observations: [], header: { payloadType: 4 } } : undefined, isLoading: false }),
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
beforeEach(() => { state.mobile = false; state.mapMounts = 0; });

describe("live Map packet sidebar", () => {
  it("opens the existing sidebar without leaving/remounting Map or changing its view parameters", async () => {
    window.history.replaceState({}, "", "/?tab=Map&flow=on&lat=55&lng=25&zoom=13&clustering=off&iata=VNO");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Live packet A" }));
    expect(screen.getByTestId("packet-analyzer-drawer")).toHaveTextContent("aa11");
    expect(screen.getByTestId("active-tab")).toHaveTextContent("Map");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(params().get("analyze")).toBe("1");
    for (const [key, value] of [["tab", "Map"], ["flow", "on"], ["lat", "55"], ["lng", "25"], ["zoom", "13"], ["clustering", "off"], ["iata", "VNO"]]) {
      expect(params().get(key!)).toBe(value);
    }
    fireEvent.click(screen.getByRole("button", { name: "Live packet B" }));
    expect(screen.getByTestId("packet-analyzer-drawer")).toHaveTextContent("bb22");
    fireEvent.click(screen.getByRole("button", { name: "Close packet sidebar" }));
    expect(screen.queryByTestId("packet-analyzer-drawer")).not.toBeInTheDocument();
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
