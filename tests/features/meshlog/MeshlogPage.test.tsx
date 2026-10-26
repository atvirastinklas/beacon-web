import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { MeshlogPage as MeshlogPageView } from "../../../src/features/meshlog/MeshlogPage";
import type { ComponentProps } from "react";
import i18n from "../../../src/i18n";
import type { MeshlogData, MeshlogLiveState, MeshlogPathSegment } from "../../../src/features/meshlog/types";
import { meshlogTestData } from "./meshlog-test-data";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "../../../src/features/map/types";
import { MeshlogMap } from "../../../src/features/meshlog/MeshlogMap";
import { PAYLOAD_TYPE_NAMES, PayloadType } from "../../../src/types/enums";

const liveData: MeshlogData = {
  contacts: [{ id: "node", name: "Real node", kind: "unknown", heard: "—", firstSeen: "—", position: null }],
  reporters: [{ id: "rx", name: "Real observer", color: "#3b82f6" }],
  channels: [{ id: "hash-one", name: "Field", keyKnown: true }], paths: [],
  messages: [{ id: "live", senderName: "Unknown sender", time: "12:00:00", kind: "other", payloadType: 127, typeLabel: "Encrypted 0x7f", reports: [{ reporterId: "rx", time: "12:00:00", path: [], pathUnavailable: true }] }],
};

const noop = () => {};
const meshlogStyles = readFileSync("src/features/meshlog/meshlog.css", "utf8");
const testLiveState: MeshlogLiveState = {
  status: "connected", loading: false, error: false, gap: false, emptyRegion: false, regionLabel: "Test region", onRetry: noop,
  historyLoading: false, historyError: false, hasOlder: false, loadingOlder: false, loadOlder: noop, retryHistory: noop,
  refreshHistory: noop, historyRefreshing: false,
};
const testData: MeshlogData = { ...meshlogTestData, contacts: meshlogTestData.contacts.map(contact => ({
  ...contact, heardAt: Date.parse(`2026-10-24T${contact.heard}Z`), firstSeenAt: Date.parse(contact.firstSeen),
})) };
const oldTownPathCodes = meshlogTestData.messages.find(message => message.id === "m02")!.reports.find(report => report.reporterId === "old-town")!.path.join(" → ");
// Sample defaults exist only at this test boundary, never in the product view.
function MeshlogPage(props: Partial<ComponentProps<typeof MeshlogPageView>>) {
  return <MeshlogPageView data={testData} liveState={testLiveState} onVisiblePacketsChange={noop} onInspectPacket={noop} {...props} />;
}

function openChannels() {
  fireEvent.click(screen.getByRole("combobox", { name: /Select channels/ }));
  return screen.getByRole("dialog", { name: "Channels" });
}
function closeChannels() {
  fireEvent.keyDown(within(screen.getByRole("dialog", { name: "Channels" })).getByRole("combobox", { name: "Search channels" }), { key: "Escape" });
}
function openObservers() {
  fireEvent.click(screen.getByRole("combobox", { name: /^Observers/ }));
  return screen.getByRole("dialog", { name: "Observers" });
}
function closeObservers() {
  fireEvent.keyDown(within(screen.getByRole("dialog", { name: "Observers" })).getByRole("combobox", { name: "Search observers" }), { key: "Escape" });
}
function openTypes() {
  fireEvent.click(screen.getByRole("combobox", { name: /^Packet types/ }));
  return screen.getByRole("dialog", { name: "Packet types" });
}
function closeTypes() {
  fireEvent.keyDown(within(screen.getByRole("dialog", { name: "Packet types" })).getByRole("combobox", { name: "Search types" }), { key: "Escape" });
}
function openNodeTypes() {
  fireEvent.click(screen.getByRole("combobox", { name: /^Node type/ }));
  return screen.getByRole("dialog", { name: "Node type" });
}
function closeNodeTypes() {
  fireEvent.keyDown(within(screen.getByRole("dialog", { name: "Node type" })).getByRole("combobox", { name: "Search types" }), { key: "Escape" });
}
function openScope() {
  fireEvent.click(screen.getByRole("combobox", { name: /^Scope/ }));
  return screen.getByRole("dialog", { name: "Scope" });
}
function closeScope() {
  fireEvent.keyDown(within(screen.getByRole("dialog", { name: "Scope" })).getByRole("combobox", { name: "Find a scope" }), { key: "Escape" });
}
function reportFor(name: string) {
  return screen.getByText(name, { selector: ".meshlog-reporter" }).closest<HTMLElement>(".meshlog-report")!;
}

const mapBoundary = vi.hoisted(() => ({ instances: [] as {
  emit: (event: string) => void;
  data: Record<string, FeatureCollection<LineString | Point>>;
  layers: Record<string, { type: string; paint?: Record<string, unknown> }>;
  ready: boolean;
  options: { center: [number, number]; zoom: number };
  fitBounds: ReturnType<typeof vi.fn>;
}[] }));
const flowBoundary = vi.hoisted(() => vi.fn());
vi.mock("../../../src/features/meshlog/useMeshlogPacketFlow", () => ({ useMeshlogPacketFlow: flowBoundary }));
vi.mock("../../../src/features/map/node-icons", async original => ({ ...await original<typeof import("../../../src/features/map/node-icons")>(), rasterizeNodeIcon: vi.fn(async () => ({ data: { width: 1, height: 1, data: new Uint8ClampedArray(4) }, pixelRatio: 1 })) }));
vi.mock("../../../src/features/meshlog/overview-marker", async original => ({ ...await original<typeof import("../../../src/features/meshlog/overview-marker")>(), rasterizeOverviewMarker: vi.fn(() => ({ data: { width: 48, height: 48, data: new Uint8ClampedArray(48 * 48 * 4) }, pixelRatio: 2 })) }));

vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(),
  Map: class {
    ready = false;
    data: Record<string, FeatureCollection<LineString | Point>> = {};
    listeners = new globalThis.Map<string, Set<() => void>>();
    layers: Record<string, { type: string; paint?: Record<string, unknown> }> = {};
    sources = new globalThis.Map<string, { setData: (data: FeatureCollection<LineString | Point>) => void }>();
    fitBounds = vi.fn();
    canvas = document.createElement("div");
    getCanvas() { return this.canvas; }
    queryRenderedFeatures() { return []; }
    hasImage() { return false; }
    addImage() {} updateImage() {} setMissingStyleImageResolver() {}
    constructor(public options: { center: [number, number]; zoom: number }) { mapBoundary.instances.push(this); }
    addControl() {} resize() {}
    on(event: string, callback: () => void) {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(callback); this.listeners.set(event, listeners);
    }
    off(event: string, callback: () => void) { this.listeners.get(event)?.delete(callback); }
    emit(event: string) {
      if (event === "load") this.ready = true;
      this.listeners.get(event)?.forEach(callback => callback());
    }
    isStyleLoaded() { return this.ready; }
    addSource(id: string, source: { data: FeatureCollection<LineString | Point> }) {
      this.data[id] = source.data;
      this.sources.set(id, { setData: data => { this.data[id] = data; } });
    }
    getSource(id: string) { return this.sources.get(id); }
    addLayer(layer: { id: string; type: string; paint?: Record<string, unknown> }) { this.layers[layer.id] = layer; }
    getLayer(id: string) { return this.layers[id]; }
    setPaintProperty(id: string, property: string, value: unknown) { this.layers[id]!.paint![property] = value; }
    remove() { this.listeners.clear(); }
  },
  NavigationControl: class {},
  AttributionControl: class {},
  Popup: class {
    setLngLat() { return this; } setDOMContent() { return this; } addTo() { return this; } remove() { return this; }
  },
}));

beforeEach(() => { mapBoundary.instances.length = 0; flowBoundary.mockClear(); });

describe("Meshlog monitoring workspace", () => {
  it("keeps known Direct reports inline while retaining routed/unavailable path truth and independent pins", async () => {
    const reporters = ["direct", "routed", "unavailable"].map(id => ({ id, name: `${id} observer`, color: "#22c55e" }));
    const message = { ...liveData.messages[0]!, kind: "advertisement" as const, payloadType: PayloadType.ADVERT, reports: [
      { reporterId: "direct", time: "12:00:01", path: [], pathUnavailable: false },
      { reporterId: "routed", time: "12:00:02", path: ["aabb", "ccdd"] },
      { reporterId: "unavailable", time: "12:00:03", path: [], pathUnavailable: true },
    ] };
    render(<MeshlogPage data={{ ...liveData, reporters, messages: [message], paths: [{ ...testData.paths[0]!, key: "live:direct" }, { ...testData.paths[0]!, key: "live:routed" }] }} />);
    fireEvent.click(screen.getByRole("button", { name: /^Packet details:/ }));
    const direct = reportFor("direct observer");
    const directLabel = within(direct).getByText("Direct");
    expect(directLabel).toHaveClass("meshlog-report-direct");
    expect(directLabel.parentElement).toHaveClass("meshlog-report-observer");
    expect(directLabel.parentElement).toContainElement(within(direct).getByText("direct observer"));
    expect(direct.querySelector(".meshlog-report-content > .meshlog-report-path")).toBeNull();
    const routed = reportFor("routed observer");
    expect(routed.querySelector(".meshlog-report-content > .meshlog-report-path")).toHaveTextContent("aabb → ccdd");
    expect(within(routed).queryByText("Direct")).not.toBeInTheDocument();
    const unavailable = reportFor("unavailable observer");
    expect(within(unavailable).getByText("No resolved path to map", { selector: ".meshlog-report-path" })).toBeInTheDocument();
    expect(within(unavailable).queryByText("Direct")).not.toBeInTheDocument();
    expect(within(unavailable).queryByRole("checkbox")).not.toBeInTheDocument();
    const pin = within(direct).getByRole("checkbox");
    fireEvent.click(pin);
    expect(pin).toBeChecked();
    expect(within(routed).getByRole("checkbox")).not.toBeChecked();
    await act(async () => { await i18n.changeLanguage("lt"); });
    expect(within(direct).getByText(i18n.t("talkers.direct"))).toHaveClass("meshlog-report-direct");
    expect(pin).toBeChecked();
  });
  it("applies supported age settings only to directory rows/markers and restores hidden expansions without changing packets or pins", async () => {
    const now = Date.now(), day = 86_400_000;
    const base = { ...liveData.contacts[0]!, position: [24, 56] as [number, number] };
    const contacts = [
      { ...base, id: "fresh", name: "Fresh node", heardAt: now },
      { ...base, id: "expired", name: "Expired node", heardAt: now - 4 * day },
      { ...base, id: "very", name: "Very expired node", heardAt: now - 10 * day },
      { ...base, id: "hidden", name: "Hidden node", heardAt: now - 30 * day },
      { ...base, id: "unknown", name: "Unknown age" },
      { ...base, id: "future", name: "Future time", heardAt: now + day },
    ];
    const messages = contacts.map(contact => ({ ...liveData.messages[0]!, id: contact.id, senderId: contact.id, senderName: contact.name }));
    const inspect = vi.fn();
    render(<MeshlogPage data={{ ...liveData, contacts, messages, paths: [{ ...testData.paths[0]!, key: "hidden:rx" }] }} onInspectContact={inspect} />);
    const map = mapBoundary.instances[0]!; act(() => map.emit("load"));
    const region = screen.getByRole("region", { name: "Nodes" });
    expect(within(region).getAllByRole("button", { name: /^Node Detail:/ })).toHaveLength(5);
    expect(map.data["meshlog-nodes"]!.features).toHaveLength(5);
    expect(screen.getAllByRole("button", { name: /^Packet details:/ })).toHaveLength(6);
    expect(screen.getByText("Expired", { selector: ".meshlog-age-warning" })).toBeInTheDocument();
    expect(screen.getByText("Very expired", { selector: ".meshlog-age-warning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Node Detail: Unknown age" }).closest(".meshlog-row")).not.toHaveAttribute("data-age");
    expect(screen.getByRole("button", { name: "Node Detail: Future time" }).closest(".meshlog-row")).not.toHaveAttribute("data-age");
    const pin = screen.getByRole("checkbox", { name: "Map path · Hidden node · 12:00:00" });
    fireEvent.click(pin);
    const resetKey = flowBoundary.mock.lastCall![0].resetKey;
    const eligible = [...flowBoundary.mock.lastCall![0].visibleReportKeys];
    fireEvent.click(screen.getByRole("button", { name: "Nodes · Settings" }));
    let settings = screen.getByRole("dialog", { name: "Nodes" });
    expect(within(settings).getByRole("checkbox", { name: "Show advert interval" })).toBeDisabled();
    expect(within(settings).getByRole("checkbox", { name: "Show telemetry" })).toBeDisabled();
    expect(inspect).not.toHaveBeenCalled();
    let hide = within(settings).getByRole("spinbutton", { name: "Hide after (days)" });
    fireEvent.change(hide, { target: { value: "45" } }); fireEvent.blur(hide);
    expect(map.data["meshlog-nodes"]!.features).toHaveLength(6);
    fireEvent.click(within(settings).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nodes" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Node Detail: Hidden node" }));
    expect(inspect).toHaveBeenCalledExactlyOnceWith("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Nodes · Settings" }));
    settings = screen.getByRole("dialog", { name: "Nodes" });
    hide = within(settings).getByRole("spinbutton", { name: "Hide after (days)" });
    fireEvent.change(hide, { target: { value: "21" } }); fireEvent.blur(hide);
    expect(screen.queryByRole("button", { name: "Node Detail: Hidden node" })).not.toBeInTheDocument();
    expect(pin).toBeChecked();
    expect(map.data["pp-lines"]!.features).toHaveLength(1);
    expect(flowBoundary.mock.lastCall![0].resetKey).toBe(resetKey);
    expect([...flowBoundary.mock.lastCall![0].visibleReportKeys]).toEqual(eligible);
    fireEvent.click(within(settings).getByRole("checkbox", { name: "Show time warnings" }));
    expect(region.querySelector("[data-age]")).toBeNull();
    expect(within(region).getAllByRole("button", { name: /^Node Detail:/ })).toHaveLength(5);
    fireEvent.change(hide, { target: { value: "45" } }); fireEvent.blur(hide);
    expect(screen.getByRole("button", { name: "Node Detail: Hidden node" })).toHaveAttribute("aria-expanded", "true");
    expect(pin).toBeChecked();
    expect(screen.getAllByRole("button", { name: /^Packet details:/ })).toHaveLength(6);
  });

  it("rechecks age on the shared minute tick without removing retained packet eligibility or pinned paths", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    let view: ReturnType<typeof render> | undefined;
    try {
      vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
      const contact = { ...liveData.contacts[0]!, position: [24, 56] as [number, number], heardAt: Date.now() - 21 * 86_400_000 + 30_000 };
      const data = { ...liveData, contacts: [contact], messages: [{ ...liveData.messages[0]!, senderId: contact.id }], paths: [{ ...testData.paths[0]!, key: "live:rx" }] };
      view = render(<MeshlogPage data={data} />);
      const map = mapBoundary.instances[0]!; act(() => map.emit("load"));
      const pin = screen.getByRole("checkbox", { name: "Map path · Unknown sender · 12:00:00" });
      fireEvent.click(pin);
      const key = flowBoundary.mock.lastCall![0].resetKey;
      expect(map.data["meshlog-nodes"]!.features).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(map.data["meshlog-nodes"]!.features).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "Node Detail: Real node" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Packet details:/ })).toBeInTheDocument();
      expect(pin).toBeChecked(); expect(map.data["pp-lines"]!.features).toHaveLength(1);
      expect(flowBoundary.mock.lastCall![0].resetKey).toBe(key);
      expect([...flowBoundary.mock.lastCall![0].visibleReportKeys]).toEqual(["live:rx"]);
    } finally { view?.unmount(); vi.useRealTimers(); }
  });

  it("uses a searchable multi-select for node types, preserving search and sort while filtering contacts, packets and markers", () => {
    render(<MeshlogPage />);
    const map = mapBoundary.instances[0]!;
    act(() => map.emit("load"));
    const contacts = screen.getByRole("region", { name: "Nodes" });
    expect(within(contacts).queryByRole("checkbox", { name: "Companion" })).not.toBeInTheDocument();
    expect(within(contacts).getByRole("combobox", { name: /^Node type/ })).toHaveTextContent("All · 4");
    const nameSort = screen.getByRole("button", { name: "Name", exact: true });
    fireEvent.click(nameSort);
    const search = screen.getByRole("searchbox", { name: "Search" });
    fireEvent.change(search, { target: { value: "river" } });
    const dialog = openNodeTypes();
    expect(within(dialog).getAllByRole("option", { selected: true })).toHaveLength(4);
    expect(within(dialog).queryByRole("option", { name: "Unknown" })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Search types" }), { target: { value: "comp" } });
    expect(within(dialog).getAllByRole("option")).toHaveLength(1);
    expect(within(dialog).getByRole("option", { name: "Companion" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(dialog).getByRole("option", { name: "Companion" }));
    expect(map.data["meshlog-nodes"]!.features).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" })).not.toBeInTheDocument();
    expect(search).toHaveValue("river");
    expect(nameSort).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: "None", exact: true }));
    expect(within(contacts).queryByRole("button", { name: /^Node Detail:/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "All", exact: true }));
    closeNodeTypes();
    expect(map.data["meshlog-nodes"]!.features).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" })).toBeInTheDocument();
    expect(search).toHaveValue("river");
    fireEvent.click(screen.getByRole("button", { name: "Clear · Node filters" }));
    expect(search).toHaveValue("");
    expect(nameSort).toHaveAttribute("aria-pressed", "true");
    expect(within(contacts).getByRole("combobox", { name: /^Node type/ })).toHaveTextContent("All · 4");
    expect(within(contacts).getAllByRole("button", { name: /^Node Detail:/ })).toHaveLength(12);
  });

  it("offers Unknown only when the directory contains it and includes arriving types only under default All", () => {
    const known = { ...liveData.contacts[0]!, id: "known", name: "Known companion", kind: "client" as const };
    const unknown = { ...liveData.contacts[0]!, id: "unknown", name: "Unknown role" };
    const initial = { ...liveData, contacts: [known], messages: [{ ...liveData.messages[0]!, senderId: known.id }] };
    const view = render(<MeshlogPage data={initial} />);
    const dialog = openNodeTypes();
    expect(within(dialog).getAllByRole("option", { selected: true })).toHaveLength(4);
    const next = { ...initial, contacts: [known, unknown], messages: [...initial.messages, { ...initial.messages[0]!, id: "new", senderId: unknown.id, text: "Unknown-role packet" }] };
    view.rerender(<MeshlogPage data={next} />);
    expect(within(dialog).getByRole("option", { name: "Unknown" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Unknown-role packet")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "None", exact: true }));
    expect(screen.queryByText("Unknown-role packet")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Unknown" }));
    expect(screen.getByText("Unknown-role packet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Node Detail: Known companion" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "None", exact: true }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Companion" }));
    view.rerender(<MeshlogPage data={initial} />);
    view.rerender(<MeshlogPage data={next} />);
    expect(within(dialog).getByRole("option", { name: "Unknown" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByText("Unknown-role packet")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "All", exact: true }));
    closeNodeTypes();
    expect(screen.getByText("Unknown-role packet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear · Node filters" })).not.toBeInTheDocument();
  });

  it("restores expanded contacts, packet reports and pins after node-type filtering without replacing the map", () => {
    render(<MeshlogPage />);
    const packetName = "Packet details: GRP_TXT · River Walker · 10:23:52";
    const contactName = "Node Detail: River Walker";
    fireEvent.click(screen.getByRole("button", { name: packetName }));
    fireEvent.click(screen.getByRole("button", { name: contactName }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" }));
    const dialog = openNodeTypes();
    fireEvent.click(within(dialog).getByRole("option", { name: "Companion" }));
    expect(screen.queryByRole("button", { name: packetName })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: contactName })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Companion" }));
    closeNodeTypes();
    expect(screen.getByRole("button", { name: packetName })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: contactName })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" })).toBeChecked();
    expect(mapBoundary.instances).toHaveLength(1);
  });

  it("supports node-type keyboard selection and existing Lithuanian labels without losing the selection", async () => {
    render(<MeshlogPage />);
    const dialog = openNodeTypes();
    fireEvent.click(within(dialog).getByRole("button", { name: "None", exact: true }));
    const input = within(dialog).getByRole("combobox", { name: "Search types" });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: "Companion" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => expect(input).toHaveAttribute("aria-activedescendant", within(dialog).getByRole("option", { name: "Companion" }).id));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(within(dialog).getByRole("option", { name: "Companion" })).toHaveAttribute("aria-selected", "true");
    closeNodeTypes();
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^Node type/ })).toHaveFocus());
    await act(async () => { await i18n.changeLanguage("lt"); });
    fireEvent.click(screen.getByRole("combobox", { name: new RegExp(`^${i18n.t("map.nodeTypeLabel")}`) }));
    const translated = screen.getByRole("dialog", { name: i18n.t("map.nodeTypeLabel") });
    expect(within(translated).getByRole("combobox", { name: i18n.t("meshlog.filters.searchTypes") })).toBeInTheDocument();
    expect(within(translated).getByRole("option", { name: i18n.t("nodeTypes.companion") })).toHaveAttribute("aria-selected", "true");
    expect(within(translated).getByRole("option", { name: i18n.t("nodeTypes.repeater") })).toHaveAttribute("aria-selected", "false");
  });
  it("bounds contacts as well as packets and retains row expansion/pins through filtering", () => {
    const data = { ...testData, contacts: [...testData.contacts, ...Array.from({ length: 857 }, (_, index) => ({ ...liveData.contacts[0]!, id: `extra-${index}`, name: `Extra ${index}` }))] };
    render(<MeshlogPage data={data} />);
    expect(screen.getAllByRole("button", { name: /^Node Detail:/ }).length).toBeLessThanOrEqual(40);
    const packetName = "Packet details: GRP_TXT · River Walker · 10:23:52";
    fireEvent.click(screen.getByRole("button", { name: packetName }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" }));
    const dialog = openTypes();
    fireEvent.click(within(dialog).getByRole("button", { name: "None" }));
    expect(screen.queryByRole("button", { name: packetName })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "All" }));
    closeTypes();
    expect(screen.getByRole("button", { name: packetName })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Clear paths" }));
    expect(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: packetName })).toHaveAttribute("aria-expanded", "true");
  });

  it("renders unknown-channel history provisionally for inspection without claiming paths or live-filter matches", () => {
    const visible = vi.fn(), inspect = vi.fn();
    const known = { ...liveData.messages[0]!, id: "known", senderName: "Known sender", kind: "channel" as const, payloadType: PayloadType.GROUP_TEXT, channelId: "hash-one", channel: "Field" };
    const pending = { ...known, id: "pending", senderName: "Pending sender", channelId: undefined, channel: undefined, detailLoading: false };
    const data = { ...liveData, channels: [...liveData.channels, { id: "hash-two", name: "Other", keyKnown: true }], messages: [known] };
    const view = render(<MeshlogPage data={data} onVisiblePacketsChange={visible} onInspectPacket={inspect} />);
    fireEvent.click(within(openChannels()).getByRole("option", { name: "#Other" }));
    closeChannels();
    const resetKey = flowBoundary.mock.lastCall![0].resetKey;
    const withPending = { ...data, messages: [known, pending], paths: [{ ...testData.paths[0]!, key: "pending:rx" }] };
    view.rerender(<MeshlogPage data={withPending} onVisiblePacketsChange={visible} onInspectPacket={inspect} />);
    const packet = screen.getByRole("button", { name: "Packet details: GRP_TXT · Pending sender · 12:00:00" });
    const map = mapBoundary.instances[0]!;
    act(() => map.emit("load"));
    const pathCount = () => Object.values(map.data).flatMap(source => source.features).filter(feature => feature.geometry.type === "LineString").length;
    expect(within(packet).getByText("Channel unknown")).toBeInTheDocument();
    expect(within(packet).queryByRole("status")).not.toBeInTheDocument();
    expect(visible).toHaveBeenLastCalledWith(["known", "pending"]);
    expect(screen.queryByRole("checkbox", { name: "Map path · Pending sender · 12:00:00" })).not.toBeInTheDocument();
    fireEvent.pointerOver(packet);
    expect(inspect).toHaveBeenLastCalledWith("pending");
    expect(pathCount()).toBe(0);
    expect([...flowBoundary.mock.lastCall![0].visibleReportKeys]).toEqual(["known:rx"]);
    fireEvent.click(packet);
    expect(screen.queryByRole("checkbox", { name: "Map path · Real observer · Pending sender · 12:00:00" })).not.toBeInTheDocument();
    view.rerender(<MeshlogPage data={{ ...withPending, messages: [known, { ...pending, detailLoading: true }] }} onVisiblePacketsChange={visible} onInspectPacket={inspect} />);
    expect(within(packet).getByRole("status")).toHaveTextContent("Loading…");
    view.rerender(<MeshlogPage data={{ ...withPending, messages: [known, { ...pending, channelId: "hash-one", channel: "Field" }] }} onVisiblePacketsChange={visible} onInspectPacket={inspect} />);
    expect(within(packet).queryByText("Channel unknown")).not.toBeInTheDocument();
    expect(within(packet).getByText("#Field")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Map path · Pending sender · 12:00:00" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Map path · Pending sender · 12:00:00" }));
    expect(pathCount()).toBe(1);
    expect([...flowBoundary.mock.lastCall![0].visibleReportKeys]).toEqual(["known:rx", "pending:rx"]);
    expect(flowBoundary.mock.lastCall![0].resetKey).toBe(resetKey);
    view.rerender(<MeshlogPage data={{ ...withPending, messages: [known, { ...pending, channelId: "hash-two", channel: "Other" }] }} onVisiblePacketsChange={visible} onInspectPacket={inspect} />);
    expect(screen.queryByRole("button", { name: "Packet details: GRP_TXT · Pending sender · 12:00:00" })).not.toBeInTheDocument();
    expect(pathCount()).toBe(0);
  });

  it("refreshes history in place without changing any active filters or pinned paths", () => {
    const refreshHistory = vi.fn();
    const state = { ...testLiveState, gap: true, hasOlder: true, refreshHistory };
    const data = { ...testData, scopes: ["#bc", "#north"], messages: testData.messages.map(message => ({ ...message, scope: "#bc" })) };
    const view = render(<MeshlogPage data={data} liveState={state} />);
    const map = mapBoundary.instances[0]!; act(() => map.emit("load"));
    const observers = openObservers();
    fireEvent.click(within(observers).getByRole("button", { name: "None" }));
    fireEvent.click(within(observers).getByRole("option", { name: data.reporters.find(reporter => reporter.id === "old-town")!.name }));
    closeObservers();
    const types = openTypes();
    fireEvent.click(within(types).getByRole("button", { name: "None" }));
    fireEvent.click(within(types).getByRole("option", { name: "GRP_TXT" }));
    closeTypes();
    const channels = openChannels();
    fireEvent.click(within(channels).getByRole("button", { name: "None" }));
    const channel = data.channels.find(channel => channel.id === data.messages.find(message => message.id === "m02")!.channelId)!;
    fireEvent.click(within(channels).getByRole("option", { name: `#${channel.name.replace(/^#/, "")}` }));
    closeChannels();
    const scopes = openScope();
    fireEvent.click(within(scopes).getByRole("button", { name: "None" }));
    fireEvent.click(within(scopes).getByRole("option", { name: "#bc" }));
    closeScope();
    const nodeTypes = openNodeTypes();
    fireEvent.click(within(nodeTypes).getByRole("button", { name: "None" }));
    fireEvent.click(within(nodeTypes).getByRole("option", { name: "Companion" }));
    closeNodeTypes();
    const search = screen.getByRole("searchbox", { name: "Search" });
    fireEvent.change(search, { target: { value: "River Walker" } });
    const pin = screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" });
    fireEvent.click(pin);
    const resetKey = flowBoundary.mock.lastCall![0].resetKey;
    fireEvent.click(screen.getByRole("button", { name: "Refresh packets" }));
    expect(refreshHistory).toHaveBeenCalledOnce();
    for (const historyRefreshing of [true, false]) {
      view.rerender(<MeshlogPage data={{ ...data }} liveState={{ ...state, historyRefreshing }} />);
      expect(flowBoundary.mock.lastCall![0].resetKey).toBe(resetKey);
      expect(search).toHaveValue("River Walker");
      expect(pin).toBeChecked();
      expect(screen.getByRole("button", { name: "Refresh packets" })).toHaveAttribute("aria-busy", String(historyRefreshing));
      expect(screen.getByRole("button", { name: "Load older packets" })).toHaveProperty("disabled", historyRefreshing);
      expect(screen.getByRole("alert")).toHaveTextContent("Packets · Data unavailable");
      expect(mapBoundary.instances).toHaveLength(1);
    }
  });

  it("keeps live animation resets tied to explicit filters, not pins, publications or incoming messages", () => {
    const batch = { sequence: 1, observations: [] };
    const view = render(<MeshlogPage liveBatch={batch} />);
    const current = () => flowBoundary.mock.lastCall![0] as { resetKey: string; batch: typeof batch; visibleReportKeys: ReadonlySet<string> };
    const baseline = current().resetKey;
    expect(current().batch).toBe(batch);
    fireEvent.click(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" }));
    expect(current().resetKey).toBe(baseline);
    view.rerender(<MeshlogPage liveBatch={{ sequence: 2, observations: [] }} data={{ ...testData, messages: [...testData.messages, { ...testData.messages[0]!, id: "UPPERCASE" }] }} />);
    expect(current().resetKey).toBe(baseline);
    expect([...current().visibleReportKeys].some(key => key.startsWith("uppercase:"))).toBe(true);
    fireEvent.click(within(openTypes()).getByRole("button", { name: "None" }));
    expect(current().resetKey).not.toBe(baseline);
    expect(current().visibleReportKeys.size).toBe(0);
  });

  it("excludes unresolved channel packets from explicit channel selections without hiding non-channel packets", () => {
    const data = { ...liveData, messages: [
      { ...liveData.messages[0]!, id: "unknown-channel", kind: "channel" as const, payloadType: PayloadType.GROUP_TEXT, text: "Unresolved channel" },
      { ...liveData.messages[0]!, id: "non-channel", channelId: "unrelated", text: "Other protocol" },
    ] };
    render(<MeshlogPage data={data} />);
    expect(screen.getByText("Unresolved channel")).toBeInTheDocument();
    fireEvent.click(within(openChannels()).getByRole("button", { name: "None" }));
    expect(screen.queryByText("Unresolved channel")).not.toBeInTheDocument();
    expect(screen.getByText("Other protocol")).toBeInTheDocument();
    const keys = flowBoundary.mock.lastCall![0].visibleReportKeys as ReadonlySet<string>;
    expect([...keys]).toEqual(["non-channel:rx"]);
  });

  it("wires lazy contact inspection and local retry without fetching contacts on initial render", () => {
    const inspect = vi.fn(), retry = vi.fn();
    render(<MeshlogPage data={{ ...liveData, contacts: [{ ...liveData.contacts[0]!, detailError: true }] }} onInspectContact={inspect} onRetryContact={retry} />);
    expect(inspect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Node Detail: Real node" }));
    expect(inspect).toHaveBeenCalledExactlyOnceWith("node");
    fireEvent.click(screen.getByRole("button", { name: "Retry · Real node" }));
    expect(retry).toHaveBeenCalledExactlyOnceWith("node");
  });

  it("replaces unknown sender placeholders with actual muted endpoints and exposes full keys on keyboard focus", async () => {
    const originator = "abcdef12".repeat(8);
    const target = "123456";
    const message = { ...liveData.messages[0]!, senderUnknown: true, originator, target };
    const view = render(<MeshlogPage data={{ ...liveData, messages: [message] }} />);
    const packet = screen.getByRole("button", { name: "Packet details: Encrypted 0x7f · Unknown sender · 12:00:00" });
    const endpoints = packet.querySelector(".meshlog-packet-endpoints")!;
    expect([...endpoints.querySelectorAll("code")].map(code => code.textContent)).toEqual(["abcdef12", "123456"]);
    expect(within(packet).queryByText("Unknown sender")).not.toBeInTheDocument();
    expect(packet).toHaveAccessibleDescription(new RegExp(`Originator: ${originator}.*Target: ${target}`));
    expect(packet.querySelector("button, input, a, [tabindex]")).toBeNull();
    expect(meshlogStyles).toMatch(/\.meshlog-packet-endpoints\s*\{[^}]*color:\s*var\(--color-text-muted\)/);
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => packet.focus());
    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText(originator, { selector: "code" })).toBeInTheDocument();
    expect(within(tooltip).getByText(target, { selector: "code" })).toBeInTheDocument();
    fireEvent.keyDown(packet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(packet).toHaveFocus();
    view.unmount();
  });

  it("does not classify a real chat or advertisement name of Unknown as an unknown sender", () => {
    const messages = [
      { ...liveData.messages[0]!, id: "chat", senderName: "Unknown", senderUnknown: false, kind: "direct" as const, payloadType: PayloadType.TEXT, originator: "ab", target: "cd", text: "Named sender message" },
      { ...liveData.messages[0]!, id: "advert", senderName: "Unknown", senderUnknown: false, kind: "advertisement" as const, payloadType: PayloadType.ADVERT, originator: "ab" },
    ];
    render(<MeshlogPage data={{ ...liveData, messages }} />);
    const chat = screen.getByRole("button", { name: "Packet details: TXT_MSG · Unknown · 12:00:00" });
    expect(chat).toHaveTextContent("<Unknown> Named sender message");
    expect(chat.querySelector(".meshlog-packet-endpoints")).toBeNull();
    const advert = screen.getByRole("button", { name: "Packet details: ADVERT · Unknown · 12:00:00" });
    expect(within(advert).getByText("Unknown")).toHaveClass("meshlog-name");
    expect(advert.querySelector(".meshlog-packet-endpoints")).toBeNull();
  });

  it("can hydrate partial unknown endpoints without replacing the focused packet trigger", () => {
    const message = { ...liveData.messages[0]!, senderUnknown: true, text: "Opaque data" };
    const view = render(<MeshlogPage data={{ ...liveData, messages: [message] }} />);
    const packet = screen.getByRole("button", { name: /Packet details:/ });
    act(() => packet.focus());
    view.rerender(<MeshlogPage data={{ ...liveData, messages: [{ ...message, target: "7f" }] }} />);
    expect(screen.getByRole("button", { name: /Packet details:/ })).toBe(packet);
    expect(packet).toHaveFocus();
    expect(within(packet).queryByText("Unknown sender")).not.toBeInTheDocument();
    expect(packet.querySelector(".meshlog-packet-endpoints code")).toHaveTextContent("7f");
    expect(packet).toHaveAccessibleDescription(/Target: 7f/);
    expect(packet).not.toHaveAccessibleDescription(/Originator/);
    expect(within(packet).getByText("Opaque data")).toBeInTheDocument();
  });

  it("adds available endpoints to an undecoded protocol row without discarding a known sender name", () => {
    const message = { ...liveData.messages[0]!, senderName: "Known relay", senderUnknown: false, payloadType: PayloadType.ACK, originator: "ab", target: "1234" };
    render(<MeshlogPage data={{ ...liveData, messages: [message] }} />);
    const packet = screen.getByRole("button", { name: "Packet details: ACK · Known relay · 12:00:00" });
    expect(within(packet).getByText("Known relay")).toHaveClass("meshlog-name");
    expect([...packet.querySelectorAll(".meshlog-packet-endpoints code")].map(code => code.textContent)).toEqual(["ab", "1234"]);
  });

  it("omits unavailable path controls without losing descriptions and adds enabled pins after hydration", () => {
    const view = render(<MeshlogPage data={liveData} />);
    const packet = screen.getByRole("button", { name: /Packet details:/ });
    expect(screen.queryByRole("checkbox", { name: "Map path · Unknown sender · 12:00:00" })).not.toBeInTheDocument();
    expect(packet).toHaveAccessibleDescription(/No resolved path to map/);
    fireEvent.click(packet);
    expect(screen.queryByRole("checkbox", { name: "Map path · Real observer · Unknown sender · 12:00:00" })).not.toBeInTheDocument();
    expect(document.getElementById("meshlog-no-path-live-rx")).toHaveTextContent("No resolved path to map");
    expect(packet.closest(".meshlog-message-main")).not.toHaveAttribute("data-path-available");
    view.rerender(<MeshlogPage data={{ ...liveData, paths: [{ ...testData.paths[0]!, key: "live:rx" }] }} />);
    expect(screen.getByRole("checkbox", { name: "Map path · Unknown sender · 12:00:00" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Map path · Real observer · Unknown sender · 12:00:00" })).toBeEnabled();
    expect(packet.closest(".meshlog-message-main")).toHaveAttribute("data-path-available", "true");
  });

  it("offers all 13 protocol types and independently filters payloads sharing the same message category", () => {
    const data = { ...liveData, messages: [
      { ...liveData.messages[0]!, id: "text", kind: "channel" as const, payloadType: PayloadType.GROUP_TEXT, channel: "Field", channelId: "hash-one", text: "Group text payload" },
      { ...liveData.messages[0]!, id: "data", kind: "channel" as const, payloadType: PayloadType.GROUP_DATA, channel: "Field", channelId: "hash-one", text: "Group data payload" },
      { ...liveData.messages[0]!, id: "ack", payloadType: PayloadType.ACK, text: "Acknowledgement payload" },
      { ...liveData.messages[0]!, id: "path", payloadType: PayloadType.PATH, text: "Path payload" },
    ] };
    render(<MeshlogPage data={data} />);
    const dialog = openTypes();
    expect(within(dialog).getAllByRole("option", { selected: true })).toHaveLength(13);
    expect(within(dialog).getAllByRole("option").map(option => option.getAttribute("aria-label"))).toEqual(Object.values(PAYLOAD_TYPE_NAMES));
    expect(within(dialog).getByRole("option", { name: "GRP_DATA" }).querySelector(".meshlog-packet-type-badge > span")).toHaveClass("text-secondary");
    expect(within(dialog).getByRole("option", { name: "ADVERT" }).querySelector(".meshlog-packet-type-badge > span")).toHaveClass("text-green");
    const search = within(dialog).getByRole("combobox", { name: "Search types" });
    fireEvent.change(search, { target: { value: "0x6" } });
    expect(within(dialog).getAllByRole("option")).toHaveLength(1);
    expect(within(dialog).getByRole("option", { name: "GRP_DATA" })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "None" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "GRP_DATA" }));
    expect(screen.getByText("Group data payload")).toBeInTheDocument();
    expect(screen.queryByText("Group text payload")).not.toBeInTheDocument();
    expect(screen.queryByText("Acknowledgement payload")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "ACK" }));
    expect(screen.getByText("Acknowledgement payload")).toBeInTheDocument();
    expect(screen.queryByText("Path payload")).not.toBeInTheDocument();
    closeTypes();
    expect(screen.getByRole("combobox", { name: /^Packet types/ }).querySelector(".meshlog-packet-type-badge > span")).toHaveTextContent("ACK");
    const row = screen.getByRole("button", { name: "Packet details: GRP_DATA · Unknown sender · 12:00:00" });
    expect(within(row).getByText("GRP_DATA").closest(".meshlog-packet-type-badge")).not.toBeNull();
    expect(within(row).getByText("#Field")).toBeInTheDocument();
  });

  it("keeps observed unknown codes selectable by numeric identity and preserves all versus snapshot semantics", () => {
    const known = { ...liveData.messages[0]!, id: "known", payloadType: PayloadType.GROUP_TEXT, text: "Known wire type" };
    const view = render(<MeshlogPage data={{ ...liveData, messages: [known] }} />);
    const dialog = openTypes();
    view.rerender(<MeshlogPage data={{ ...liveData, messages: [known, { ...liveData.messages[0]!, text: "Future wire type" }] }} />);
    expect(within(dialog).getByRole("option", { name: "Encrypted 0x7f" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Future wire type")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "None" }));
    expect(screen.queryByText("Future wire type")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Encrypted 0x7f" }));
    const next = { ...liveData, messages: [known, { ...liveData.messages[0]!, text: "Future wire type" }, { ...liveData.messages[0]!, id: "reserved", payloadType: 14, typeLabel: undefined, text: "Reserved wire type" }] };
    view.rerender(<MeshlogPage data={next} />);
    expect(within(dialog).getByRole("option", { name: "Unknown 14" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByText("Reserved wire type")).not.toBeInTheDocument();
    expect(screen.queryByText("Known wire type")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "All" }));
    expect(screen.getByText("Reserved wire type")).toBeInTheDocument();
    closeTypes();
    expect(screen.getByRole("button", { name: "Packet details: Unknown 14 · Unknown sender · 12:00:00" })).toBeInTheDocument();
    fireEvent.click(within(openTypes()).getByRole("option", { name: "GRP_TXT" }));
    closeTypes();
    expect(screen.queryByText("Known wire type")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear · Packet filters" }));
    expect(screen.getByText("Known wire type")).toBeInTheDocument();
    view.rerender(<MeshlogPage data={{ ...next, messages: [...next.messages, { ...known, id: "later", payloadType: 13, typeLabel: undefined, text: "After type reset" }] }} />);
    expect(screen.getByText("After type reset")).toBeInTheDocument();
  });

  describe("transport scope selection", () => {
    const scopedData = {
      ...liveData, scopes: ["#bc", "#north", "#directory"],
      messages: [
        { ...liveData.messages[0]!, id: "bc", scope: "#bc", kind: "channel" as const, payloadType: PayloadType.GROUP_TEXT, channelId: "hash-one", text: "BC payload" },
        { ...liveData.messages[0]!, id: "north", scope: "#north", kind: "advertisement" as const, payloadType: PayloadType.ADVERT, text: "North payload" },
        { ...liveData.messages[0]!, id: "missing", text: "Unknown scope payload" },
      ],
    };

    it("offers directory and retained-packet scopes plus no known scope, combining choices with existing filters", () => {
      render(<MeshlogPage data={scopedData} />);
      const dialog = openScope();
      expect(within(dialog).getAllByRole("option", { selected: true })).toHaveLength(4);
      expect(within(dialog).getByRole("option", { name: "no known scope" })).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "None" }));
      expect(screen.queryByText("BC payload")).not.toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("option", { name: "#bc" }));
      expect(screen.getByText("BC payload")).toBeInTheDocument();
      expect(screen.queryByText("North payload")).not.toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("option", { name: "#north" }));
      expect(screen.getByText("North payload")).toBeInTheDocument();
      expect(screen.queryByText("Unknown scope payload")).not.toBeInTheDocument();
      closeScope();
      const observers = openObservers();
      fireEvent.click(within(observers).getByRole("button", { name: "None" }));
      expect(screen.queryByText("BC payload")).not.toBeInTheDocument();
      fireEvent.click(within(observers).getByRole("option", { name: "Real observer" }));
      expect(screen.getByText("BC payload")).toBeInTheDocument();
      expect(screen.getByText("North payload")).toBeInTheDocument();
      closeObservers();
      const types = openTypes();
      fireEvent.click(within(types).getByRole("button", { name: "None" }));
      fireEvent.click(within(types).getByRole("option", { name: "GRP_TXT" }));
      closeTypes();
      expect(screen.getByText("BC payload")).toBeInTheDocument();
      expect(screen.queryByText("North payload")).not.toBeInTheDocument();
      fireEvent.click(within(openChannels()).getByRole("button", { name: "None" }));
      closeChannels();
      expect(screen.queryByText("BC payload")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Node Detail: Real node" })).toBeInTheDocument();
      expect(within(openScope()).getAllByRole("option")).toHaveLength(4);
      closeScope();
      fireEvent.click(screen.getByRole("button", { name: "Clear · Packet filters" }));
      const missing = openScope();
      fireEvent.click(within(missing).getByRole("button", { name: "None" }));
      fireEvent.click(within(missing).getByRole("option", { name: "no known scope" }));
      expect(screen.getByText("Unknown scope payload")).toBeInTheDocument();
      expect(screen.queryByText("BC payload")).not.toBeInTheDocument();
      expect(screen.queryByText("North payload")).not.toBeInTheDocument();
    });

    it("includes async names only in default all and never traps empty or explicit selections", () => {
      const initial = { ...scopedData, scopes: [], messages: scopedData.messages.slice(0, 1) };
      const view = render(<MeshlogPage data={{ ...initial, messages: [] }} />);
      const dialog = openScope();
      expect(within(dialog).getAllByRole("option")).toHaveLength(1);
      view.rerender(<MeshlogPage data={initial} />);
      expect(within(dialog).getByRole("option", { name: "#bc" })).toHaveAttribute("aria-selected", "true");
      expect(within(dialog).getByRole("option", { name: "no known scope" })).toHaveAttribute("aria-selected", "true");
      view.rerender(<MeshlogPage data={scopedData} />);
      expect(within(dialog).getByRole("option", { name: "#north" })).toHaveAttribute("aria-selected", "true");
      fireEvent.click(within(dialog).getByRole("button", { name: "None" }));
      const next = { ...scopedData, scopes: [...scopedData.scopes, "#new", "#bc"], messages: [...scopedData.messages, { ...scopedData.messages[0]!, id: "new", scope: "#new", text: "New scope payload" }] };
      view.rerender(<MeshlogPage data={next} />);
      expect(within(dialog).getByRole("option", { name: "#new" })).toHaveAttribute("aria-selected", "false");
      expect(screen.queryByText("New scope payload")).not.toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("option", { name: "#bc" }));
      view.rerender(<MeshlogPage data={{ ...next, scopes: [...next.scopes, "#later"] }} />);
      expect(within(dialog).getByRole("option", { name: "#later" })).toHaveAttribute("aria-selected", "false");
      expect(within(dialog).getAllByRole("option", { name: "#bc" })).toHaveLength(1);
      expect(screen.getByText("BC payload")).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "All" }));
      expect(screen.getByText("New scope payload")).toBeInTheDocument();
      expect(within(dialog).getByRole("option", { name: "#later" })).toHaveAttribute("aria-selected", "true");
    });

    it("preserves exact case and hash identities while searching and selecting with the keyboard", async () => {
      render(<MeshlogPage data={{ ...scopedData, scopes: ["#bc", "#BC", "bc"], messages: [
        { ...scopedData.messages[0]!, scope: "#bc", text: "Lowercase scope" },
        { ...scopedData.messages[0]!, id: "upper", scope: "#BC", text: "Uppercase scope" },
      ] }} />);
      fireEvent.click(within(openScope()).getByRole("button", { name: "None" }));
      closeScope();
      const trigger = screen.getByRole("combobox", { name: /^Scope/ });
      const dialog = openScope();
      const input = within(dialog).getByRole("combobox", { name: "Find a scope" });
      await waitFor(() => expect(input).toHaveFocus());
      fireEvent.change(input, { target: { value: "BC" } });
      expect(within(dialog).getAllByRole("option")).toHaveLength(3);
      const first = within(dialog).getByRole("option", { name: "#BC" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      await waitFor(() => expect(input).toHaveAttribute("aria-activedescendant", first.id));
      fireEvent.keyDown(input, { key: "Enter" });
      expect(first).toHaveAttribute("aria-selected", "true");
      expect(within(dialog).getByRole("option", { name: "#bc" })).toHaveAttribute("aria-selected", "false");
      expect(screen.getByText("Uppercase scope")).toBeInTheDocument();
      expect(screen.queryByText("Lowercase scope")).not.toBeInTheDocument();
      closeScope();
      await waitFor(() => expect(trigger).toHaveFocus());
    });

    it("restores scope-hidden pins but not expired hover previews and clears back to default all", () => {
      const data = { ...testData, messages: testData.messages.map(message => ({ ...message, scope: message.id === "m02" ? "#bc" : "#north" })) };
      const view = render(<MeshlogPage data={data} />);
      const map = mapBoundary.instances[0]!;
      act(() => map.emit("load"));
      const paths = () => Object.values(map.data).flatMap(source => source.features).filter(feature => feature.geometry.type === "LineString").map(feature => feature.properties?.key);
      fireEvent.click(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" }));
      expect(paths()).toHaveLength(2);
      const dialog = openScope();
      fireEvent.click(within(dialog).getByRole("button", { name: "None" }));
      fireEvent.click(within(dialog).getByRole("option", { name: "#north" }));
      expect(paths()).toHaveLength(0);
      closeScope();
      fireEvent.pointerOver(screen.getByRole("button", { name: "Packet details: GRP_TXT · Riga Commons · 10:21:06" }));
      expect(paths()).toHaveLength(2);
      const filter = openScope();
      fireEvent.click(within(filter).getByRole("button", { name: "None" }));
      fireEvent.click(within(filter).getByRole("option", { name: "#bc" }));
      expect(paths()).toEqual(["m02:river", "m02:old-town"]);
      fireEvent.click(within(filter).getByRole("option", { name: "#north" }));
      expect(paths()).toEqual(["m02:river", "m02:old-town"]);
      closeScope();
      expect(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" })).toBeChecked();
      fireEvent.click(screen.getByRole("button", { name: "Clear · Packet filters" }));
      expect(screen.getByRole("combobox", { name: /^Scope/ })).toHaveTextContent("All");
      view.rerender(<MeshlogPage data={{ ...data, messages: [...data.messages, { ...data.messages[0]!, id: "arrival", scope: "#new", text: "After scope clear" }] }} />);
      expect(screen.getByText("After scope clear")).toBeInTheDocument();
    });

    it("retains selected transport names when switching language", async () => {
      render(<MeshlogPage data={scopedData} />);
      const dialog = openScope();
      fireEvent.click(within(dialog).getByRole("button", { name: "None" }));
      fireEvent.click(within(dialog).getByRole("option", { name: "#bc" }));
      closeScope();
      fireEvent.click(screen.getByRole("button", { name: "Language: English" }));
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Lietuvių" })); });
      fireEvent.click(screen.getByRole("combobox", { name: /^Aprėptis/ }));
      const translated = screen.getByRole("dialog", { name: "Aprėptis" });
      expect(within(translated).getByRole("combobox", { name: "Ieškoti aprėpties" })).toBeInTheDocument();
      expect(within(translated).getByRole("option", { name: "#bc" })).toHaveAttribute("aria-selected", "true");
      expect(within(translated).getByRole("option", { name: "#north" })).toHaveAttribute("aria-selected", "false");
      expect(within(translated).getByRole("option", { name: "žinoma aprėptis nenustatyta" })).toHaveAttribute("aria-selected", "false");
      expect(screen.getByText("BC payload")).toBeInTheDocument();
      expect(screen.queryByText("North payload")).not.toBeInTheDocument();
    });
  });

  it("puts live status and language in the top bar and uses compact packet filters without a Packets heading", () => {
    render(<MeshlogPage />);
    const packets = screen.getByRole("region", { name: "Packets" });
    expect(within(packets).queryByRole("heading", { name: "Packets" })).not.toBeInTheDocument();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { level: 1, name: "MeshLog" })).toBeInTheDocument();
    expect(within(header).getByRole("link", { name: "Back to Beacon" })).toHaveAttribute("href", "/");
    expect(within(header).queryByText("Beacon")).not.toBeInTheDocument();
    expect(within(header).queryByRole("link", { name: "MeshLog" })).not.toBeInTheDocument();
    expect(within(header).getByText("LIVE")).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Language: English" })).toBeInTheDocument();
    expect(within(packets).getByRole("combobox", { name: /^Observers/ })).toHaveTextContent("All");
    expect(within(packets).getByRole("combobox", { name: /^Packet types/ })).toHaveTextContent("All · 13");
    expect(within(packets).getByRole("combobox", { name: /Select channels/ })).toBeInTheDocument();
    expect(within(packets).queryByRole("checkbox", { name: "Advert" })).not.toBeInTheDocument();
    expect(packets.querySelector(".meshlog-live-state")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nodes · Settings" })).toBeInTheDocument();
  });

  it("filters duplicate observer names by identity rather than their display label", () => {
    const reporters = ["a", "b"].map(id => ({ id, name: "Same observer", color: "#fff", publicKey: `${id}${id}112233` }));
    const messages = reporters.map(reporter => ({ ...liveData.messages[0]!, id: reporter.id, text: `From ${reporter.id}`, reports: [{ reporterId: reporter.id, time: "12:00:00", path: [] }] }));
    render(<MeshlogPage data={{ ...liveData, reporters, messages }} />);
    const dialog = openObservers();
    fireEvent.click(within(dialog).getByRole("button", { name: "None" }));
    const options = within(dialog).getAllByRole("option", { name: "Same observer" });
    expect(options[1]).toHaveAccessibleDescription("bb112233");
    fireEvent.click(options[1]!);
    expect(screen.queryByText("From a")).not.toBeInTheDocument();
    expect(screen.getByText("From b")).toBeInTheDocument();
  });

  it("keeps every known protocol option available as new wire types arrive", () => {
    const channel = { ...liveData.messages[0]!, id: "channel", kind: "channel" as const, payloadType: PayloadType.GROUP_TEXT, channelId: "hash-one", text: "Channel payload" };
    const advert = { ...liveData.messages[0]!, id: "advert", kind: "advertisement" as const, payloadType: PayloadType.ADVERT, text: "Advertisement payload" };
    const data = { ...liveData, messages: [channel, advert] };
    const view = render(<MeshlogPage data={data} />);
    const dialog = openTypes();
    expect(within(dialog).getAllByRole("option")).toHaveLength(13);
    expect(within(dialog).getAllByRole("option", { selected: true })).toHaveLength(13);
    expect(within(dialog).getByRole("option", { name: "REQ" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: "None" }));
    expect(screen.queryByText("Channel payload")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "GRP_TXT" }));
    expect(screen.getByText("Channel payload")).toBeInTheDocument();
    expect(screen.queryByText("Advertisement payload")).not.toBeInTheDocument();
    view.rerender(<MeshlogPage data={{ ...data, messages: [...data.messages, { ...liveData.messages[0]!, id: "later", text: "New unknown payload" }] }} />);
    expect(screen.queryByText("New unknown payload")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "All" }));
    expect(screen.getByText("New unknown payload")).toBeInTheDocument();
    expect(screen.getByText("Advertisement payload")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Node Detail: Real node" })).toBeInTheDocument();
    closeTypes();
    expect(screen.queryByRole("button", { name: "Clear · Packet filters" })).not.toBeInTheDocument();
  });

  it("uses the existing language preference while retaining observer, type, channel and pin selections", async () => {
    render(<MeshlogPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" }));
    const observers = openObservers();
    fireEvent.click(within(observers).getByRole("button", { name: "None" }));
    fireEvent.click(within(observers).getByRole("option", { name: "River RX" }));
    closeObservers();
    fireEvent.click(within(openTypes()).getByRole("option", { name: "ADVERT" }));
    closeTypes();
    fireEvent.click(within(openChannels()).getByRole("option", { name: "#Local" }));
    closeChannels();
    const pin = screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" });
    expect(pin).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Language: English" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Lietuvių" })); });
    expect(screen.getByRole("button", { name: "Kalba: Lietuvių" })).toBeInTheDocument();
    expect(localStorage.getItem("beacon-language")).toBe("lt");
    expect(document.documentElement.lang).toBe("lt");
    expect(pin).toBeInTheDocument();
    expect(pin).toBeChecked();
    expect(mapBoundary.instances).toHaveLength(1);

    fireEvent.click(screen.getByRole("combobox", { name: new RegExp(`^${i18n.t("filters.observers")}`) }));
    const observerDialog = screen.getByRole("dialog", { name: i18n.t("filters.observers") });
    expect(within(observerDialog).getByRole("option", { name: "River RX" })).toHaveAttribute("aria-selected", "true");
    expect(within(observerDialog).getByRole("option", { name: "Old Town RX" })).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(within(observerDialog).getByRole("combobox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("combobox", { name: new RegExp(`^${i18n.t("map.packetLog.types")}`) }));
    const typeDialog = screen.getByRole("dialog", { name: i18n.t("map.packetLog.types") });
    expect(within(typeDialog).getByRole("option", { name: "ADVERT" })).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(within(typeDialog).getByRole("combobox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("combobox", { name: new RegExp(i18n.t("meshlog.channels.select")) }));
    const channelDialog = screen.getByRole("dialog", { name: i18n.t("tabs.Channels") });
    expect(within(channelDialog).getByRole("option", { name: "#Local" })).toHaveAttribute("aria-selected", "false");
    expect(within(channelDialog).getByRole("option", { name: "#Public" })).toHaveAttribute("aria-selected", "true");
  });

  it("renders supplied unknown identities and protocol types without fixture lookups", () => {
    render(<MeshlogPage data={liveData} />);
    const packet = screen.getByRole("button", { name: "Packet details: Encrypted 0x7f · Unknown sender · 12:00:00" });
    expect(packet).toHaveTextContent("Unknown sender");
    fireEvent.click(packet);
    expect(reportFor("Real observer").querySelector(".meshlog-reporter")).toHaveTextContent("Real observer");
    expect(screen.getByText("No resolved path to map", { selector: ".meshlog-report-content span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Node Detail: Real node" })).toBeInTheDocument();
    expect(screen.queryByText(/Riga · DEMO/)).not.toBeInTheDocument();
  });

  it.each([[1, "aa"], [2, "aabb"], [3, "aabbcc"]] as const)("keeps observer names and shows %s-byte context in tooltips alongside raw path codes", async (hashSize, observerCode) => {
    const reporter = { ...liveData.reporters[0]!, publicKey: "aabbccddeeff0011", code: "aabbccdd" };
    const message = { ...liveData.messages[0]!, reports: [{ reporterId: "rx", time: "12:00:00", observerCode, hashSize, path: ["ab", "12cd", "34ef56"], pathNames: ["Hill relay", "River relay", "East relay"], pathUnavailable: true }] };
    render(<MeshlogPage data={{ ...liveData, reporters: [reporter], messages: [message] }} />);
    fireEvent.click(screen.getByRole("button", { name: /Packet details:/ }));
    const report = reportFor("Real observer");
    const badge = report.querySelector<HTMLElement>(".meshlog-reporter")!;
    expect(badge.textContent).toBe("Real observer");
    expect(report.querySelector(".meshlog-report-path")).toHaveTextContent("ab → 12cd → 34ef56");
    expect(within(report as HTMLElement).queryByText("Hill relay")).not.toBeInTheDocument();
    expect(within(report).queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => badge.focus());
    expect(within(await screen.findByRole("tooltip")).getByText(observerCode, { selector: "dd" })).toBeInTheDocument();
  });

  it("sorts observer filters by name and never replaces unknown keys with internal IDs", () => {
    render(<MeshlogPage data={{ ...liveData, reporters: [
      { id: "uuid-first", name: "Alpha observer", color: "#f00", code: "ff001122", publicKey: "ff00112233445566" },
      { id: "uuid-last", name: "Zulu observer", color: "#0f0", code: "aa", publicKey: "aa11223344556677" },
      { id: "uuid-missing", name: "Missing key", color: "#00f" },
    ] }} />);
    const dialog = openObservers();
    const options = within(dialog).getAllByRole("option");
    expect(options.map(option => option.getAttribute("aria-label"))).toEqual(["Alpha observer", "Missing key", "Zulu observer"]);
    expect(options.map(option => option.textContent)).toEqual(["Alpha observer", "Missing key", "Zulu observer"]);
    expect(within(dialog).queryByText("uuid-missing")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Zulu observer" }));
    expect(within(dialog).getByRole("option", { name: "Zulu observer" })).toHaveAttribute("aria-selected", "false");
  });

  it("opens rich report observer tooltips on keyboard focus", async () => {
    const reporter = { ...liveData.reporters[0]!, publicKey: "aabbccdd".repeat(8), code: "aabb", iata: "RIX", observerType: "repeater", status: "online" as const };
    render(<MeshlogPage data={{ ...liveData, reporters: [reporter] }} />);
    fireEvent.click(screen.getByRole("button", { name: /Packet details:/ }));
    const badge = reportFor("Real observer").querySelector<HTMLElement>(".meshlog-reporter")!;
    expect(badge).toHaveTextContent("Real observer");
    expect(badge).not.toHaveAttribute("title");
    expect(badge).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => badge.focus());
    const tooltip = await screen.findByRole("tooltip");
    expect(badge).toHaveAttribute("aria-describedby", tooltip.id);
    expect(badge).toHaveAccessibleDescription(/Real observer/);
    for (const value of ["Real observer", reporter.publicKey, "RIX", "repeater", "Online"]) expect(within(tooltip).getByText(value)).toBeInTheDocument();
    expect(tooltip).toHaveAttribute("data-slot", "tooltip-content");
    fireEvent.keyDown(badge, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(badge).toHaveFocus();
  });

  it("opens observer information on hover and omits unavailable metadata without a UUID fallback", async () => {
    render(<MeshlogPage data={liveData} />);
    fireEvent.click(screen.getByRole("button", { name: /Packet details:/ }));
    const badge = screen.getByText("Real observer", { selector: ".meshlog-reporter" });
    fireEvent.mouseEnter(badge);
    fireEvent.mouseMove(badge);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Real observer");
    expect(tooltip).not.toHaveTextContent("Public key");
    expect(tooltip).not.toHaveTextContent("Region");
    expect(tooltip).not.toHaveTextContent("Status");
    expect(tooltip).not.toHaveTextContent("Type");
    expect(tooltip).not.toHaveTextContent("rx");
    fireEvent.keyDown(badge, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("renders per-hop resolution badges with actual candidate counts and keyboard-accessible node information", async () => {
    const segments: MeshlogPathSegment[] = [
      { code: "ab", confidence: "high", nodes: [{ id: "internal-one", name: "Hill relay", publicKey: "ab".repeat(32) }] },
      { code: "12cd", confidence: "ambiguous", nodes: [{ id: "internal-two", name: "River relay", publicKey: "12cd".repeat(16) }, { id: "internal-three", name: "East relay", publicKey: "12cd" + "34".repeat(30) }] },
      { code: "34ef56", confidence: "none", nodes: [] },
      { code: "?", confidence: "high", nodes: [{ id: "internal-bad", name: "Stray candidate", publicKey: "ff".repeat(32) }] },
    ];
    const inspect = vi.fn();
    render(<MeshlogPage data={{ ...liveData, messages: [{ ...liveData.messages[0]!, reports: [{ reporterId: "rx", time: "12:00:00", path: segments.map(segment => segment.code), segments, pathUnavailable: true }] }] }} onInspectPacket={inspect} />);
    const packet = screen.getByRole("button", { name: /Packet details:/ });
    fireEvent.click(packet);
    const report = reportFor("Real observer");
    expect(within(report).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(report.querySelector(".meshlog-report-path")!.textContent).toBe("ab → 12cd → 34ef56 → ?");
    const badges = [...report.querySelectorAll<HTMLElement>(".meshlog-path-code")];
    expect(badges.map(badge => badge.getAttribute("data-state"))).toEqual(["resolved", "ambiguous", "unresolved", "unresolved"]);
    expect(badges.map(badge => badge.getAttribute("aria-label"))).toEqual(["ab · Nodes: 1", "12cd · Nodes: 2", "34ef56 · Nodes: 0", "? · Nodes: 0"]);
    expect(meshlogStyles).toMatch(/\.meshlog-path-code\[data-state="resolved"\]\s*\{\s*--meshlog-hop-color:\s*var\(--color-green\)/);
    expect(meshlogStyles).toMatch(/\.meshlog-path-code\[data-state="ambiguous"\]\s*\{\s*--meshlog-hop-color:\s*var\(--color-warn\)/);
    for (let index = 0; index < badges.length; index++) {
      const badge = badges[index]!;
      fireEvent.keyDown(document.body, { key: "Tab" });
      act(() => badge.focus());
      const tooltip = await screen.findByRole("tooltip");
      expect(badge).toHaveAttribute("aria-describedby", tooltip.id);
      const expectedNodes = index < 3 ? segments[index]!.nodes : [];
      expect(tooltip).toHaveTextContent(`Nodes: ${expectedNodes.length}`);
      for (const node of expectedNodes) {
        expect(within(tooltip).getByText(node.name!)).toBeInTheDocument();
        expect(within(tooltip).getByText(node.publicKey)).toBeInTheDocument();
      }
      expect(tooltip).not.toHaveTextContent("internal-");
      expect(tooltip).not.toHaveTextContent("Stray candidate");
      fireEvent.keyDown(badge, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
      expect(badge).toHaveFocus();
      expect(packet).toHaveAttribute("aria-expanded", "true");
      expect(within(report).queryByRole("checkbox")).not.toBeInTheDocument();
    }
    fireEvent.mouseEnter(badges[1]!);
    fireEvent.mouseMove(badges[1]!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("River relay");
  });

  it("shows only supplied live data without a demo control or sample fallback", () => {
    render(<MeshlogPage data={{ contacts: [], reporters: [], channels: [], messages: [], paths: [] }} />);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/DEMO/)).not.toBeInTheDocument();
    expect(screen.queryByText("Workshop Bench")).not.toBeInTheDocument();
    expect(screen.getByText(/Waiting for packets/)).toBeInTheDocument();
  });

  it("shows history loading and recoverable failures separately from metadata and keeps loaded rows", () => {
    const retry = vi.fn(), retryHistory = vi.fn(), loadOlder = vi.fn();
    const state = { ...testLiveState, historyLoading: true, onRetry: retry, retryHistory, loadOlder };
    const view = render(<MeshlogPage data={{ ...liveData, messages: [] }} liveState={state} />);
    expect(screen.getByText("Loading packets...")).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for packets/)).not.toBeInTheDocument();
    view.rerender(<MeshlogPage data={liveData} liveState={{ ...state, historyLoading: false, historyError: true, error: true }} />);
    expect(screen.getByRole("button", { name: /Packet details:/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry · Packets" }));
    expect(retryHistory).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<MeshlogPage data={liveData} liveState={{ ...state, historyLoading: false, hasOlder: true }} />);
    const older = screen.getByRole("button", { name: "Load older packets" });
    fireEvent.click(older);
    expect(loadOlder).toHaveBeenCalledOnce();
    view.rerender(<MeshlogPage data={liveData} liveState={{ ...state, historyLoading: false, hasOlder: true, loadingOlder: true }} />);
    expect(older).toBeDisabled();
    expect(older).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading packets...")).toBeInTheDocument();
    view.rerender(<MeshlogPage data={liveData} liveState={{ ...state, historyLoading: false }} />);
    expect(screen.queryByRole("button", { name: "Load older packets" })).not.toBeInTheDocument();
  });

  it("bounds no-layout rendered history while keeping full filter counts and twelve-hash hydration fallback", () => {
    const visible = vi.fn();
    const messages = Array.from({ length: 120 }, (_, index) => ({ ...liveData.messages[0]!, id: `history${index}`, reports: [], reportsPending: true }));
    const view = render(<MeshlogPage data={{ ...liveData, messages }} onVisiblePacketsChange={visible} />);
    expect(screen.getAllByRole("button", { name: /Packet details:/ })).toHaveLength(40);
    expect(screen.getByText("Nodes: 1 · Packets: 120")).toBeInTheDocument();
    expect(visible).toHaveBeenLastCalledWith(messages.slice(0, 12).map(message => message.id));
    fireEvent.click(within(openObservers()).getByRole("button", { name: "None" }));
    expect(visible).toHaveBeenLastCalledWith([]);
    expect(screen.queryByRole("button", { name: /Packet details:/ })).not.toBeInTheDocument();
    view.unmount();
    expect(visible).toHaveBeenLastCalledWith([]);
  });

  it("uses a single pane-scoped IntersectionObserver for actual visible hashes and disconnects on cleanup", () => {
    const instances: { callback: IntersectionObserverCallback; options?: IntersectionObserverInit; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal("IntersectionObserver", class {
      observe = vi.fn(); disconnect = vi.fn();
      constructor(public callback: IntersectionObserverCallback, public options?: IntersectionObserverInit) { instances.push(this); }
    });
    try {
      const visible = vi.fn();
      const view = render(<MeshlogPage onVisiblePacketsChange={visible} />);
      expect(instances).toHaveLength(1);
      const observer = instances[0]!;
      expect(observer.options?.root).toBe(screen.getByRole("region", { name: "Packets" }));
      const rows = observer.observe.mock.calls.map(([row]) => row as Element);
      const entry = (target: Element, isIntersecting: boolean) => ({ target, isIntersecting }) as IntersectionObserverEntry;
      act(() => observer.callback([entry(rows[0]!, true), entry(rows[1]!, false)], {} as IntersectionObserver));
      expect(visible).toHaveBeenLastCalledWith(["m01"]);
      act(() => observer.callback([entry(rows[1]!, true)], {} as IntersectionObserver));
      expect(visible).toHaveBeenLastCalledWith(["m01", "m02"]);
      act(() => observer.callback([entry(rows[0]!, false)], {} as IntersectionObserver));
      expect(visible).toHaveBeenLastCalledWith(["m02"]);
      fireEvent.pointerOver(screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" }));
      expect(instances).toHaveLength(1);
      view.unmount();
      expect(observer.disconnect).toHaveBeenCalledOnce();
      expect(visible).toHaveBeenLastCalledWith([]);
    } finally { vi.unstubAllGlobals(); }
  });

  it("prioritizes packet and report inspection on hover and expansion, including loading summaries", () => {
    const inspect = vi.fn();
    const summary = { ...liveData.messages[0]!, reportsPending: true, detailLoading: true, reports: [] };
    const view = render(<MeshlogPage data={{ ...liveData, messages: [summary] }} onInspectPacket={inspect} />);
    const packet = screen.getByRole("button", { name: /Packet details:/ });
    expect(screen.queryByRole("checkbox", { name: "Map path · Unknown sender · 12:00:00" })).not.toBeInTheDocument();
    expect(packet).toHaveAccessibleDescription(/Loading…/);
    fireEvent.pointerOver(packet);
    expect(inspect).toHaveBeenLastCalledWith("live");
    inspect.mockClear();
    fireEvent.click(packet);
    expect(inspect).toHaveBeenCalledWith("live");
    expect(screen.getByText("Loading…", { selector: ".meshlog-report-empty" })).toBeInTheDocument();
    view.rerender(<MeshlogPage data={liveData} onInspectPacket={inspect} />);
    expect(packet).toHaveAccessibleDescription(/No resolved path to map/);
    fireEvent.pointerOver(reportFor("Real observer"));
    expect(inspect).toHaveBeenLastCalledWith("live");
  });

  it("groups all historical routes from the same observer under its one pin", () => {
    const path = meshlogTestData.paths.find(path => path.key === "m02:river")!;
    render(<MeshlogPage data={{ ...testData, paths: [path, { ...path, points: [...path.points].reverse() }] }} />);
    const map = mapBoundary.instances[0]!;
    act(() => map.emit("load"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" }));
    const lines = Object.values(map.data).flatMap(source => source.features).filter(feature => feature.geometry.type === "LineString");
    expect(lines).toHaveLength(2);
    expect(lines.map(line => line.properties?.key)).toEqual(["m02:river", "m02:river"]);
  });

  it("displays, searches and sorts contacts by radio public key, never internal UUID", () => {
    const data = { ...liveData, contacts: [
      { ...liveData.contacts[0]!, id: "internal-first", name: "Zulu", publicKey: "bb11223344556677", position: [12, 50] as [number, number] },
      { ...liveData.contacts[0]!, id: "internal-last", name: "Alpha", publicKey: "aa99887766554433", position: [13, 50] as [number, number] },
      { ...liveData.contacts[0]!, id: "internal-missing", name: "No radio key" },
    ] };
    render(<MeshlogPage data={data} />);
    const zulu = screen.getByRole("button", { name: "Node Detail: Zulu" });
    expect(within(zulu).getByText("bb112233")).toHaveAttribute("title", "bb11223344556677");
    fireEvent.click(zulu);
    expect(screen.getByText("bb11223344556677")).toBeInTheDocument();
    expect(screen.queryByText("internal-first")).not.toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "Node Detail: No radio key" })).getByText("—", { selector: ".meshlog-id" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hash" }));
    const names = () => screen.getAllByRole("button", { name: /^Node Detail:/ }).map(node => node.getAttribute("aria-label"));
    expect(names()).toEqual(["Node Detail: Alpha", "Node Detail: Zulu", "Node Detail: No radio key"]);
    fireEvent.click(screen.getByRole("button", { name: /Hash/ }));
    expect(names()).toEqual(["Node Detail: Zulu", "Node Detail: Alpha", "Node Detail: No radio key"]);
    const search = screen.getByRole("searchbox", { name: "Search" });
    fireEvent.change(search, { target: { value: "AA9988" } });
    expect(names()).toEqual(["Node Detail: Alpha"]);
    fireEvent.change(search, { target: { value: "internal-last" } });
    expect(screen.queryByRole("button", { name: "Node Detail: Alpha" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    act(() => mapBoundary.instances[0]!.emit("load"));
    const titles = mapBoundary.instances[0]!.data["meshlog-nodes"]!.features.map(feature => feature.properties?.title);
    expect(titles).toContain("Zulu · bb112233");
    expect(titles).not.toContain("internal-first");
  });

  it.each([
    [1, "ab"], [2, "ab12"], [3, "ab1234"], [undefined, "ab123456"],
  ] as const)("uses observed %s-byte hash width for contact and map previews", (hashSize, preview) => {
    const publicKey = "ab1234567890cdef";
    render(<MeshlogPage data={{ ...liveData, contacts: [{
      ...liveData.contacts[0]!, id: "internal-node-uuid", name: "Relay", publicKey, hashSize, position: [12, 50],
    }] }} />);
    const node = screen.getByRole("button", { name: "Node Detail: Relay" });
    expect(within(node).getByText(preview, { selector: ".meshlog-id" })).toHaveAttribute("title", publicKey);
    fireEvent.click(node);
    expect(screen.getByText(publicKey, { selector: ".meshlog-contact-details dd" })).toBeInTheDocument();
    act(() => mapBoundary.instances[0]!.emit("load"));
    expect(mapBoundary.instances[0]!.data["meshlog-nodes"]!.features[0]!.properties?.title).toBe(`Relay · ${preview}`);
    expect(screen.queryByText("internal-node-uuid")).not.toBeInTheDocument();
  });

  it("distinguishes live metadata recovery, connection, waiting, empty region and missing coverage", () => {
    const retry = vi.fn();
    const state: MeshlogLiveState = { ...testLiveState, status: "resolving", loading: true, regionLabel: "Baltic", onRetry: retry };
    const empty = { ...liveData, messages: [] };
    const view = render(<MeshlogPage data={empty} liveState={state} />);
    expect(screen.getByText("Loading region…")).toBeInTheDocument();
    expect(screen.queryByText("Loading… · Nodes / Observers")).not.toBeInTheDocument();
    view.rerender(<MeshlogPage data={empty} liveState={{ ...state, status: "connecting", loading: false }} />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the packet stream…")).toBeInTheDocument();
    view.rerender(<MeshlogPage data={empty} liveState={{ ...state, status: "error", loading: false, error: true }} />);
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<MeshlogPage data={empty} liveState={{ ...state, status: "connected", loading: false, gap: true }} />);
    expect(screen.getByText(/Waiting for packets/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Packets · Data unavailable");
    view.rerender(<MeshlogPage data={empty} liveState={{ ...state, status: "connected", loading: false, emptyRegion: true }} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for packets/)).not.toBeInTheDocument();
  });

  it("includes async observers and channel IDs in default all but preserves explicit none and subsets", () => {
    const message = { ...liveData.messages[0]!, kind: "channel" as const, payloadType: PayloadType.GROUP_TEXT, channelId: "hash-one", channel: "Field", text: "First reception" };
    const initial = { ...liveData, messages: [message] };
    const view = render(<MeshlogPage data={{ ...initial, reporters: [], channels: [] }} />);
    // A packet may arrive before either directory, without losing its identity.
    expect(screen.getByText("First reception")).toBeInTheDocument();
    const dialog = openObservers();
    view.rerender(<MeshlogPage data={initial} />);
    expect(within(dialog).getByRole("option", { name: "Real observer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: /Select channels/ })).toHaveTextContent("All · 1");
    const next = { ...initial,
      reporters: [...initial.reporters, { id: "rx2", name: "New observer", color: "#22c55e" }],
      channels: [...initial.channels, { id: "hash-two", name: "Second", keyKnown: true }],
      messages: [...initial.messages, { ...message, id: "next", channelId: "hash-two", channel: "Second", text: "New reception", reports: [{ reporterId: "rx2", time: "12:01:00", path: [] }] }],
    };
    view.rerender(<MeshlogPage data={next} />);
    expect(within(dialog).getByRole("option", { name: "New observer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: /Select channels/ })).toHaveTextContent("All · 2");
    expect(screen.getByText("New reception")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "None" }));
    const third = { ...next, reporters: [...next.reporters, { id: "rx3", name: "Third observer", color: "#a78bfa" }] };
    view.rerender(<MeshlogPage data={third} />);
    expect(within(dialog).getByRole("option", { name: "Third observer" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByText("New reception")).not.toBeInTheDocument();
    // Directory nodes without attribution are independent of observer selection.
    expect(screen.getByRole("button", { name: "Node Detail: Real node" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Real observer" }));
    expect(screen.getByText("First reception")).toBeInTheDocument();
    expect(screen.queryByText("New reception")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "All" }));
    closeObservers();
    openChannels();
    fireEvent.click(screen.getByRole("option", { name: "#Field" }));
    expect(screen.queryByText("First reception")).not.toBeInTheDocument();
    expect(screen.getByText("New reception")).toBeInTheDocument();
    const fourth = { ...third, channels: [...third.channels, { id: "hash-three", name: "Third", keyKnown: true }] };
    view.rerender(<MeshlogPage data={fourth} />);
    expect(screen.getByRole("option", { name: "#Third" })).toHaveAttribute("aria-selected", "false");
    closeChannels();
    fireEvent.click(screen.getByRole("button", { name: "Clear · Packet filters" }));
    openChannels();
    expect(screen.getByRole("option", { name: "#Third" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("First reception")).toBeInTheDocument();
  });

  it("filters duplicate channel display names by actual channel identity", () => {
    const data = { ...liveData, channels: [{ id: "a", name: "Field", keyKnown: true }, { id: "b", name: "Field", keyKnown: false }], messages: ["a", "b"].map(id => ({ ...liveData.messages[0]!, id, kind: "channel" as const, payloadType: PayloadType.GROUP_TEXT, channelId: id, channel: "Field", text: `Message ${id}` })) };
    render(<MeshlogPage data={data} />);
    openChannels();
    fireEvent.click(screen.getAllByRole("option", { name: "#Field" })[0]!);
    expect(screen.queryByText("Message a")).not.toBeInTheDocument();
    expect(screen.getByText("Message b")).toBeInTheDocument();
  });

  it("preserves unknown report IDs and does not bracket non-chat text", () => {
    render(<MeshlogPage data={{ ...liveData, reporters: [], messages: [{ ...liveData.messages[0]!, text: "Opaque payload" }] }} />);
    const packet = screen.getByRole("button", { name: "Packet details: Encrypted 0x7f · Unknown sender · 12:00:00" });
    expect(packet).toHaveTextContent("Unknown sender Opaque payload");
    expect(within(packet).queryByText("<Unknown sender>")).not.toBeInTheDocument();
    fireEvent.click(packet);
    expect(screen.getByText("Unknown", { selector: ".meshlog-reporter" })).toBeInTheDocument();
    expect(screen.queryByText("rx", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Map path · Unknown · Unknown sender · 12:00:00" })).not.toBeInTheDocument();
    expect(document.getElementById("meshlog-no-path-live-rx")).toHaveTextContent("No resolved path to map");
  });

  it("sorts live timestamps numerically with missing values last in either direction", () => {
    render(<MeshlogPage data={{ ...liveData, contacts: [
      { ...liveData.contacts[0]!, id: "missing", name: "Missing" },
      { ...liveData.contacts[0]!, id: "old", name: "Old", heard: "23:59", heardAt: Date.now() - 2000, firstSeenAt: 50 },
      { ...liveData.contacts[0]!, id: "new", name: "New", heard: "00:01", heardAt: Date.now() - 1000, firstSeenAt: 80 },
    ] }} />);
    const nodes = () => within(screen.getByRole("region", { name: "Nodes" })).getAllByRole("button", { name: /^Node Detail:/ }).map(node => node.getAttribute("aria-label"));
    expect(nodes()).toEqual(["Node Detail: New", "Node Detail: Old", "Node Detail: Missing"]);
    fireEvent.click(screen.getByRole("button", { name: /Last seen/ }));
    expect(nodes()).toEqual(["Node Detail: Old", "Node Detail: New", "Node Detail: Missing"]);
    fireEvent.click(screen.getByRole("button", { name: "First seen" }));
    expect(nodes()).toEqual(["Node Detail: Old", "Node Detail: New", "Node Detail: Missing"]);
  });

  it("draws every live node as GeoJSON and frames real directory positions only once", () => {
    const view = render(<MeshlogMap contacts={liveData.contacts} />);
    const map = mapBoundary.instances[0]!;
    expect(map.options).toMatchObject({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
    act(() => map.emit("load"));
    expect(map.fitBounds).not.toHaveBeenCalled();
    const contacts = Array.from({ length: 5001 }, (_, index) => ({ ...liveData.contacts[0]!, id: `node${index}`, name: `Node ${index}`, position: [10 + index / 10000, 50] as [number, number] }));
    view.rerender(<MeshlogMap contacts={contacts} />);
    expect(map.data["meshlog-nodes"]!.features).toHaveLength(5001);
    expect(map.fitBounds).toHaveBeenCalledOnce();
    expect(map.fitBounds).toHaveBeenCalledWith([[10, 50], [10.5, 50]], { padding: 40, maxZoom: 13, duration: 0 });
    view.rerender(<MeshlogMap contacts={contacts.slice(-1)} framingContacts={contacts} />);
    expect(map.data["meshlog-nodes"]!.features).toHaveLength(1);
    expect(map.fitBounds).toHaveBeenCalledOnce();
    view.rerender(<MeshlogMap contacts={[...contacts, { ...contacts[0]!, id: "arrival", position: [20, 55] }]} />);
    expect(map.fitBounds).toHaveBeenCalledOnce();
    expect(document.querySelectorAll(".meshlog-marker")).toHaveLength(0);
  });

  it("uses supplied report paths rather than reconstructing fixture paths", () => {
    render(<MeshlogPage data={{ ...meshlogTestData, paths: meshlogTestData.paths.filter(path => path.key === "m02:river") }} />);
    const map = mapBoundary.instances[0]!;
    act(() => map.emit("load"));
    fireEvent.click(screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" }));
    expect(screen.queryByRole("checkbox", { name: "Map path · Old Town RX · River Walker · 10:23:52" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" }));
    const keys = Object.values(map.data).flatMap(source => source.features).filter(feature => feature.geometry.type === "LineString").map(feature => feature.properties?.key);
    expect(keys).toEqual(["m02:river"]);
  });
  it("shows the three coordinated monitoring regions", () => {
    render(<MeshlogPage />);
    expect(screen.getByRole("link", { name: "Back to Beacon" })).toHaveAttribute("href", "/");
    expect(screen.queryByText("DEMO")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Packets" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Nodes" })).toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "Filter packets" })).not.toBeInTheDocument();
    expect(screen.getByText("Morning check-in from the river path.")).toBeInTheDocument();
  });

  it("shows packet and contact disclosure indicators without changing expansion behavior", () => {
    render(<MeshlogPage />);
    const packet = screen.getByRole("button", { name: "Packet details: ADVERT · Workshop Bench · 10:12:29" });
    expect(within(packet).getByText("▸")).toHaveAttribute("aria-hidden", "true");
    expect(packet).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(packet);
    expect(packet).toHaveAttribute("aria-expanded", "true");
    const node = screen.getByRole("button", { name: "Node Detail: Workshop Bench" });
    expect(within(node).getByText("▸")).toBeInTheDocument();
  });

  it("brackets only chat senders without a colon and preserves advertisement, observer and node names", () => {
    render(<MeshlogPage />);
    const advert = screen.getByRole("button", { name: "Packet details: ADVERT · Workshop Bench · 10:12:29" });
    expect(within(advert).getByText("Workshop Bench", { exact: true })).toBeInTheDocument();
    expect(within(advert).queryByText("<Workshop Bench>")).not.toBeInTheDocument();
    const message = screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" });
    expect(within(message).getByText("River Walker", { selector: ".meshlog-sender-name" }).parentElement).toHaveTextContent("<River Walker>");
    expect(message).toHaveTextContent("<River Walker> Morning check-in from the river path.");
    expect(message).not.toHaveTextContent("<River Walker>:");
    const direct = screen.getByRole("button", { name: "Packet details: TXT_MSG · Workshop Bench · 10:19:45" });
    expect(direct).toHaveTextContent("<Workshop Bench> Test received. Thanks for checking.");
    expect(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" })).toBeInTheDocument();
    fireEvent.click(message);
    expect(screen.getByRole("checkbox", { name: "Map path · River RX · River Walker · 10:23:52" })).toBeInTheDocument();
    const node = screen.getByRole("button", { name: "Node Detail: River Walker" });
    expect(within(node).getByText("River Walker", { exact: true })).toBeInTheDocument();
    expect(within(node).queryByText("<River Walker>")).not.toBeInTheDocument();
  });

  it("separates bright chat usernames from muted angle brackets without changing inline text or labels", () => {
    expect(meshlogStyles).toMatch(/\.meshlog-sender-name\s*\{\s*color:\s*var\(--color-text-bright\);\s*\}/);
    expect(meshlogStyles).toMatch(/\.meshlog-sender-bracket\s*\{\s*color:\s*var\(--color-text-normal\);\s*\}/);
    render(<MeshlogPage />);
    for (const [label, name] of [
      ["Packet details: GRP_TXT · River Walker · 10:23:52", "River Walker"],
      ["Packet details: TXT_MSG · Workshop Bench · 10:19:45", "Workshop Bench"],
    ] as const) {
      const packet = screen.getByRole("button", { name: label });
      const username = within(packet).getByText(name, { selector: ".meshlog-sender-name" });
      const sender = username.parentElement!;
      expect(sender.tagName).toBe("SPAN");
      expect(sender).toHaveClass("meshlog-name");
      expect(username.tagName).toBe("SPAN");
      expect([...sender.children].map(child => child.textContent)).toEqual(["<", name, ">"]);
      expect(sender.children[0]).toHaveClass("meshlog-sender-bracket");
      expect(sender.children[2]).toHaveClass("meshlog-sender-bracket");
      expect(sender.textContent).toBe(`<${name}>`);
      expect(packet).not.toHaveTextContent(`<${name}>:`);
    }
    const advert = screen.getByRole("button", { name: "Packet details: ADVERT · Workshop Bench · 10:12:29" });
    expect(advert.querySelector(".meshlog-sender-name")).toBeNull();
    expect(within(advert).getByText("Workshop Bench")).toHaveClass("meshlog-name");
  });

  it("keeps channel badge colors consistent across filters, rows, language and remounts", async () => {
    const view = render(<MeshlogPage />);
    const channelFilters = openChannels();
    const publicBadge = within(channelFilters).getByText("#Public");
    const localBadge = within(channelFilters).getByText("#Local");
    const color = (badge: HTMLElement) => badge.closest<HTMLElement>(".meshlog-channel-badge")!.style.getPropertyValue("--meshlog-channel-color");
    expect(color(publicBadge)).toBe("var(--color-primary)");
    expect(color(localBadge)).toBe("var(--color-green)");
    expect(screen.getAllByText("#Public").length).toBeGreaterThan(1);
    for (const badge of screen.getAllByText("#Public")) expect(color(badge)).toBe(color(publicBadge));
    for (const badge of screen.getAllByText("#Local")) expect(color(badge)).toBe(color(localBadge));

    fireEvent.click(publicBadge);
    expect(screen.getByRole("option", { name: "#Public" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getAllByText("#Public")).toHaveLength(1);
    expect(screen.queryByText("Morning check-in from the river path.")).not.toBeInTheDocument();
    for (const badge of screen.getAllByText("#Local")) expect(color(badge)).toBe("var(--color-green)");
    fireEvent.click(publicBadge);
    closeChannels();
    const row = screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" });
    fireEvent.click(within(row).getByText("#Public"));
    expect(row).toHaveAttribute("aria-expanded", "true");

    await act(() => i18n.changeLanguage("lt"));
    for (const badge of screen.getAllByText("#Public")) expect(color(badge)).toBe("var(--color-primary)");
    view.unmount();
    render(<MeshlogPage />);
    for (const badge of screen.getAllByText("#Public")) expect(color(badge)).toBe("var(--color-primary)");
    for (const badge of screen.getAllByText("#Local")) expect(color(badge)).toBe("var(--color-green)");
  });

  it("selects combobox options without making row badges interactive", () => {
    render(<MeshlogPage />);
    openChannels();
    const option = screen.getByRole("option", { name: "#Public" });
    const badge = option.querySelector<HTMLElement>(".meshlog-channel-badge")!;
    expect(option).toHaveAttribute("aria-selected", "true");
    const initialColor = badge.style.getPropertyValue("--meshlog-channel-color");
    fireEvent.click(option);
    expect(option).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByText("Morning check-in from the river path.")).not.toBeInTheDocument();

    fireEvent.click(option);
    expect(option).toHaveAttribute("aria-selected", "true");
    expect(badge.style.getPropertyValue("--meshlog-channel-color")).toBe(initialColor);
    closeChannels();
    const row = screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" });
    expect(within(row).queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(within(row).getByText("#Public"));
    expect(row).toHaveAttribute("aria-expanded", "true");
  });

  it("pins multiple message paths independently of their disclosures and disables unavailable paths", () => {
    render(<MeshlogPage />);
    const row = screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" });
    const pin = screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" });
    expect(row).not.toContainElement(pin);
    fireEvent.click(pin);
    expect(pin).toBeChecked();
    expect(row).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(pin).toBeChecked();
    const otherPin = screen.getByRole("checkbox", { name: "Map path · Riga Commons · 10:21:06" });
    fireEvent.click(otherPin);
    expect(otherPin).toBeChecked();
    expect(pin).toBeChecked();
    fireEvent.click(pin);
    expect(pin).not.toBeChecked();
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(otherPin).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Map path · Pocket Radio · 10:16:42" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Packet details: GRP_TXT · Pocket Radio · 10:16:42" })).toHaveAccessibleDescription(/No resolved path to map/);
  });

  it("previews only the hovered observer reception and lets report pins control the packet group", () => {
    render(<MeshlogPage />);
    const map = mapBoundary.instances[0]!;
    act(() => map.emit("load"));
    const keys = () => Object.values(map.data).flatMap(source => source.features).filter(feature => feature.geometry.type === "LineString").map(feature => feature.properties?.key);
    const packet = screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" });
    const group = screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" });
    fireEvent.click(packet);
    const river = screen.getByRole("checkbox", { name: "Map path · River RX · River Walker · 10:23:52" });
    const oldTown = screen.getByRole("checkbox", { name: "Map path · Old Town RX · River Walker · 10:23:52" });
    fireEvent.pointerOver(river.closest(".meshlog-report")!);
    expect(keys()).toEqual(["m02:river"]);
    expect(group).not.toBeChecked();
    fireEvent.pointerOut(river.closest(".meshlog-report")!);
    expect(keys()).toHaveLength(0);
    fireEvent.click(river);
    expect(river).toBeChecked();
    expect(packet).toHaveAttribute("aria-expanded", "true");
    expect(group).toBePartiallyChecked();
    expect(keys()).toEqual(["m02:river"]);
    fireEvent.pointerOver(oldTown.closest(".meshlog-report")!);
    expect(keys()).toEqual(["m02:river", "m02:old-town"]);
    fireEvent.pointerOut(oldTown.closest(".meshlog-report")!);
    expect(keys()).toEqual(["m02:river"]);
    fireEvent.click(oldTown);
    expect(river).toBeChecked();
    expect(oldTown).toBeChecked();
    expect(group).toBeChecked();
    expect(group).not.toBePartiallyChecked();
    fireEvent.click(group);
    expect(river).not.toBeChecked();
    expect(oldTown).not.toBeChecked();
    expect(keys()).toHaveLength(0);
  });

  it("clears report previews on collapse without clearing pins, and unpins only after hover exits", () => {
    render(<MeshlogPage />);
    const map = mapBoundary.instances[0]!;
    act(() => map.emit("load"));
    const keys = () => Object.values(map.data).flatMap(source => source.features).filter(feature => feature.geometry.type === "LineString").map(feature => feature.properties?.key);
    const packet = screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" });
    fireEvent.click(packet);
    const river = screen.getByRole("checkbox", { name: "Map path · River RX · River Walker · 10:23:52" });
    const oldTown = screen.getByRole("checkbox", { name: "Map path · Old Town RX · River Walker · 10:23:52" });
    fireEvent.click(river);
    fireEvent.pointerOver(oldTown.closest(".meshlog-report")!);
    expect(keys()).toEqual(["m02:river", "m02:old-town"]);
    fireEvent.click(packet);
    expect(packet).toHaveAttribute("aria-expanded", "false");
    expect(keys()).toEqual(["m02:river"]);
    fireEvent.click(packet);
    const restoredRiver = screen.getByRole("checkbox", { name: "Map path · River RX · River Walker · 10:23:52" });
    expect(restoredRiver).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Map path · Old Town RX · River Walker · 10:23:52" })).not.toBeChecked();
    expect(keys()).toEqual(["m02:river"]);
    fireEvent.pointerOver(restoredRiver.closest(".meshlog-report")!);
    fireEvent.click(restoredRiver);
    expect(restoredRiver).not.toBeChecked();
    expect(keys()).toEqual(["m02:river"]);
    fireEvent.pointerOut(restoredRiver.closest(".meshlog-report")!);
    expect(keys()).toHaveLength(0);
  });

  it("selects every mappable observer from a mixed packet checkbox and explains unavailable report paths", () => {
    render(<MeshlogPage />);
    const packet = screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" });
    fireEvent.click(packet);
    const river = screen.getByRole("checkbox", { name: "Map path · River RX · River Walker · 10:23:52" });
    const oldTown = screen.getByRole("checkbox", { name: "Map path · Old Town RX · River Walker · 10:23:52" });
    const group = screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" });
    fireEvent.click(river);
    expect(group).toBePartiallyChecked();
    group.focus();
    fireEvent.click(group, { detail: 0 });
    expect(group).toHaveFocus();
    expect(group).toBeChecked();
    expect(group).not.toBePartiallyChecked();
    expect(river).toBeChecked();
    expect(oldTown).toBeChecked();
    expect(packet).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(group);
    expect(river).not.toBeChecked();
    expect(oldTown).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Packet details: GRP_TXT · Pocket Radio · 10:16:42" }));
    expect(screen.queryByRole("checkbox", { name: "Map path · River RX · Pocket Radio · 10:16:42" })).not.toBeInTheDocument();
    expect(document.getElementById("meshlog-no-path-m08-river")).toHaveTextContent("No resolved path to map");
  });

  it("restores filtered observer pins without restoring an expired report hover", async () => {
    render(<MeshlogPage />);
    const map = mapBoundary.instances[0]!;
    act(() => map.emit("load"));
    const keys = () => Object.values(map.data).flatMap(source => source.features).filter(feature => feature.geometry.type === "LineString").map(feature => feature.properties?.key);
    fireEvent.click(screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Map path · River RX · River Walker · 10:23:52" }));
    const oldTown = screen.getByRole("checkbox", { name: "Map path · Old Town RX · River Walker · 10:23:52" });
    fireEvent.pointerOver(oldTown.closest(".meshlog-report")!);
    expect(keys()).toEqual(["m02:river", "m02:old-town"]);

    const dialog = openObservers();
    const oldTownSource = within(dialog).getByRole("option", { name: "Old Town RX" });
    const riverSource = within(dialog).getByRole("option", { name: "River RX" });
    fireEvent.click(oldTownSource);
    expect(keys()).toEqual(["m02:river"]);
    expect(screen.queryByRole("checkbox", { name: "Map path · Old Town RX · River Walker · 10:23:52" })).not.toBeInTheDocument();
    fireEvent.click(oldTownSource);
    expect(keys()).toEqual(["m02:river"]);
    fireEvent.click(riverSource);
    expect(keys()).toHaveLength(0);
    fireEvent.click(riverSource);
    expect(keys()).toEqual(["m02:river"]);
    expect(screen.getByRole("checkbox", { name: "Map path · River RX · River Walker · 10:23:52" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Map path · Old Town RX · River Walker · 10:23:52" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" })).toBePartiallyChecked();
    closeObservers();
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("draws pinned demo receptions after map load and updates them immediately on unpin and filtering", async () => {
    const root = document.documentElement;
    const priorPrimary = root.style.getPropertyValue("--color-primary");
    const priorSecondary = root.style.getPropertyValue("--color-secondary");
    root.style.setProperty("--color-primary", "#3b82f6");
    root.style.setProperty("--color-secondary", "#a78bfa");
    try {
      render(<MeshlogPage />);
      const map = mapBoundary.instances[0]!;
      const features = () => Object.values(map.data).flatMap(source => source.features).filter((feature): feature is Feature<LineString> => feature.geometry.type === "LineString");
      const pin = screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" });
      fireEvent.click(pin);
      expect(features()).toHaveLength(0);
      act(() => map.emit("load"));
      expect(features()).toHaveLength(2);
      const river = features().find(feature => feature.properties?.key === "m02:river")!;
      expect(river.geometry.coordinates).toEqual([[24.087, 56.943], [24.072, 56.946]]);
      expect(river.properties?.color).toBe("#a78bfa");
      const oldTown = features().find(feature => feature.properties?.key === "m02:old-town")!;
      expect(oldTown.geometry.coordinates).toEqual([[24.087, 56.943], [24.049, 56.955], [24.105, 56.951], [24.112, 56.955]]);
      expect(oldTown.properties?.color).toBe("#3b82f6");
      // isStyleLoaded may turn false while tiles/GeoJSON are processing after
      // the initial load. That must not block subsequent pin/unpin updates.
      map.ready = false;
      const otherPin = screen.getByRole("checkbox", { name: "Map path · Riga Commons · 10:21:06" });
      fireEvent.click(otherPin);
      expect(features().map(feature => feature.properties?.key)).toEqual(expect.arrayContaining(["m02:river", "m02:old-town", "m04:old-town", "m04:north"]));
      fireEvent.click(otherPin);
      expect(features()).toHaveLength(2);

      const dialog = openObservers();
      fireEvent.click(within(dialog).getByRole("option", { name: "Old Town RX" }));
      expect(features().map(feature => feature.properties?.key)).toEqual(["m02:river"]);
      closeObservers();
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      openChannels();
      fireEvent.click(screen.getByRole("option", { name: "#Public" }));
      expect(features()).toHaveLength(0);
      fireEvent.click(screen.getByRole("option", { name: "#Public" }));
      expect(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" })).toBeChecked();
      expect(features()).toHaveLength(1);
      closeChannels();
      fireEvent.click(screen.getByRole("button", { name: "Clear · Observer filters" }));
      expect(features()).toHaveLength(2);
      fireEvent.click(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" }));
      expect(features()).toHaveLength(0);
    } finally {
      if (priorPrimary) root.style.setProperty("--color-primary", priorPrimary); else root.style.removeProperty("--color-primary");
      if (priorSecondary) root.style.setProperty("--color-secondary", priorSecondary); else root.style.removeProperty("--color-secondary");
    }
  });

  it("previews hovered receptions and retains them only while hovered or pinned", () => {
    render(<MeshlogPage />);
    const map = mapBoundary.instances[0]!;
    act(() => map.emit("load"));
    const features = () => Object.values(map.data).flatMap(source => source.features).filter((feature): feature is Feature<LineString> => feature.geometry.type === "LineString");
    const row = screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" });
    const pin = screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" });
    expect(features()).toHaveLength(0);
    fireEvent.pointerOver(row);
    expect(features()).toHaveLength(2);
    expect(pin).not.toBeChecked();
    fireEvent.pointerOut(row);
    expect(features()).toHaveLength(0);

    fireEvent.pointerOver(row);
    fireEvent.click(pin);
    fireEvent.pointerOut(row);
    expect(features()).toHaveLength(2);
    expect(pin).toBeChecked();
    fireEvent.pointerOver(row);
    fireEvent.click(pin);
    expect(pin).not.toBeChecked();
    expect(features()).toHaveLength(2);
    fireEvent.pointerOut(row);
    expect(features()).toHaveLength(0);
  });

  it("renders Beacon's colored path lines, endpoint circles and palette-aware labels", () => {
    render(<MeshlogPage />);
    const map = mapBoundary.instances[0]!;
    fireEvent.click(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" }));
    act(() => map.emit("load"));
    expect(Object.keys(map.layers)).toEqual(["meshlog-node-glow", "meshlog-nodes", "meshlog-node-observer-pips", "meshlog-node-labels", "pp-lines", "pp-nodes", "pp-node-labels"]);
    expect(map.layers["meshlog-node-labels"]).toMatchObject({ layout: { "text-font": ["Noto Sans Regular"] } });
    expect(map.layers["pp-lines"]!.paint).toEqual({ "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": 0.9 });
    expect(map.layers["pp-nodes"]!.paint).toMatchObject({
      "circle-radius": ["case", ["==", ["get", "endpoint"], "mid"], 4, 6],
      "circle-color": ["get", "color"], "circle-stroke-width": 2,
    });
    expect(map.layers["pp-node-labels"]!.paint).toMatchObject({ "text-halo-width": 1.4 });
    const points = Object.entries(map.data).filter(([id]) => id !== "meshlog-nodes").flatMap(([, source]) => source.features).filter(feature => feature.geometry.type === "Point");
    expect(points).toHaveLength(6);
    expect(points.find(feature => feature.properties?.key === "m02:river" && feature.properties?.endpoint === "end")).toMatchObject({
      geometry: { type: "Point", coordinates: [24.072, 56.946] }, properties: { title: "River RX" },
    });
  });

  it("does not restore an expired hover preview when a filtered-out row returns", () => {
    render(<MeshlogPage />);
    const map = mapBoundary.instances[0]!;
    act(() => map.emit("load"));
    const features = () => Object.values(map.data).flatMap(source => source.features).filter((feature): feature is Feature<LineString> => feature.geometry.type === "LineString");
    fireEvent.pointerOver(screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" }));
    expect(features()).toHaveLength(2);
    openChannels();
    fireEvent.click(screen.getByRole("option", { name: "#Public" }));
    expect(features()).toHaveLength(0);
    fireEvent.click(screen.getByRole("option", { name: "#Public" }));
    expect(features()).toHaveLength(0);
    expect(screen.getByRole("checkbox", { name: "Map path · River Walker · 10:23:52" })).not.toBeChecked();
  });

  it("expands each message's reports and node disclosures independently", () => {
    render(<MeshlogPage />);
    const reports = screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" });
    fireEvent.click(reports);
    expect(reports).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("checkbox", { name: "Map path · Old Town RX · River Walker · 10:23:52" }).closest(".meshlog-report")!.querySelector(".meshlog-report-path")).toHaveTextContent(oldTownPathCodes);
    const contact = screen.getByRole("button", { name: "Node Detail: Pocket Radio" });
    fireEvent.click(contact);
    expect(contact).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Data unavailable")).toBeInTheDocument();
    const secondMessage = screen.getByRole("button", { name: "Packet details: ADVERT · Old Town Rooftop · 10:24:18" });
    fireEvent.click(secondMessage);
    expect(secondMessage).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(reports);
    expect(reports).toHaveAttribute("aria-expanded", "false");
    expect(secondMessage).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("checkbox", { name: "Map path · Old Town RX · River Walker · 10:23:52" })).not.toBeInTheDocument();
    expect(contact).toHaveAttribute("aria-expanded", "true");
  });

  it("filters contacts and sender messages together, with recoverable empty results", () => {
    render(<MeshlogPage />);
    const map = mapBoundary.instances[0]!;
    act(() => map.emit("load"));
    const contactRegion = screen.getByRole("region", { name: "Nodes" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "River Walker" } });
    expect(within(contactRegion).getAllByRole("button", { name: /^Node Detail:/ })).toHaveLength(1);
    expect(map.data["meshlog-nodes"]!.features).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Packet details: ADVERT · Old Town Rooftop · 10:24:18" })).not.toBeInTheDocument();
    expect(screen.getByText("Morning check-in from the river path.")).toBeInTheDocument();
    fireEvent.click(within(openNodeTypes()).getByRole("option", { name: "Companion" }));
    closeNodeTypes();
    expect(map.data["meshlog-nodes"]!.features).toHaveLength(0);
    expect(within(contactRegion).getByText("No matches")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Packets" })).getByText("No matches")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear · Node filters" }));
    expect(within(contactRegion).getAllByRole("button", { name: /^Node Detail:/ })).toHaveLength(12);
    fireEvent.click(within(openTypes()).getByRole("option", { name: "ADVERT" }));
    closeTypes();
    expect(screen.queryByRole("button", { name: "Packet details: ADVERT · Old Town Rooftop · 10:24:18" })).not.toBeInTheDocument();
    openChannels();
    fireEvent.click(screen.getByRole("option", { name: "#Public" }));
    expect(screen.queryByText("Morning check-in from the river path.")).not.toBeInTheDocument();
    expect(screen.getByText("West bank coverage looks good near the bridge.")).toBeInTheDocument();
    closeChannels();
    fireEvent.click(screen.getByRole("button", { name: "Clear · Packet filters" }));
    expect(screen.getByText("Morning check-in from the river path.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Packet details: ADVERT · Old Town Rooftop · 10:24:18" })).toBeInTheDocument();
  });

  it("sorts contacts and reverses the active sort without changing filters", () => {
    render(<MeshlogPage />);
    const region = screen.getByRole("region", { name: "Nodes" });
    const first = () => within(region).getAllByRole("button", { name: /^Node Detail:/ })[0];
    expect(first()).toHaveAccessibleName("Node Detail: Old Town Rooftop");
    const name = screen.getByRole("button", { name: "Name", exact: true });
    fireEvent.click(name);
    expect(name).toHaveAttribute("aria-pressed", "true");
    expect(first()).toHaveAccessibleName("Node Detail: East Link");
    fireEvent.click(name);
    expect(first()).toHaveAccessibleName("Node Detail: Workshop Bench");
    fireEvent.click(screen.getByRole("button", { name: "Hash", exact: true }));
    expect(first()).toHaveAccessibleName("Node Detail: East Link");
    fireEvent.click(screen.getByRole("button", { name: "First seen", exact: true }));
    expect(first()).toHaveAccessibleName("Node Detail: East Link");
  });

  it("changes observation sources in settings and shows only enabled reports", async () => {
    render(<MeshlogPage />);
    const settings = screen.getByRole("combobox", { name: /^Observers/ });
    const dialog = openObservers();
    fireEvent.click(within(dialog).getByRole("button", { name: "None" }));
    expect(within(screen.getByRole("region", { name: "Packets" })).getByText("No matches")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Nodes" })).getByText("No matches")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Old Town RX" }));
    closeObservers();
    await waitFor(() => expect(settings).toHaveAttribute("aria-expanded", "false"));
    fireEvent.click(screen.getByRole("button", { name: "Packet details: GRP_TXT · River Walker · 10:23:52" }));
    expect(screen.getByRole("checkbox", { name: "Map path · Old Town RX · River Walker · 10:23:52" }).closest(".meshlog-report")!.querySelector(".meshlog-report-path")).toHaveTextContent(oldTownPathCodes);
    expect(screen.queryByRole("checkbox", { name: "Map path · River RX · River Walker · 10:23:52" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear · Observer filters" }));
    expect(screen.getByRole("checkbox", { name: "Map path · River RX · River Walker · 10:23:52" })).toBeInTheDocument();
  });

  it("applies contact display settings without hiding contacts", async () => {
    render(<MeshlogPage />);
    expect(screen.getAllByText("Location: n/a").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Nodes · Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Nodes" });
    expect(within(dialog).queryByRole("checkbox", { name: "Advert" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: "Battery" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Show location warnings" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.queryByText("Location: n/a")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Node Detail:/ })).toHaveLength(12);
  });

  it("resizes adjacent panels by keyboard while preserving the opposite sidebar", () => {
    render(<MeshlogPage />);
    const left = screen.getByRole("separator", { name: "Packets / Map" });
    const right = screen.getByRole("separator", { name: "Map / Nodes" });
    expect(left).toHaveAttribute("aria-valuenow", "33");
    expect(right).toHaveAttribute("aria-valuenow", "20");
    fireEvent.keyDown(left, { key: "ArrowRight" });
    expect(left).toHaveAttribute("aria-valuenow", "35");
    expect(right).toHaveAttribute("aria-valuenow", "20");
    fireEvent.keyDown(right, { key: "ArrowLeft" });
    expect(right).toHaveAttribute("aria-valuenow", "22");
    expect(left).toHaveAttribute("aria-valuenow", "35");
    fireEvent.keyDown(left, { key: "End" });
    expect(left.getAttribute("aria-valuenow")).toBe(left.getAttribute("aria-valuemax"));
    fireEvent.keyDown(left, { key: "Home" });
    expect(left.getAttribute("aria-valuenow")).toBe(left.getAttribute("aria-valuemin"));
  });

  it("bounds pointer resizing to its adjacent pair and restores cancelled drags", () => {
    render(<MeshlogPage />);
    const left = screen.getByRole("separator", { name: "Packets / Map" });
    const right = screen.getByRole("separator", { name: "Map / Nodes" });
    const pointer = (element: HTMLElement, type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, button: 0 });
      Object.defineProperty(event, "pointerId", { value: 1 });
      fireEvent(element, event);
    };
    pointer(left, "pointerdown", 330);
    pointer(left, "pointermove", 430);
    expect(Number(left.getAttribute("aria-valuenow"))).toBeGreaterThan(33);
    expect(right).toHaveAttribute("aria-valuenow", "20");
    pointer(left, "pointercancel", 430);
    expect(left).toHaveAttribute("aria-valuenow", "33");
    pointer(right, "pointerdown", 800);
    pointer(right, "pointermove", -5000);
    expect(right.getAttribute("aria-valuenow")).toBe(right.getAttribute("aria-valuemax"));
    expect(left).toHaveAttribute("aria-valuenow", "33");
    pointer(right, "pointerup", -5000);
    pointer(right, "pointermove", 800);
    expect(right.getAttribute("aria-valuenow")).toBe(right.getAttribute("aria-valuemax"));
  });
});
