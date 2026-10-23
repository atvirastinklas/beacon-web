import "../../components/ui/mock-number-flow";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LivePacketLogPanel as PacketPanel } from "../../../src/features/map/LivePacketLogPanel";
import type { LivePacketLogEntry } from "../../../src/features/map/useLivePacketLog";
import type { WsStatus } from "../../../src/api/ws-manager";
import i18n from "../../../src/i18n";
import { mockResizeObserver } from "../../components/ui/mock-resize-observer";

const analyze = vi.fn();
function LivePacketLogPanel(props: Omit<ComponentProps<typeof PacketPanel>, "onAnalyzePacket">) {
  return <PacketPanel {...props} onAnalyzePacket={analyze} />;
}
function entry(id: number, summary = `Observation ${id}`): LivePacketLogEntry {
  return { id, seenCount: 1, firstHeardAt: 1_700_000_000_000 + id, firstReceivedAt: id, lastReceivedAt: id, data: { packetHash: String(id).padStart(64, "0"), packet: { payloadType: 4, payloadTypeName: "Advert", routeType: 1, routeTypeName: "Flood", isFirstObservation: true, observationCount: 1, summary }, observation: { observerId: "observer", observerName: "Observer name", iata: "VNO", heardAt: 1_700_000_000_000 + id, rssi: -70, snr: 8, sourceBroker: "test", pathLength: { hopCount: 2, hashSize: 1, raw: "02" } } } };
}
beforeEach(() => analyze.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("desktop Live packets panel", () => {
  it("resizes from the top-left, clamps pointer deltas to map bounds, cancels safely and releases pointer capture", () => {
    const notifyResize = mockResizeObserver();
    const parentPointer = vi.fn();
    const view = render(<div data-testid="resize-map" onPointerDown={parentPointer} onPointerMove={parentPointer}>
      <LivePacketLogPanel entries={[entry(1)]} status="connected" />
    </div>);
    const map = screen.getByTestId("resize-map");
    Object.defineProperties(map, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    notifyResize(map);
    const panel = screen.getByRole("region", { name: "Live packets" });
    const handle = screen.getByRole("button", { name: "Resize packet log" });
    expect(handle).toHaveAttribute("title", "Resize packet log");
    expect(document.getElementById(handle.getAttribute("aria-describedby")!)).toHaveTextContent("Arrow keys move this corner");
    const captured = new Set<number>();
    const release = vi.fn((id: number) => { captured.delete(id); });
    Object.assign(handle, {
      setPointerCapture: vi.fn((id: number) => { captured.add(id); }),
      hasPointerCapture: (id: number) => captured.has(id), releasePointerCapture: release,
    });
    expect(panel).toHaveStyle({ width: "440px", height: "310px" });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 348, clientY: 234 });
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    fireEvent.pointerMove(handle, { pointerId: 99, clientX: 0, clientY: 0 });
    expect(panel).toHaveStyle({ width: "440px", height: "310px" });
    parentPointer.mockClear();
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 248, clientY: 174 });
    expect(panel).toHaveStyle({ width: "540px", height: "370px" });
    expect(parentPointer).not.toHaveBeenCalled();
    fireEvent.pointerCancel(handle, { pointerId: 7 });
    expect(panel).toHaveStyle({ width: "440px", height: "310px" });
    expect(release).toHaveBeenCalledWith(7);
    fireEvent.pointerDown(handle, { button: 0, pointerId: 8, clientX: 348, clientY: 234 });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 2000, clientY: 2000 });
    expect(panel).toHaveStyle({ width: "320px", height: "180px" });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: -2000, clientY: -2000 });
    expect(panel).toHaveStyle({ width: "776px", height: "532px" });
    fireEvent.pointerUp(handle, { pointerId: 8 });
    expect(release).toHaveBeenCalledWith(8);
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 2000, clientY: 2000 });
    expect(panel).toHaveStyle({ width: "776px", height: "532px" });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 9, clientX: 100, clientY: 100 });
    view.unmount();
    expect(release).toHaveBeenCalledWith(9);
  });

  it("offers keyboard resizing without map shortcuts, and remembers expanded dimensions through collapse", () => {
    const notifyResize = mockResizeObserver();
    const parentKey = vi.fn();
    render(<div data-testid="resize-map" onKeyDown={parentKey}><LivePacketLogPanel entries={[]} status="connected" /></div>);
    const map = screen.getByTestId("resize-map");
    Object.defineProperties(map, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    notifyResize(map);
    const panel = screen.getByRole("region", { name: "Live packets" });
    const handle = screen.getByRole("button", { name: "Resize packet log" });
    expect(handle).toHaveAccessibleDescription(/Arrow keys.*Shift.*Escape/);
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowUp", shiftKey: true });
    expect(panel).toHaveStyle({ width: "450px", height: "360px" });
    expect(handle).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("450 × 360 px");
    expect(parentKey).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(panel).toHaveStyle({ width: "440px", height: "350px" });
    const collapse = screen.getByRole("button", { name: "Live packets" });
    fireEvent.click(collapse);
    expect(panel.style.height).toBe("");
    expect(screen.queryByRole("button", { name: "Resize packet log" })).not.toBeInTheDocument();
    expect(collapse).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(collapse);
    expect(panel).toHaveStyle({ width: "440px", height: "350px" });
    expect(screen.getByRole("log")).toHaveStyle({ height: "100%" });
    expect(panel.querySelector('[data-slot="log-viewer"]')).toHaveClass("min-h-0", "flex-1");
    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(screen.getByRole("button", { name: "Resize packet log" }), { key: "ArrowLeft", shiftKey: true });
      fireEvent.keyDown(screen.getByRole("button", { name: "Resize packet log" }), { key: "ArrowUp", shiftKey: true });
    }
    expect(panel).toHaveStyle({ width: "776px", height: "532px" });
    for (let i = 0; i < 12; i++) {
      fireEvent.keyDown(screen.getByRole("button", { name: "Resize packet log" }), { key: "ArrowRight", shiftKey: true });
      fireEvent.keyDown(screen.getByRole("button", { name: "Resize packet log" }), { key: "ArrowDown", shiftKey: true });
    }
    expect(panel).toHaveStyle({ width: "320px", height: "180px" });
  });

  it("clamps remembered sizes when the map shrinks, including while collapsed and in small containers", () => {
    const notifyResize = mockResizeObserver();
    const { unmount } = render(<div data-testid="resize-map"><LivePacketLogPanel entries={[]} status="connected" /></div>);
    const map = screen.getByTestId("resize-map");
    let width = 800;
    let height = 600;
    Object.defineProperties(map, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
    notifyResize(map);
    const panel = screen.getByRole("region", { name: "Live packets" });
    width = 400;
    height = 300;
    notifyResize(map);
    expect(panel).toHaveStyle({ width: "376px", height: "232px", bottom: "56px", right: "12px" });
    const collapse = screen.getByRole("button", { name: "Live packets" });
    fireEvent.click(collapse);
    width = 280;
    height = 150;
    notifyResize(map);
    expect(panel).toHaveStyle({ width: "256px", bottom: "0px" });
    expect(panel.style.height).toBe("");
    fireEvent.click(collapse);
    expect(panel).toHaveStyle({ width: "256px", height: "138px" });
    const handle = screen.getByRole("button", { name: "Resize packet log" });
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(handle, { key: "ArrowUp", shiftKey: true });
    expect(panel).toHaveStyle({ width: "256px", height: "138px" });
    width = 800;
    height = 600;
    fireEvent(window, new Event("resize"));
    expect(panel).toHaveStyle({ width: "320px", height: "180px", bottom: "56px" });
    unmount();
    notifyResize(map);
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("cancels a captured resize on Escape or lost capture, without changing the feed or bubbling map gestures", () => {
    const onMapGesture = vi.fn();
    render(<div onMouseDown={onMapGesture} onTouchStart={onMapGesture} onKeyDown={onMapGesture}>
      <LivePacketLogPanel entries={[entry(1)]} status="connected" />
    </div>);
    const panel = screen.getByRole("region", { name: "Live packets" });
    const handle = screen.getByRole("button", { name: "Resize packet log" });
    let captured = false;
    Object.assign(handle, {
      setPointerCapture: () => { captured = true; }, hasPointerCapture: () => captured,
      releasePointerCapture: () => { captured = false; },
    });
    fireEvent.mouseDown(handle);
    fireEvent.touchStart(handle);
    expect(onMapGesture).not.toHaveBeenCalled();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(panel).toHaveStyle({ width: "540px", height: "410px" });
    fireEvent.keyDown(handle, { key: "Escape" });
    expect(panel).toHaveStyle({ width: "440px", height: "310px" });
    expect(captured).toBe(false);
    expect(onMapGesture).not.toHaveBeenCalled();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.lostPointerCapture(handle, { pointerId: 2 });
    expect(panel).toHaveStyle({ width: "440px", height: "310px" });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("translates the resize control and keyboard hint into Lithuanian", async () => {
    await act(() => i18n.changeLanguage("lt"));
    render(<LivePacketLogPanel entries={[]} status="connected" />);
    const handle = screen.getByRole("button", { name: "Keisti paketų žurnalo dydį" });
    expect(handle).toHaveAccessibleDescription(/Rodyklių klavišai.*Shift.*Escape/);
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(screen.getByRole("region", { name: "Paketai tiesiogiai" })).toHaveStyle({ height: "320px" });
  });

  it.each([
    { language: "en", heading: "Packets", status: "LIVE", context: "Live packets" },
    { language: "lt", heading: "Paketai", status: "TIESIOGIAI", context: "Paketai tiesiogiai" },
  ])("keeps the visible heading concise in $language while retaining live status and the contextual collapse name", async ({ language, heading, status, context }) => {
    await act(() => i18n.changeLanguage(language));
    render(<LivePacketLogPanel entries={[]} status="connected" />);
    const region = screen.getByRole("region", { name: context });
    const trigger = within(region).getByRole("button", { name: context });
    expect(trigger.firstElementChild).toHaveTextContent(new RegExp(`^${heading}$`));
    expect(within(trigger).getByText(status, { exact: true })).toBeVisible();
    expect(within(trigger).queryByText(context, { exact: true })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("puts the embedded sender before decoded content, keeping verified route context secondary", () => {
    const packet = entry(1, "Fallback summary");
    packet.message = { senderName: "Test sender 📡", content: "Test" };
    packet.data.observation.resolvedSource = { confidence: "high", nodes: [{ id: "source", publicKey: "a", name: "Source node" }] };
    packet.data.observation.resolvedDestination = { confidence: "high", nodes: [{ id: "destination", publicKey: "b", name: "Destination node" }] };
    render(<LivePacketLogPanel entries={[packet]} status="connected" />);
    const row = screen.getByRole("button", { name: "Packet details: ADVERT · Sender: Test sender 📡 · Test · Source node → Destination node" });
    expect(row.querySelector('[data-slot="packet-message"]')).toHaveTextContent("Test sender 📡: Test · Source node → Destination node");
    expect(row.querySelector('[data-slot="packet-sender"]')).toHaveAttribute("title", "Sender: Test sender 📡");
    expect(row.querySelector('[data-slot="packet-context"]')).toHaveTextContent("Source node → Destination node");
    expect(row.querySelector('[data-slot="packet-context"]')).not.toHaveTextContent("Test sender");
    fireEvent.click(row);
    expect(analyze).toHaveBeenCalledExactlyOnceWith(packet.data.packetHash);
  });

  it("aligns route, IATA and sightings slots across route forms and one-, two-, and larger digit counts", () => {
    const packets = [1, 2, 0, 3].map((routeType, index) => {
      const packet = entry(index + 1);
      packet.data.packet.routeType = routeType;
      packet.seenCount = [1, 18, 123, 7][index];
      return packet;
    });
    const { rerender } = render(<LivePacketLogPanel entries={packets} status="connected" />);
    const rows = screen.getAllByRole("listitem");
    const routes = ["FLOOD", "DIRECT", "T·FLOOD", "T·DIRECT"];
    rows.forEach((row, index) => {
      const metadata = row.querySelector<HTMLElement>('[data-slot="packet-metadata"]')!;
      expect(metadata).toHaveClass("inline-grid", "whitespace-nowrap");
      expect(metadata.style.gridTemplateColumns).toBe("8ch 3ch 4ch");
      expect(row.querySelector('[data-slot="packet-route"]')).toHaveTextContent(routes[index]);
      const count = row.querySelector('[data-slot="packet-sighting-count"]')!;
      expect(count).toHaveClass("min-w-[2ch]", "text-end", "tabular-nums");
      expect(count.textContent).toBe(String(packets[index].seenCount));
      expect(count.previousElementSibling).toHaveTextContent("×");
    });
    expect(rows[3].querySelector('[data-slot="packet-route"]')).toHaveAttribute("title", "TRANSPORT_DIRECT");
    fireEvent.click(screen.getByRole("button", { name: "Wrap content" }));
    expect(rows[0].querySelector('[data-slot="packet-metadata"]')).toHaveClass("whitespace-nowrap");
    expect(rows[0].querySelector('[data-slot="packet-message"]')).toHaveClass("whitespace-pre-wrap");
    rerender(<LivePacketLogPanel entries={packets.filter(packet => packet.seenCount < 100)} status="connected" />);
    screen.getAllByRole("listitem").forEach(row => {
      expect(row.querySelector<HTMLElement>('[data-slot="packet-metadata"]')!.style.gridTemplateColumns).toBe("8ch 3ch 3ch");
    });
    expect(screen.getByLabelText("1 sighting in this feed").querySelector('[data-slot="packet-sighting-count"]')).toHaveTextContent(/^1$/);
    expect(screen.getByLabelText("18 sightings in this feed").querySelector('[data-slot="packet-sighting-count"]')).toHaveTextContent(/^18$/);
  });

  it("keeps an activated row selected through enrichment, arrivals, filtering and collapse, then moves or clears selection safely", () => {
    const first = entry(1);
    const second = entry(2);
    const { rerender } = render(<LivePacketLogPanel entries={[second, first]} status="connected" />);
    const firstButton = () => screen.getByRole("button", { name: /Packet details: ADVERT · (Observation 1|Enriched packet)/ });
    const secondButton = () => screen.getByRole("button", { name: "Packet details: ADVERT · Observation 2" });
    expect(firstButton()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(firstButton());
    expect(firstButton()).toHaveAttribute("aria-pressed", "true");
    expect(firstButton()).toHaveClass("bg-primary/12", "border-s-primary");
    expect(secondButton()).toHaveAttribute("aria-pressed", "false");
    expect(analyze).toHaveBeenLastCalledWith(first.data.packetHash);
    first.seenCount = 18;
    first.message = { content: "Enriched packet", senderName: "" };
    rerender(<LivePacketLogPanel entries={[entry(3), { ...first }, second]} status="connected" />);
    expect(firstButton()).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Observation 2" } });
    expect(screen.queryByRole("button", { name: /Enriched packet/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(firstButton()).toHaveAttribute("aria-pressed", "true");
    // Native button keyboard activation produces a click with detail=0.
    secondButton().focus();
    fireEvent.click(secondButton(), { detail: 0 });
    expect(secondButton()).toHaveFocus();
    expect(secondButton()).toHaveAttribute("aria-pressed", "true");
    expect(firstButton()).toHaveAttribute("aria-pressed", "false");
    expect(firstButton()).not.toHaveClass("bg-primary/12");
    expect(analyze).toHaveBeenLastCalledWith(second.data.packetHash);
    fireEvent.click(screen.getByRole("button", { name: "Live packets" }));
    fireEvent.click(screen.getByRole("button", { name: "Live packets" }));
    expect(secondButton()).toHaveAttribute("aria-pressed", "true");
    rerender(<LivePacketLogPanel entries={[first]} status="connected" />);
    rerender(<LivePacketLogPanel entries={[entry(2, "Reused entry ID"), first]} status="connected" />);
    const reused = screen.getByRole("button", { name: "Packet details: ADVERT · Reused entry ID" });
    expect(reused).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(reused);
    rerender(<LivePacketLogPanel entries={[]} status="connected" />);
    rerender(<LivePacketLogPanel entries={[entry(2, "New feed packet")]} status="connected" />);
    expect(screen.getByRole("button", { name: "Packet details: ADVERT · New feed packet" })).toHaveAttribute("aria-pressed", "false");
    expect(analyze.mock.calls).toEqual([[first.data.packetHash], [second.data.packetHash], [second.data.packetHash]]);
  });

  it("translates vertical wheel input only over overflowing packet types, preserves native horizontal input, and cleans up across collapse", () => {
    const onParentWheel = vi.fn();
    const view = render(<div onWheel={onParentWheel}><LivePacketLogPanel entries={[entry(1)]} status="connected" /></div>);
    const geometry = (strip: HTMLElement) => Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 160 }, scrollWidth: { configurable: true, value: 640 },
    });
    const wheel = (element: HTMLElement, options: WheelEventInit) => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...options });
      fireEvent(element, event);
      return event;
    };
    const strip = screen.getByRole("group", { name: "Packet types" });
    geometry(strip);
    expect(wheel(strip, { deltaY: 48 }).defaultPrevented).toBe(true);
    expect(strip.scrollLeft).toBe(48);
    expect(wheel(strip, { deltaY: 2, deltaMode: 1 }).defaultPrevented).toBe(true);
    expect(strip.scrollLeft).toBe(80);
    expect(wheel(strip, { deltaY: 1, deltaMode: 2 }).defaultPrevented).toBe(true);
    expect(strip.scrollLeft).toBe(240);
    // jsdom does not perform native trackpad scrolling; leave that default action intact.
    expect(wheel(strip, { deltaX: 24, deltaY: 8 }).defaultPrevented).toBe(false);
    expect(strip.scrollLeft).toBe(240);
    expect(onParentWheel).not.toHaveBeenCalled();
    wheel(strip, { deltaY: 999 });
    expect(strip.scrollLeft).toBe(480);
    wheel(strip, { deltaY: -999 });
    expect(strip.scrollLeft).toBe(0);
    expect(wheel(strip, { deltaY: 10, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(strip.scrollLeft).toBe(0);
    const log = screen.getByRole("log");
    wheel(log, { deltaY: 30 });
    expect(log.scrollLeft).toBe(0);
    expect(onParentWheel).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Live packets" }));
    expect(wheel(strip, { deltaY: 30 }).defaultPrevented).toBe(false);
    expect(strip.scrollLeft).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Live packets" }));
    const reopened = screen.getByRole("group", { name: "Packet types" });
    geometry(reopened);
    wheel(reopened, { deltaY: 30 });
    expect(reopened.scrollLeft).toBe(30);
    view.unmount();
    expect(wheel(reopened, { deltaY: 30 }).defaultPrevented).toBe(false);
    expect(reopened.scrollLeft).toBe(30);
  });

  it("keeps later types reachable with the keyboard without moving the log or forwarding touch gestures to the map", async () => {
    const packets = [0, 2, 4, 5, 8, 9].map((payloadType, index) => {
      const packet = entry(index + 1);
      packet.data.packet.payloadType = payloadType;
      return packet;
    });
    const onParentTouch = vi.fn();
    render(<div onTouchMove={onParentTouch}><LivePacketLogPanel entries={packets} status="connected" /></div>);
    const strip = screen.getByRole("group", { name: "Packet types" });
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 160 }, scrollWidth: { configurable: true, value: 480 },
    });
    vi.spyOn(strip, "getBoundingClientRect").mockImplementation(() => ({ left: 100, right: 260 } as DOMRect));
    const chips = within(strip).getAllByRole("button");
    chips.forEach((chip, index) => vi.spyOn(chip, "getBoundingClientRect").mockImplementation(() => ({
      left: 100 + index * 80 - strip.scrollLeft, right: 180 + index * 80 - strip.scrollLeft,
    } as DOMRect)));
    act(() => chips[0].focus());
    fireEvent.keyDown(chips[0], { key: "End" });
    await waitFor(() => expect(chips.at(-1)).toHaveFocus());
    expect(strip.scrollLeft).toBe(320);
    fireEvent.keyDown(chips.at(-1)!, { key: "Home" });
    await waitFor(() => expect(chips[0]).toHaveFocus());
    expect(strip.scrollLeft).toBe(0);
    expect(chips.every(chip => chip.getAttribute("aria-pressed") === "true")).toBe(true);
    expect(screen.getByRole("log").scrollLeft).toBe(0);
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.touchMove(strip);
    expect(onParentTouch).not.toHaveBeenCalled();
  });

  it("offers a quiet, oldest-first log with searchable packet metadata and no hash fallback", () => {
    const { container } = render(<LivePacketLogPanel entries={[entry(2, "Later packet"), entry(1, "Earlier packet")]} status="connected" />);
    const log = screen.getByRole("log", { name: "Received packet observations" });
    expect(log).toHaveAttribute("aria-live", "off");
    expect(within(log).getAllByRole("listitem")[0]).toHaveTextContent("Earlier packet");
    expect(screen.queryByRole("group", { name: "Levels" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Error|Warn|Info|Debug),/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ADVERT, 2 packets" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "vno" } });
    expect(within(log).getAllByRole("listitem")).toHaveLength(2);
    expect(log.querySelectorAll("mark")).toHaveLength(2);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: entry(1).data.packetHash } });
    expect(log).toHaveTextContent("No packets of the selected types match");
    expect(container.innerHTML).not.toContain(`title="${entry(1).data.packetHash}"`);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(within(log).getAllByRole("listitem")).toHaveLength(2);
  });

  it("filters by present packet types with search-aware counts, includes new types, and clears an empty selection", () => {
    const first = entry(1, "Beacon north");
    const second = entry(2, "Beacon south");
    second.data.packet.payloadType = 5;
    const { rerender } = render(<LivePacketLogPanel entries={[second, first]} status="connected" />);
    const types = screen.getByRole("group", { name: "Packet types" });
    expect(within(types).getAllByRole("button")).toHaveLength(2);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "north" } });
    expect(screen.getByRole("button", { name: "ADVERT, 1 packet" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "GRP_TXT, 0 packets" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "ADVERT, 1 packet" }));
    expect(screen.getByRole("log")).toHaveTextContent("No packets of the selected types match “north”");
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    const third = entry(3, "Third packet");
    third.data.packet.payloadType = 3;
    rerender(<LivePacketLogPanel entries={[third, second, first]} status="connected" />);
    expect(screen.getByRole("button", { name: "ACK, 1 packet" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "ACK, 1 packet" }));
    fireEvent.click(screen.getByRole("button", { name: "GRP_TXT, 1 packet" }));
    expect(screen.getByRole("log")).toHaveTextContent("No packets of the selected types");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "ADVERT, 1 packet" })).toHaveAttribute("aria-pressed", "true");
  });

  it("uses single-line monospace rows by default, with wrapping confined to the message column", () => {
    render(<LivePacketLogPanel entries={[entry(1, "First line\nSecond line")]} status="connected" />);
    const row = screen.getByRole("button", { name: /Packet details:/ });
    expect(screen.getByRole("button", { name: "Wrap content" })).toHaveAttribute("aria-pressed", "false");
    expect(row).toHaveClass("grid", "min-h-6", "font-mono");
    expect(row.querySelector("time")).toBe(row.firstElementChild);
    expect(row.querySelector('[data-slot="packet-preview"]')).toHaveTextContent("First line Second line");
    expect(row.querySelector('[data-slot="packet-message"]')).toHaveClass("whitespace-nowrap");
    expect(row.querySelector(".rounded-sm.border")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Wrap content" }));
    expect(row.querySelector('[data-slot="packet-message"]')).toHaveClass("whitespace-pre-wrap");
    expect(row.querySelector('[data-slot="packet-preview"]')!.textContent).toBe("First line\nSecond line");
  });

  it("keeps type exclusions through eviction and handles unknown types without manufacturing severity", () => {
    const first = entry(1);
    const second = entry(2);
    second.data.packet.payloadType = 5;
    const { rerender } = render(<LivePacketLogPanel entries={[second, first]} status="connected" />);
    fireEvent.click(screen.getByRole("button", { name: "ADVERT, 1 packet" }));
    rerender(<LivePacketLogPanel entries={[second]} status="connected" />);
    expect(screen.queryByRole("button", { name: /ADVERT,/ })).not.toBeInTheDocument();
    const future = entry(3);
    future.data.packet.payloadType = 12;
    future.data.packet.payloadTypeName = "";
    rerender(<LivePacketLogPanel entries={[future, entry(4), second]} status="connected" />);
    expect(screen.getByRole("button", { name: "ADVERT, 1 packet" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Unknown 12, 1 packet" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    const typeControls = screen.getByRole("group", { name: "Packet types" });
    expect(typeControls).toHaveClass("overflow-x-auto");
    expect(within(typeControls).getAllByRole("button")).toHaveLength(3);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no such packet" } });
    expect(screen.getByRole("button", { name: "Unknown 12, 0 packets" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("counts missed packets through full-buffer eviction, but not filtering, repeat sightings, or decoded enrichment", () => {
    const first = entry(1);
    const { rerender } = render(<LivePacketLogPanel entries={[first]} status="connected" />);
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    first.seenCount = 2;
    first.message = { content: "Decoded later", senderName: "Alice" };
    rerender(<LivePacketLogPanel entries={[{ ...first }]} status="connected" />);
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();
    const full = Array.from({ length: 100 }, (_, index) => entry(index + 2));
    rerender(<LivePacketLogPanel entries={full} status="connected" />);
    expect(screen.getByRole("button", { name: "100 new packets" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no such packet" } });
    expect(screen.getByRole("button", { name: "100 new packets" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: "100 new packets" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ADVERT, 100 packets" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("log"), { key: "End" });
    expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "true");
  });

  it("translates packet controls, filter recovery, counts, and the missed-packet pill into Lithuanian", async () => {
    await act(() => i18n.changeLanguage("lt"));
    const first = entry(1);
    const { rerender } = render(<LivePacketLogPanel entries={[first]} status="connected" />);
    expect(screen.getByRole("button", { name: "Paketai tiesiogiai" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("searchbox", { name: "Filtruoti paketus" })).toHaveAttribute("placeholder", "Filtruoti paketus");
    expect(screen.getByRole("button", { name: "Laužyti tekstą" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ADVERT, 1 paketas" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sekti" }));
    rerender(<LivePacketLogPanel entries={[entry(3), entry(2), first]} status="connected" />);
    expect(screen.getByRole("button", { name: "ADVERT, 3 paketai" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 nauji paketai" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new lines|new packets|Follow/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nerasta" } });
    expect(screen.getByRole("log")).toHaveTextContent("Nėra pasirinktų tipų paketų, atitinkančių „nerasta“");
    fireEvent.click(screen.getByRole("button", { name: "Išvalyti filtrus" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("renders an anonymous packet without preview as metadata only, retaining opaque hash solely for activation", () => {
    const packet = entry(1);
    packet.data.packet.payloadType = 7;
    packet.data.packet.summary = undefined;
    packet.data.packetHash = "f1e2d3c4".repeat(8);
    const { rerender } = render(<LivePacketLogPanel entries={[packet]} status="connected" />);
    const row = screen.getByRole("button", { name: "Packet details: ANON_REQ", exact: true });
    expect(row.querySelector('[data-slot="packet-preview"], [data-slot="packet-context"]')).toBeNull();
    expect(row.textContent).not.toMatch(/f1e2d3c4/i);
    expect(row.outerHTML).not.toMatch(/f1e2d3c4/i);
    row.focus();
    fireEvent.click(row);
    expect(analyze).toHaveBeenCalledExactlyOnceWith(packet.data.packetHash);
    // A genuinely packet-derived hexadecimal summary is still useful content, not a hash fallback.
    packet.data.packet.summary = "DEADBEEF";
    rerender(<LivePacketLogPanel entries={[{ ...packet }]} status="connected" />);
    expect(screen.getByText("DEADBEEF")).toBeVisible();
  });
  it("does not repeat a route already shown by the preview, but preserves a sender name mentioned within distinct content", () => {
    const packet = entry(1, "Alice → Destination");
    packet.data.observation.resolvedSource = { confidence: "high", nodes: [{ id: "a", publicKey: "a", name: "Alice" }] };
    packet.data.observation.resolvedDestination = { confidence: "high", nodes: [{ id: "b", publicKey: "b", name: "Destination" }] };
    const { rerender } = render(<LivePacketLogPanel entries={[packet]} status="connected" />);
    const row = screen.getAllByRole("listitem")[0].querySelector("button")!;
    expect(row.querySelector('[data-slot="packet-context"]')).toBeNull();
    packet.message = { content: "Alice says hello", senderName: "Alice" };
    rerender(<LivePacketLogPanel entries={[{ ...packet }]} status="connected" />);
    expect(screen.getByText("Alice says hello")).toBeVisible();
    expect(screen.getByText("Alice:")).toBeVisible();
    expect(screen.getByText("→ Destination")).toBeVisible();
  });
  it.each([
    { payloadType: 1, name: "LT-VM Naujamiestis 769F", summary: "LT-VM Naujamiestis 769F" },
    { payloadType: 8, name: "LT-LA G R177E3🥾", summary: "  LT-LA G  R177E3🥾  " },
    { payloadType: 8, name: "Fallback node", summary: undefined },
  ])("does not repeat a name-only preview for payload $payloadType", ({ payloadType, name, summary }) => {
    const packet = entry(1);
    packet.data.packet.payloadType = payloadType;
    packet.data.packet.summary = summary;
    packet.data.observation.resolvedSource = { confidence: "high", nodes: [{ id: "source", publicKey: "a", name }] };
    render(<LivePacketLogPanel entries={[packet]} status="connected" />);
    const row = screen.getAllByRole("listitem")[0].querySelector("button")!;
    expect(row.querySelector('[data-slot="packet-context"]')).toBeNull();
    expect(row.querySelector('[data-slot="packet-preview"]')!.textContent!.replace(/\s+/g, " ").trim()).toBe(name);
    expect(row.textContent!.replace(/\s+/g, " ").split(name)).toHaveLength(2);
    expect(screen.getByRole("region").querySelector(":scope > [data-state] > p")).toBeNull();
  });
  it("keeps first-heard timestamps when later observations update a row in place", () => {
    const earlier = entry(1);
    const later = entry(2);
    const { rerender } = render(<LivePacketLogPanel entries={[later, earlier]} status="connected" />);
    const firstTimes = screen.getAllByRole("listitem").map(row => row.querySelector("time")!.getAttribute("datetime"));
    const title = screen.getAllByRole("listitem")[0].querySelector("time")!.title;
    earlier.data.observation.heardAt += 60_000;
    earlier.seenCount = 2;
    rerender(<LivePacketLogPanel entries={[later, { ...earlier }]} status="connected" />);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Observation 1");
    expect(screen.getAllByRole("listitem").map(row => row.querySelector("time")!.getAttribute("datetime"))).toEqual(firstTimes);
    expect(title).toMatch(/^First heard:/);
    expect(screen.getAllByRole("listitem")[0].querySelector("time")).toHaveAttribute("aria-label", title);
    expect(screen.getByLabelText("2 sightings in this feed")).toBeVisible();
  });
  it("shows decoded group content and embedded sender separately, keeping known routes secondary and HTML literal", () => {
    const packet = entry(1, "Server summary should not hide decoded content");
    packet.data.packet.payloadType = 5;
    packet.data.observation.resolvedSource = { confidence: "high", nodes: [{ id: "source", name: "Source node", publicKey: "a" }] };
    packet.data.observation.resolvedDestination = { confidence: "high", nodes: [{ id: "dest", name: "Destination node", publicKey: "b" }] };
    packet.message = { content: "<img src=x>\n" + "Long decoded message ".repeat(20), senderName: "Alice" };
    const { container } = render(<LivePacketLogPanel entries={[packet]} status="connected" />);
    const row = screen.getByRole("button", { name: /Packet details: GRP_TXT · Sender: Alice · <img src=x>.*Source node → Destination node/s });
    fireEvent.click(screen.getByRole("button", { name: "Wrap content" }));
    const preview = row.querySelector('[data-slot="packet-preview"]')!;
    expect(preview.textContent).toBe(packet.message.content);
    expect(preview).toHaveAttribute("title", packet.message.content);
    expect(row.querySelector('[data-slot="packet-sender"]')).toHaveTextContent("Alice:");
    expect(row.querySelector('[data-slot="packet-context"]')).toHaveTextContent("Source node → Destination node");
    expect(row).not.toHaveTextContent("Sender:");
    expect(row).not.toHaveTextContent("Observer name");
    expect(container.querySelector("img")).toBeNull();
    expect(row.querySelector("a, button")).toBeNull();
    fireEvent.click(row);
    expect(analyze).toHaveBeenCalledExactlyOnceWith(packet.data.packetHash);
  });

  it("uses available summaries for other payloads before endpoints, and never claims an observer or ambiguous source as sender", () => {
    const packet = entry(1, "Advert name");
    packet.data.observation.resolvedSource = { confidence: "high", nodes: [{ id: "abcdef123456", name: " ", publicKey: "a" }] };
    packet.data.observation.resolvedDestination = { confidence: "high", nodes: [{ id: "dest", name: "Destination", publicKey: "b" }] };
    const { rerender } = render(<LivePacketLogPanel entries={[packet]} status="connected" />);
    expect(screen.getByText("Advert name")).toBeVisible();
    expect(screen.getByText("ABCDEF12:")).toBeVisible();
    expect(screen.getByText("→ Destination")).toBeVisible();
    packet.message = { content: " ", senderName: " " };
    packet.data.observation.resolvedSource = { confidence: "ambiguous", nodes: [{ id: "candidate", name: "Candidate", publicKey: "a" }] };
    rerender(<LivePacketLogPanel entries={[{ ...packet }]} status="connected" />);
    expect(screen.getByText("Advert name")).toBeVisible();
    expect(screen.queryByText(/Sender:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Candidate")).not.toBeInTheDocument();
    expect(screen.getByText("Destination")).toBeVisible();
  });
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

  it("retains oldest-first compact rows received while collapsed without adding inline details", () => {
    const { rerender } = render(<LivePacketLogPanel entries={[entry(1)]} status="connected" />);
    const trigger = screen.getByRole("button", { name: "Live packets" });
    fireEvent.click(trigger);
    rerender(<LivePacketLogPanel entries={[entry(3), entry(2), entry(1)]} status="connected" />);
    expect(screen.getByText("3/100")).toBeVisible();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.click(trigger);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Observation 1");
    expect(rows[1]).toHaveTextContent("Observation 2");
    expect(rows[2]).toHaveTextContent("Observation 3");
    expect(rows[0]).toHaveTextContent("VNO");
    expect(rows[0]).toHaveTextContent("ADVERT");
    expect(rows[0]).toHaveTextContent("FLOOD");
    expect(rows[0]).not.toHaveTextContent("2h");
    expect(rows[0].querySelector('[aria-label="2 hops"], [title="2 hops"]')).toBeNull();
    fireEvent.click(within(rows[0]).getByRole("button", { name: /Packet details:/ }));
    expect(analyze).toHaveBeenCalledExactlyOnceWith(entry(1).data.packetHash);
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
    expect(screen.getByText(`${unsafeName}:`)).toBeVisible();
    expect(screen.getByText("→ Destination")).toBeVisible();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
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
    expect(row).toHaveClass("border-s-transparent");
    expect(within(rows[1]).getByRole("button")).toHaveClass("border-s-text-normal/50");
    expect(row.className).not.toMatch(/bg-green|bg-secondary/);
    expect(within(rows[1]).getByRole("button").className).not.toMatch(/bg-green|bg-secondary/);
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
    expect(screen.queryByLabelText("Hop count unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("—h")).not.toBeInTheDocument();
    expect(screen.queryByText("2h")).not.toBeInTheDocument();
    expect(first.data.observation.pathLength?.hopCount).toBe(2);
    const missingPathRow = screen.getByRole("button", { name: "Packet details: ADVERT · Observation 2" });
    expect(missingPathRow).toHaveTextContent("ADVERT");
    expect(missingPathRow).toHaveTextContent("FLOOD");
    expect(missingPathRow).toHaveTextContent("VNO");
    fireEvent.click(missingPathRow);
    expect(analyze).toHaveBeenLastCalledWith(second.data.packetHash);
    rerender(<LivePacketLogPanel entries={[]} status="connected" />);
    const fresh = entry(1, "New session packet");
    fresh.data.packetHash = "fresh-hash";
    rerender(<LivePacketLogPanel entries={[fresh]} status="connected" />);
    fireEvent.click(screen.getByRole("button", { name: "Packet details: ADVERT · New session packet" }));
    expect(analyze.mock.calls).toEqual([[first.data.packetHash], [second.data.packetHash], ["fresh-hash"]]);
    expect(screen.queryByRole("button", { name: "Close packet details" })).not.toBeInTheDocument();
  });
});
