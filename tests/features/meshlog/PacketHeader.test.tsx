import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PacketHeader } from "../../../src/features/meshlog/PacketHeader";
import type { MeshlogLiveState } from "../../../src/features/meshlog/types";
import i18n from "../../../src/i18n";

const state: MeshlogLiveState = {
  status: "connected", loading: true, error: false, gap: false, emptyRegion: false, regionLabel: "All Regions", onRetry: () => {},
  historyLoading: false, historyError: false, hasOlder: false, loadingOlder: false, loadOlder: () => {}, retryHistory: () => {},
  refreshHistory: () => {}, historyRefreshing: false,
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
    expect(screen.getByRole("button", { name: "Refresh packets" }).closest(".meshlog-live-state")).not.toBeNull();
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

  it("refreshes loaded history from the gap warning, prevents duplicate requests and keeps the warning after completion", () => {
    const refreshHistory = vi.fn(), retry = vi.fn();
    const liveState = { ...state, loading: false, gap: true, refreshHistory, onRetry: retry };
    const view = render(<PacketHeader liveState={liveState} />);
    const button = screen.getByRole("button", { name: "Refresh packets" });
    expect(screen.getByRole("alert")).toHaveTextContent("Packets · Data unavailable");
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    fireEvent.click(button);
    expect(refreshHistory).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    view.rerender(<PacketHeader liveState={{ ...liveState, historyRefreshing: true }} />);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector("svg")).toHaveClass("animate-spin", "motion-reduce:animate-none");
    fireEvent.click(button);
    expect(refreshHistory).toHaveBeenCalledOnce();
    view.rerender(<PacketHeader liveState={liveState} />);
    expect(button).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Packets · Data unavailable");
    view.rerender(<PacketHeader liveState={{ ...liveState, gap: false }} />);
    expect(screen.queryByRole("button", { name: "Refresh packets" })).not.toBeInTheDocument();
  });

  it("labels the refresh action and its keyboard tooltip in Lithuanian", async () => {
    render(<PacketHeader liveState={{ ...state, gap: true }} />);
    await act(async () => { await i18n.changeLanguage("lt"); });
    const button = screen.getByRole("button", { name: "Atnaujinti paketus" });
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => button.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Atnaujinti įkeltus paketus nekeičiant filtrų.");
  });

  it("provides a keyboard-focus tooltip for the compact retry action", async () => {
    render(<PacketHeader liveState={{ ...state, loading: false, error: true }} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => retry.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Retry");
  });
});
