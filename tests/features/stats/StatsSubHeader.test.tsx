import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StatsSubHeader } from "../../../src/features/stats/StatsSubHeader";

afterEach(() => vi.restoreAllMocks());

describe("analytics controls", () => {
  it("keeps archived ranges and exposes no Observer section", () => {
    const props = { onTabChange: vi.fn(), onRangeChange: vi.fn() };
    render(<StatsSubHeader {...props} tab="mesh" range="7d" />);
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "3d" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30d" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Observer", exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(props.onRangeChange).toHaveBeenCalledWith("7d");
  });

  it("uses canonical mobile choices and hides ranges for clock drift", () => {
    const media = window.matchMedia("(max-width: 767px)");
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ ...media, media: query, matches: query === "(max-width: 767px)" }));
    const onTabChange = vi.fn(), onRangeChange = vi.fn();
    const { rerender } = render(<StatsSubHeader tab="signal" range="24h" onTabChange={onTabChange} onRangeChange={onRangeChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Section/ }));
    fireEvent.click(screen.getByRole("option", { name: "Clock drift" }));
    expect(onTabChange).toHaveBeenCalledWith("clockdrift");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    rerender(<StatsSubHeader tab="clockdrift" range="24h" onTabChange={onTabChange} onRangeChange={onRangeChange} />);
    expect(screen.queryByRole("group", { name: "Time range" })).not.toBeInTheDocument();
    expect(onRangeChange).not.toHaveBeenCalled();
  });
});
