import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Timestamp } from "../../src/components/Timestamp";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Timestamp", () => {
  it("shows relative text, revealing the absolute time on hover (instant tooltip)", () => {
    const fiveMinAgo = Date.now() - 5 * 60_000;
    render(<Timestamp value={fiveMinAgo} />);
    const el = screen.getByText("5m ago");
    expect(el).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(); // hidden until hover

    fireEvent.mouseEnter(el);
    expect(screen.getByRole("tooltip").textContent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("renders the absolute string in absolute mode, relative on hover", () => {
    render(<Timestamp value={1717689045123} mode="absolute" />);
    const el = screen.getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    fireEvent.mouseEnter(el);
    expect(screen.getByRole("tooltip").textContent).toMatch(/ago$/);
  });

  it("includes milliseconds when ms is set", () => {
    render(<Timestamp value={1717689045123} mode="absolute" ms />);
    expect(screen.getByText(/\.123$/)).toBeInTheDocument();
  });

  it("updates an open relative tooltip without changing the absolute value or milliseconds", async () => {
    vi.useFakeTimers();
    const value = new Date(2026, 8, 25, 12, 34, 56, 123).getTime();
    vi.setSystemTime(value + 5 * 60_000);
    render(<Timestamp value={value} mode="absolute" ms className="timestamp-label" />);
    const label = screen.getByText("2026-09-25 12:34:56.123");
    expect(label).toHaveClass("timestamp-label");
    fireEvent.mouseEnter(label);
    expect(screen.getByRole("tooltip")).toHaveTextContent("5m ago");

    expect(screen.getByText("2026-09-25 12:34:56.123")).toBe(label);
    expect(label).toHaveClass("timestamp-label");
  });

  it("keeps one shared timer for many timestamps and releases it on unmount", () => {
    // Count polling intervals without counting React's asynchronous scheduling.
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
    const value = Date.now() - 60_000;
    const { unmount } = render(<>{Array.from({ length: 100 }, (_, id) => <Timestamp key={id} value={value} />)}</>);
    expect(screen.getAllByText("1m ago")).toHaveLength(100);
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getAllByText("2m ago")).toHaveLength(100);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
