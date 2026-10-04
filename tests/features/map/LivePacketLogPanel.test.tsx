import type { ComponentProps } from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { LivePacketLogPanel as PacketPanel } from "../../../src/features/map/LivePacketLogPanel";
import type { LivePacketLogEntry } from "../../../src/features/map/useLivePacketLog";
import type { WsStatus } from "../../../src/api/ws-manager";

const analyze = vi.fn();
function LivePacketLogPanel(props: Omit<ComponentProps<typeof PacketPanel>, "onAnalyzePacket">) {
  return <PacketPanel {...props} onAnalyzePacket={analyze} />;
}
function entry(id: number, summary = `Observation ${id}`): LivePacketLogEntry {
  return { id, seenCount: 1, firstReceivedAt: id, lastReceivedAt: id, data: { packetHash: String(id).padStart(64, "0"), packet: { payloadType: 4, payloadTypeName: "Advert", routeType: 1, routeTypeName: "Flood", isFirstObservation: true, observationCount: 1, summary }, observation: { observerId: "observer", observerName: "Observer name", iata: "VNO", heardAt: 1_700_000_000_000 + id, rssi: -70, snr: 8, sourceBroker: "test", pathLength: { hopCount: 2, hashSize: 1, raw: "02" } } } };
}
beforeEach(() => analyze.mockClear());

describe("desktop Live packets panel", () => {
  it("is expanded by default with a visible waiting state and accessible outer collapse control", () => {
    render(<LivePacketLogPanel entries={[]} status="connected" />);
    const region = screen.getByRole("region", { name: "Live packets" });
    const trigger = within(region).getByRole("button", { name: "Live packets" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Waiting for packets…")).toBeVisible();
    expect(screen.getByText("Listening for packet observations in the selected region.")).toBeVisible();
    const contentId = trigger.getAttribute("aria-controls")!;
    expect(document.getElementById(contentId)).toBeVisible();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", contentId);
    expect(screen.queryByText("Waiting for packets…")).not.toBeInTheDocument();
    expect(region.querySelector("[aria-live], [role=log]")).toBeNull();
  });

  it("retains newest-first compact rows received while collapsed without adding inline details", () => {
    const { rerender } = render(<LivePacketLogPanel entries={[entry(1)]} status="connected" />);
    const trigger = screen.getByRole("button", { name: "Live packets" });
    fireEvent.click(trigger);
    rerender(<LivePacketLogPanel entries={[entry(3), entry(2), entry(1)]} status="connected" />);
    expect(screen.getByText("3/100")).toBeVisible();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.click(trigger);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Observation 3");
    expect(rows[1]).toHaveTextContent("Observation 2");
    expect(rows[2]).toHaveTextContent("Observation 1");
    expect(rows[0]).toHaveTextContent("VNO");
    expect(rows[0]).toHaveTextContent("ADVERT");
    expect(rows[0]).toHaveTextContent("FLOOD");
    expect(rows[0]).toHaveTextContent("2h");
    fireEvent.click(within(rows[0]).getByRole("button", { name: /Packet details:/ }));
    expect(analyze).toHaveBeenCalledExactlyOnceWith(entry(3).data.packetHash);
    expect(rows[0].querySelector("dl, [data-state]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close packet details" })).not.toBeInTheDocument();
  });

  it.each(["connecting", "disconnected", "error"] as WsStatus[])("makes %s connectivity visible without hiding retained rows", status => {
    const { rerender } = render(<LivePacketLogPanel entries={[]} status={status} />);
    expect(screen.getByText("Waiting for the packet stream…")).toBeVisible();
    expect(screen.getByText(status === "connecting" ? "Connecting…" : "OFFLINE")).toBeVisible();
    rerender(<LivePacketLogPanel entries={[entry(1)]} status={status} />);
    expect(screen.getByText("Observation 1")).toBeVisible();
  });

  it("shows pending-region state and safe previews without inventing ambiguous endpoints", () => {
    const first = entry(1, "<img src=x onerror=alert(1)>");
    const unsafeName = "<script>alert(1)</script>";
    first.data.observation.resolvedSource = { confidence: "high", nodes: [{ id: "source", name: unsafeName, publicKey: "a" }] };
    first.data.observation.resolvedDestination = { confidence: "high", nodes: [{ id: "destination", name: "Destination", publicKey: "b" }] };
    const { rerender, container } = render(<LivePacketLogPanel entries={[]} status="connected" regionPending />);
    expect(screen.getByText("Loading region…")).toBeVisible();
    rerender(<LivePacketLogPanel entries={[first]} status="connected" />);
    expect(screen.getByText(`${unsafeName} → Destination`)).toBeVisible();
    expect(container.querySelector("script, img")).toBeNull();
    first.data.observation.resolvedSource = { confidence: "ambiguous", nodes: [{ id: "source", name: "Ambiguous candidate", publicKey: "a" }] };
    first.data.observation.resolvedDestination = null;
    rerender(<LivePacketLogPanel entries={[{ ...first }]} status="connected" />);
    expect(screen.queryByText("Ambiguous candidate")).not.toBeInTheDocument();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
  });

  it("uses Beacon colors and local sightings, and activates the packet sidebar callback without expansion", () => {
    const first = entry(1);
    first.seenCount = 3;
    first.data.packet.observationCount = 91;
    const second = entry(2);
    second.data.packet.payloadType = 5;
    render(<LivePacketLogPanel entries={[first, second]} status="connected" />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("ADVERT")).toHaveClass("text-green");
    expect(within(rows[1]).getByText("GRP_TXT")).toHaveClass("text-secondary");
    const row = within(rows[0]).getByRole("button", { name: /Packet details:/ });
    expect(row.tagName).toBe("BUTTON");
    expect(row).toHaveAttribute("type", "button");
    expect(row).toHaveClass("border-l-current", "bg-green/8");
    expect(row).not.toHaveAttribute("aria-expanded");
    expect(screen.getByLabelText("3 sightings in this feed")).toHaveTextContent("×3");
    row.focus();
    fireEvent.click(row);
    expect(analyze).toHaveBeenCalledExactlyOnceWith(first.data.packetHash);
    expect(row).toHaveFocus();
    expect(rows[0].querySelector("button button, dl")).toBeNull();
    expect(screen.queryByText("Server observations")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("uses the current packet callback after reordering and reset, with no latched per-row detail state", () => {
    const first = entry(1);
    const second = entry(2);
    second.data.observation.pathLength = undefined;
    const { rerender } = render(<LivePacketLogPanel entries={[first, second]} status="connected" />);
    fireEvent.click(screen.getByRole("button", { name: "Packet details: ADVERT · Observation 1" }));
    first.seenCount = 2;
    rerender(<LivePacketLogPanel entries={[second, { ...first }]} status="connected" />);
    expect(screen.getByLabelText("2 sightings in this feed")).toBeVisible();
    expect(screen.getByLabelText("Hop count unavailable")).toHaveTextContent("—h");
    rerender(<LivePacketLogPanel entries={[]} status="connected" />);
    const fresh = entry(1, "New session packet");
    fresh.data.packetHash = "fresh-hash";
    rerender(<LivePacketLogPanel entries={[fresh]} status="connected" />);
    fireEvent.click(screen.getByRole("button", { name: "Packet details: ADVERT · New session packet" }));
    expect(analyze.mock.calls).toEqual([[first.data.packetHash], ["fresh-hash"]]);
    expect(screen.queryByRole("button", { name: "Close packet details" })).not.toBeInTheDocument();
  });
});
