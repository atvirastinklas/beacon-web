import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PacketHeader } from "../../../src/features/meshlog/PacketHeader";
import type { MeshlogLiveState } from "../../../src/features/meshlog/types";
import i18n from "../../../src/i18n";

const state: MeshlogLiveState = {
  status: "connected", loading: true, error: false, gap: false, emptyRegion: false, regionLabel: "All Regions", onRetry: () => {},
  historyLoading: false, historyError: false, hasOlder: false, loadingOlder: false, loadOlder: () => {}, retryHistory: () => {},
};

describe("compact packet header", () => {
  it("shows only navigation, the shared live badge and language while directory metadata loads", () => {
    const view = render(<PacketHeader liveState={state} />);
    const back = screen.getByRole("link", { name: "Back to Beacon" });
    expect(back).toHaveAttribute("href", "/");
    expect(back.textContent).toBe("");
    expect(back.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("heading", { level: 1, name: "MeshLog" }).parentElement).toContainElement(back);
    expect(screen.queryByText("Beacon")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "LIVE" })).toHaveAttribute("data-slot", "live-badge");
    expect(screen.getByRole("button", { name: "Language: English" })).toBeInTheDocument();
    expect(screen.queryByText("All Regions")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading… · Nodes / Observers")).not.toBeInTheDocument();
    expect(view.container.querySelector(".meshlog-live-state")).not.toBeInTheDocument();
  });

  it("localizes the icon-only home link and its keyboard-focus tooltip", async () => {
    render(<PacketHeader liveState={state} />);
    await act(() => i18n.changeLanguage("lt"));
    const back = screen.getByRole("link", { name: "Grįžti į Beacon" });
    expect(back).toHaveAttribute("href", "/");
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => back.focus());
    expect(back).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Grįžti į Beacon");
  });

  it("keeps recoverable failures and missing-history notices without an empty status strip", () => {
    const retry = vi.fn();
    const view = render(<PacketHeader liveState={{ ...state, loading: false, error: true, gap: true, onRetry: retry }} />);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    const button = screen.getByRole("button", { name: "Retry" });
    expect(button.closest(".meshlog-brand")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    expect(view.container.querySelector(".meshlog-live-state button")).toBeNull();
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<PacketHeader liveState={{ ...state, loading: true, error: true, onRetry: retry }} />);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<PacketHeader liveState={{ ...state, loading: false }} />);
    expect(view.container.querySelector(".meshlog-live-state")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("provides a keyboard-focus tooltip for the compact retry action", async () => {
    render(<PacketHeader liveState={{ ...state, loading: false, error: true }} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => retry.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Retry");
  });
});
