import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContactRow } from "../../../src/features/meshlog/Rows";
import type { MeshlogContact } from "../../../src/features/meshlog/types";
import { liveNode, liveNodeDetail } from "./live-fixtures";
import { formatRadio } from "../../../src/lib/formatters";
import { DEFAULT_CONTACT_SETTINGS, meshlogContactState } from "../../../src/features/meshlog/contact-settings";

vi.mock("../../../src/components/Timestamp", () => ({ Timestamp: ({ value }: { value: number }) => <time dateTime={String(value)}>{value}</time> }));
const contact: MeshlogContact = { id: liveNode.id, name: liveNode.name!, publicKey: liveNode.publicKey, kind: "client", position: [24.087, 56.943], heard: "10:23:52", firstSeen: "—", node: liveNode };

describe("truthful Meshlog contact details", () => {
  it("shows textual age and measured drift warnings without changing the server clock verdict", () => {
    const now = Date.now();
    const detail = { ...liveNodeDetail(liveNode), clockDriftSeconds: 31 * 60, clockOutOfSync: false };
    const stale = { ...contact, heardAt: now - 10 * 86_400_000, detail };
    const state = meshlogContactState(stale, DEFAULT_CONTACT_SETTINGS, now);
    const view = render(<ContactRow contact={stale} display={DEFAULT_CONTACT_SETTINGS} state={state} />);
    const trigger = screen.getByRole("button", { name: "Node Detail: Live Walker" });
    expect(trigger.closest(".meshlog-row")).toHaveAttribute("data-age", "veryExpired");
    expect(screen.getByText("Very expired")).toBeInTheDocument();
    expect(trigger.querySelector(".meshlog-clock-warning")).toHaveTextContent("Clock drift");
    expect(detail.clockOutOfSync).toBe(false);
    view.rerender(<ContactRow contact={stale} display={{ ...DEFAULT_CONTACT_SETTINGS, timeWarnings: false }} state={state} />);
    expect(trigger.closest(".meshlog-row")).not.toHaveAttribute("data-age");
    expect(screen.queryByText("Very expired")).not.toBeInTheDocument();
    expect(trigger.querySelector(".meshlog-clock-warning")).toBeNull();
    expect(detail.clockOutOfSync).toBe(false);
  });
  it.each(["companion", "repeater", "room_server", "sensor"])("uses the existing %s observer asset regardless of backend casing", type => {
    render(<ContactRow contact={{ ...contact, node: { ...liveNode, nodeTypeName: type.toUpperCase(), isObserver: true } }} display={{ locationWarnings: true }} />);
    const icon = screen.getByRole("img");
    expect(icon).toHaveAttribute("data-node-type", type);
    expect(icon).toHaveAttribute("data-observer", "true");
    expect(icon.querySelector("img")).not.toBeNull();
  });

  it("keeps a future canonical node type unknown instead of borrowing a client glyph", () => {
    render(<ContactRow contact={{ ...contact, node: { ...liveNode, nodeTypeName: "Future type" } }} display={{ locationWarnings: true }} />);
    const icon = screen.getByRole("img", { name: "Unknown" });
    expect(icon).toHaveAttribute("data-node-type", "unknown");
    expect(icon.querySelector("img")).toBeNull();
  });

  it("uses the existing role asset and inspects only on expansion", () => {
    const inspect = vi.fn();
    render(<ContactRow contact={contact} display={{ locationWarnings: true }} onInspect={inspect} />);
    expect(screen.getByRole("img", { name: "Companion" })).toHaveAttribute("data-node-type", "companion");
    expect(screen.getByRole("img", { name: "Companion" }).querySelector("img")).toHaveAttribute("src", expect.stringContaining("data:image/svg+xml"));
    expect(inspect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Node Detail: Live Walker" }));
    expect(inspect).toHaveBeenCalledOnce();
    expect(screen.getByText("Data unavailable")).toBeInTheDocument();
  });

  it("renders actual detail timestamps, capabilities, radio, scope and neighbors without invented battery/interval", () => {
    const detail = liveNodeDetail();
    render(<ContactRow contact={{ ...contact, node: detail, detail, interval: "fake interval", battery: "fake battery" }} display={{ locationWarnings: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "Node Detail: Live Walker" }));
    expect(screen.getByText(formatRadio(detail.radio)!)).toBeInTheDocument();
    expect(screen.getByText(detail.defaultScope!)).toBeInTheDocument();
    expect(screen.getByText("56.94300, 24.08700")).toBeInTheDocument();
    expect(screen.getByText(String(detail.firstSeen), { selector: "time" })).toBeInTheDocument();
    expect(screen.getByText(String(detail.lastSeen), { selector: "time" })).toBeInTheDocument();
    expect(screen.getByText(String(detail.knownNeighborCount), { selector: "dd" })).toBeInTheDocument();
    expect(screen.queryByText("fake interval")).not.toBeInTheDocument();
    expect(screen.queryByText("fake battery")).not.toBeInTheDocument();
  });

  it("announces lazy loading and offers an explicit local retry", () => {
    const retry = vi.fn();
    const view = render(<ContactRow contact={{ ...contact, detailLoading: true }} display={{ locationWarnings: true }} onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Node Detail: Live Walker" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    view.rerender(<ContactRow contact={{ ...contact, detailError: true }} display={{ locationWarnings: true }} onRetry={retry} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry · Live Walker" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
