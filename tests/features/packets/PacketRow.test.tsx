import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PacketRow } from "../../../src/features/packets/PacketRow";

import type { PacketListItem } from "../../../src/features/packets/types";

const pkt = (over: Partial<PacketListItem> = {}): PacketListItem => ({
  packetHash: "AA11", payloadType: 1, payloadTypeName: "ADVERT",
  routeType: 1, routeTypeName: "FLOOD",
  firstHeardAt: 1700000000, lastHeardAt: 1700000002, observationCount: 2, ...over,
});

const tokens = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

describe("PacketRow", () => {
  it("shows the decoded sender and text in place of the summary on mobile", () => {
    const onToggle = vi.fn();
    render(<PacketRow packet={pkt({ summary: "Encoded summary", message: { senderName: "Alice", content: "Hello from the mesh" } })} expanded={false} onToggle={onToggle} />);
    expect(screen.getByText("Alice:")).toBeInTheDocument();
    expect(screen.getByText("Hello from the mesh")).toHaveClass("truncate");
    expect(screen.queryByText("Encoded summary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Hello from the mesh"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it.each([undefined, { senderName: "Alice", content: "" }, { senderName: "Alice", content: " \n\t " }])("retains the summary without decoded content (%j)", (message) => {
    render(<PacketRow packet={pkt({ summary: "Packet summary", message })} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText("Packet summary")).toBeInTheDocument();
    expect(screen.queryByText("Alice:")).not.toBeInTheDocument();
  });

  it("renders decoded markup as text and toggles from the keyboard", () => {
    const content = "<b>Mesh message</b>";
    const onToggle = vi.fn();
    const { container } = render(<PacketRow packet={pkt({ message: { senderName: "Alice", content } })} expanded={false} onToggle={onToggle} />);
    expect(screen.getByText(content)).toHaveAttribute("title", content);
    expect(container.querySelector("b")).toBeNull();
    fireEvent.keyDown(container.firstElementChild!, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledOnce();
  });

  // expanded card loses its bottom radius so the expansion below reads as the same card unfolding
  it("squares its bottom corners while expanded", () => {
    const { container } = render(<PacketRow packet={pkt()} expanded onToggle={() => {}} />);
    expect(tokens(container.firstElementChild!)).toContain("rounded-b-none");
  });

  it("keeps rounded corners while collapsed", () => {
    const { container } = render(<PacketRow packet={pkt()} expanded={false} onToggle={() => {}} />);
    expect(tokens(container.firstElementChild!)).not.toContain("rounded-b-none");
  });

  it("toggles on click", () => {
    const onToggle = vi.fn();
    render(<PacketRow packet={pkt()} expanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByText("AA11"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
