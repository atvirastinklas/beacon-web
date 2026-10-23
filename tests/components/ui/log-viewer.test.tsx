import "./mock-number-flow";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockResizeObserver } from "./mock-resize-observer";
import { formatLogTime, LogViewer, type LogLine } from "../../../src/components/ui/log-viewer";

const lines: LogLine[] = [
  { id: 1, time: 1_700_000_000_000, level: "info", message: "Packet received", source: "VNO" },
  { id: 2, time: 1_700_000_001_000, level: "warn", message: "Packet delayed", source: "KUN" },
  { id: 3, time: 1_700_000_002_000, level: "error", message: "Connection lost", source: "VNO" },
];

function scrollGeometry(log: HTMLElement) {
  let top = 0;
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, value: 1_000 },
    clientHeight: { configurable: true, value: 100 },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.max(0, Math.min(900, value)); } },
  });
}

describe("LogViewer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows the tail on viewport resize, but leaves a paused reading position and follow mode alone", () => {
    const notifyResize = mockResizeObserver();
    const onFollowChange = vi.fn();
    const { unmount } = render(<LogViewer lines={lines} height="100%" onFollowChange={onFollowChange} />);
    const log = screen.getByRole("log");
    let viewportHeight = 100;
    let contentHeight = 1_000;
    let top = 0;
    Object.defineProperties(log, {
      scrollHeight: { get: () => contentHeight },
      clientHeight: { get: () => viewportHeight },
      scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(contentHeight - viewportHeight, value)); } },
    });
    notifyResize(log);
    expect(log.scrollTop).toBe(900);
    viewportHeight = 300;
    notifyResize(log);
    expect(log.scrollTop).toBe(700);
    fireEvent.scroll(log);
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "true");
    viewportHeight = 150;
    notifyResize(log);
    expect(log.scrollTop).toBe(850);
    // A width change can increase wrapped content height without a new packet.
    contentHeight = 1_400;
    notifyResize(log);
    expect(log.scrollTop).toBe(1_250);
    fireEvent.scroll(log, { target: { scrollTop: 250 } });
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
    viewportHeight = 400;
    notifyResize(log);
    expect(log.scrollTop).toBe(250);
    fireEvent.scroll(log);
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
    expect(onFollowChange.mock.calls).toEqual([[false]]);
    unmount();
    notifyResize(log);
    expect(log.scrollTop).toBe(250);
  });

  it("follows new arrivals, pauses when scrolled up, and resumes with End or by scrolling back to the end", () => {
    const onFollowChange = vi.fn();
    const { rerender } = render(<LogViewer lines={[lines[0]]} onFollowChange={onFollowChange} />);
    const log = screen.getByRole("log");
    scrollGeometry(log);
    rerender(<LogViewer lines={lines.slice(0, 2)} onFollowChange={onFollowChange} />);
    expect(log.scrollTop).toBe(900);
    fireEvent.scroll(log, { target: { scrollTop: 500 } });
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
    rerender(<LogViewer lines={lines} onFollowChange={onFollowChange} />);
    expect(log.scrollTop).toBe(500);
    expect(screen.getByRole("button", { name: "1 new line" })).toBeInTheDocument();
    log.focus();
    fireEvent.keyDown(log, { key: "End" });
    expect(log.scrollTop).toBe(900);
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "true");
    expect(log).toHaveFocus();
    fireEvent.scroll(log, { target: { scrollTop: 400 } });
    fireEvent.scroll(log, { target: { scrollTop: 900 } });
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "true");
    expect(onFollowChange.mock.calls).toEqual([[false], [true], [false], [true]]);
    fireEvent.keyDown(log, { key: "/" });
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it.each([{ defaultFollow: false }, { follow: false }])("counts arrivals from an initially paused viewer, even after cap eviction: %j", props => {
    const { rerender } = render(<LogViewer lines={[lines[0]]} {...props} />);
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();
    rerender(<LogViewer lines={[lines[1], lines[2]]} {...props} />);
    expect(screen.getByRole("button", { name: "2 new lines" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lost" } });
    expect(screen.getByRole("button", { name: "2 new lines" })).toBeInTheDocument();
    rerender(<LogViewer lines={[{ ...lines[1], message: "Enriched packet" }, lines[2]]} {...props} />);
    expect(screen.getByRole("button", { name: "2 new lines" })).toBeInTheDocument();
  });

  it("keeps the tail visible when an existing line gains content, not just when IDs change", () => {
    const { rerender } = render(<LogViewer lines={[lines[0]]} />);
    const log = screen.getByRole("log");
    scrollGeometry(log);
    rerender(<LogViewer lines={[{ ...lines[0], message: "Enriched content" }]} />);
    expect(log.scrollTop).toBe(900);
  });

  it("retains unseen counts across repeated full-buffer eviction while manually paused", () => {
    const batch = (start: number) => Array.from({ length: 100 }, (_, index): LogLine => ({ ...lines[0], id: start + index }));
    const { rerender } = render(<LogViewer lines={batch(1)} />);
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    rerender(<LogViewer lines={batch(101)} />);
    expect(screen.getByRole("button", { name: "100 new lines" })).toBeInTheDocument();
    rerender(<LogViewer lines={batch(201)} />);
    expect(screen.getByRole("button", { name: "200 new lines" })).toBeInTheDocument();
    expect(within(screen.getByRole("log")).getAllByRole("listitem")).toHaveLength(100);
    fireEvent.click(screen.getByRole("button", { name: "200 new lines" }));
    expect(screen.getByRole("log")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "true");
  });

  it("honors controlled props and only requests changes until the caller accepts them", () => {
    const onQueryChange = vi.fn();
    const onLevelsChange = vi.fn();
    const onWrapChange = vi.fn();
    const onFollowChange = vi.fn();
    const props = { query: "packet", levels: ["info", "warn"] as LogLine["level"][], wrap: false, follow: false,
      onQueryChange, onLevelsChange, onWrapChange, onFollowChange };
    const { rerender } = render(<LogViewer lines={lines} {...props} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lost" } });
    expect(onQueryChange).toHaveBeenLastCalledWith("lost");
    expect(screen.getByRole("searchbox")).toHaveValue("packet");
    fireEvent.click(screen.getByRole("button", { name: "Warn, 1 line" }));
    expect(onLevelsChange).toHaveBeenLastCalledWith(["info"]);
    expect(screen.getByRole("button", { name: "Warn, 1 line" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Wrap lines" }));
    expect(onWrapChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("button", { name: "Wrap lines" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(onFollowChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
    rerender(<LogViewer lines={lines} {...props} query="lost" levels={["error"]} wrap follow />);
    expect(screen.getByRole("searchbox")).toHaveValue("lost");
    expect(screen.getByRole("button", { name: "Wrap lines" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("log")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("log")).toHaveTextContent("Connection lost");
  });

  it("starts a fresh count when externally paused, resumed, and paused again", () => {
    const { rerender } = render(<LogViewer lines={lines.slice(0, 1)} follow />);
    rerender(<LogViewer lines={lines.slice(0, 1)} follow={false} />);
    rerender(<LogViewer lines={lines.slice(0, 2)} follow={false} />);
    expect(screen.getByRole("button", { name: "1 new line" })).toBeInTheDocument();
    rerender(<LogViewer lines={lines.slice(0, 2)} follow />);
    rerender(<LogViewer lines={lines.slice(0, 2)} follow={false} />);
    rerender(<LogViewer lines={lines} follow={false} />);
    expect(screen.getByRole("button", { name: "1 new line" })).toBeInTheDocument();
    rerender(<LogViewer lines={[]} follow={false} />);
    rerender(<LogViewer lines={[lines[0]]} follow={false} />);
    expect(screen.getByRole("button", { name: "1 new line" })).toBeInTheDocument();
  });

  it("supports uncontrolled defaults, search clear/Escape, source search, and wrap toggling", () => {
    render(<LogViewer lines={lines} defaultQuery="vno" defaultWrap defaultLevels={["info"]} />);
    expect(screen.getByRole("searchbox")).toHaveValue("vno");
    expect(within(screen.getByRole("log")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("log").querySelector("mark")).toHaveTextContent("VNO");
    expect(screen.getByRole("button", { name: "Wrap lines" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Wrap lines" }));
    expect(screen.getByRole("button", { name: "Wrap lines" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("searchbox")).toHaveFocus();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "anything" } });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(screen.getByRole("searchbox")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Info, 1 line" }));
    expect(screen.getByRole("log")).toHaveTextContent("No lines at these levels");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(within(screen.getByRole("log")).getAllByRole("listitem")).toHaveLength(3);
  });

  it("distinguishes loading, waiting, and empty states and accepts a custom timestamp formatter", () => {
    const { rerender, container } = render(<LogViewer lines={[]} loading />);
    expect(container.querySelector('[data-slot="log-viewer"]')).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading logs…")).toBeInTheDocument();
    rerender(<LogViewer lines={[]} streaming />);
    expect(screen.getByText("Waiting for logs…")).toBeVisible();
    expect(container.querySelector('[data-slot="log-viewer"]')).not.toHaveAttribute("aria-busy");
    rerender(<LogViewer lines={[]} />);
    expect(screen.getByText("No logs yet")).toBeVisible();
    rerender(<LogViewer lines={[lines[0]]} formatTime={() => "custom time"} />);
    expect(screen.getByText("custom time")).toBeVisible();
    expect(formatLogTime("invalid timestamp")).toBe("--:--:--.---");
    expect(formatLogTime(new Date(2026, 0, 1, 14, 3, 12, 408))).toBe("14:03:12.408");
  });

  it("combines literal search and multi-level filters, highlights matches, and recovers from no matches", () => {
    render(<LogViewer lines={lines} />);
    const log = screen.getByRole("log", { name: "Logs" });
    expect(log).toHaveAttribute("aria-live", "off");
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter Logs" }), { target: { value: "packet" } });
    expect(within(log).getAllByRole("listitem")).toHaveLength(2);
    expect(log.querySelectorAll("mark")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Info, 1 line" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Info, 1 line" }));
    expect(within(log).getAllByRole("listitem")).toHaveLength(1);
    expect(log).toHaveTextContent("Packet delayed");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "[no match]" } });
    expect(log).toHaveTextContent("No lines match “[no match]”");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(within(log).getAllByRole("listitem")).toHaveLength(3);
  });
});
