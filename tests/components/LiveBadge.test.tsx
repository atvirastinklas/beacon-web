import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveBadge } from "../../src/components/LiveBadge";
import i18n from "../../src/i18n";

afterEach(() => vi.useRealTimers());

describe("shared live connection badge", () => {
  it("uses the same accessible live state for the full pill and compact dot", () => {
    const view = render(<LiveBadge status="connected" />);
    const full = screen.getByRole("status", { name: "LIVE" });
    expect(full).toHaveAttribute("data-slot", "live-badge");
    expect(full).toHaveAttribute("data-status", "connected");
    expect(full).toHaveTextContent("LIVE");
    expect(full.querySelector(".animate-pulse")).toHaveClass("motion-reduce:animate-none");
    view.rerender(<LiveBadge status="connected" compact />);
    expect(screen.getByRole("status", { name: "LIVE" })).not.toHaveTextContent("LIVE");
  });

  it("ages a real last-event timestamp while reconnecting and cleans up its timer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    const timestamp = Date.now() - 59_000;
    const view = render(<LiveBadge status="connecting" lastEventTimestamp={timestamp} />);
    expect(screen.getByRole("status")).toHaveTextContent(i18n.t("connection.stale", { age: i18n.t("timestamp.unit.s", { count: 59 }) }));
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("status")).toHaveTextContent(i18n.t("connection.stale", { age: i18n.t("timestamp.unit.m", { count: 1 }) }));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never invents an age or live state when resolving, connecting without a timestamp, or offline", () => {
    const view = render(<LiveBadge status="resolving" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading region…");
    view.rerender(<LiveBadge status="connecting" />);
    expect(screen.getByRole("status")).toHaveTextContent("Connecting…");
    expect(screen.queryByText(/STALE/)).not.toBeInTheDocument();
    view.rerender(<LiveBadge status="error" />);
    expect(screen.getByRole("status", { name: "OFFLINE" })).toBeInTheDocument();
  });
});
