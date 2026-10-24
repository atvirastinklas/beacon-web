import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../src/App";
import { heardAt, historyDetail, historySummary, liveMessage, liveNode, liveNodeDetail, liveObservation, liveObserver } from "./features/meshlog/live-fixtures";

class Socket {
  static instances: Socket[] = [];
  static OPEN = 1; static CLOSED = 3; static CONNECTING = 0; static CLOSING = 2;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send() {}
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  constructor() { Socket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); this.emit({ v: 1, type: "hello", serverTime: heardAt, connectionId: "test" }); }
  emit(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

let previousPrimary: string;
beforeEach(() => {
  previousPrimary = document.documentElement.style.getPropertyValue("--palette-primary");
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("fetch", vi.fn((input: string) => {
    const path = new URL(input, "http://localhost").pathname;
    const empty = { items: [], nextCursor: null, hasMore: false };
    let data: unknown;
    if (path === "/themes.json") data = [{ id: "neutral-blue", name: "Neutral Blue", vars: { "--palette-primary": "#345678" } }];
    else if (path.endsWith("/regions")) data = [];
    else if (path.endsWith("/scopes")) data = ["#north", "#south"];
    else if (path.endsWith("/nodes")) data = { ...empty, items: [liveNode] };
    else if (path.endsWith(`/nodes/${liveNode.id}`)) data = liveNodeDetail();
    else if (path.endsWith("/observers")) data = { ...empty, items: ["a", "b"].map(id => ({ id: `observer-${id}`, displayName: `Live RX ${id.toUpperCase()}`, iata: "RIX", status: "online" })) };
    else if (path.includes("/observers/")) data = liveObserver(path.split("/").at(-1)!);
    else if (path.endsWith("/channels")) data = { ...empty, items: [{ id: 1, channelHash: "channel-a", name: "Community", keyKnown: true, isHashtag: true, lastSeen: heardAt }] };
    else if (path.endsWith("/packets")) data = { ...empty, items: [historySummary()] };
    else if (path.endsWith("/packets/packet-a")) data = historyDetail("packet-a", ["observer-a", "observer-b"]);
    else if (path.endsWith("/packets/packet-b")) data = historyDetail("packet-b");
    else throw new Error(`Unexpected test request ${path}`);
    return Promise.resolve(new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }));
  }));
  window.history.replaceState({}, "", "/experimental/meshlog?iata=RIX");
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
  if (previousPrimary) document.documentElement.style.setProperty("--palette-primary", previousPrimary);
  else document.documentElement.style.removeProperty("--palette-primary");
});

it("opens real history directly with Beacon's saved theme and radio public-key hashes", async () => {
  localStorage.setItem("beacon-theme", "neutral-blue");
  const view = render(<StrictMode><App /></StrictMode>);
  // The first lazy route load also initializes MapLibre; allow for concurrent suite load.
  expect(await screen.findByText(liveMessage.content, {}, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.queryByText("DEMO")).not.toBeInTheDocument();
  expect(screen.queryByText("Riga · DEMO")).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  await waitFor(() => expect(document.documentElement.style.getPropertyValue("--palette-primary")).toBe("#345678"));
  const nodes = screen.getByRole("region", { name: "Nodes" });
  expect(within(nodes).getByText("01234567")).toBeInTheDocument();
  expect(within(nodes).queryByText(liveNode.id)).not.toBeInTheDocument();
  fireEvent.click(within(nodes).getByRole("button", { name: "Node Detail: Live Walker" }));
  expect(within(nodes).getByText(liveNode.publicKey)).toBeInTheDocument();
  view.unmount();
  expect(Socket.instances.every(socket => socket.readyState === Socket.CLOSED)).toBe(true);
});

it("retains independent historical observer pins and packet mixed selection", async () => {
  render(<App />);
  const packet = await screen.findByRole("button", { name: "Packet details: GRP_TXT · Live Walker · 10:23:52" });
  fireEvent.click(packet);
  const group = screen.getByRole("checkbox", { name: "Map path · Live Walker · 10:23:52" });
  const observer = await screen.findByRole("checkbox", { name: "Map path · Live RX A · Live Walker · 10:23:52" });
  await waitFor(() => expect(observer).toBeEnabled());
  fireEvent.click(observer);
  expect(observer).toBeChecked();
  expect(group).toBePartiallyChecked();
  expect(screen.getByRole("checkbox", { name: "Map path · Live RX B · Live Walker · 10:23:52" })).not.toBeChecked();
  expect(packet).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(group);
  expect(group).toBeChecked();
  fireEvent.click(group);
  expect(observer).not.toBeChecked();
});

it("adds incoming traffic to loaded history without replacing earlier packets", async () => {
  const view = render(<App />);
  expect(await screen.findByText(liveMessage.content)).toBeInTheDocument();
  const socket = Socket.instances.at(-1)!;
  act(() => {
    socket.open();
    socket.emit({ v: 1, type: "event", event: "channelMessage", data: { ...liveMessage, packetHash: "packet-b", content: "New live traffic" } });
    socket.emit({ v: 1, type: "event", event: "packetObservation", data: liveObservation("observer-a", "packet-b", heardAt + 1000) });
  });
  expect(await screen.findByText("New live traffic")).toBeInTheDocument();
  expect(screen.getByText(liveMessage.content)).toBeInTheDocument();
  view.unmount();
  expect(socket.readyState).toBe(Socket.CLOSED);
  expect(socket.onmessage).toBeNull();
});

it("filters retained history through the grouped channel combobox and restores it on reset", async () => {
  render(<App />);
  expect(await screen.findByText(liveMessage.content)).toBeInTheDocument();
  const packets = screen.getByRole("region", { name: "Packets" });
  fireEvent.click(within(packets).getByRole("combobox", { name: /Select channels/ }));
  const option = await screen.findByRole("option", { name: /Community/ });
  expect(option).toHaveAttribute("aria-selected", "true");
  fireEvent.click(option);
  expect(screen.queryByText(liveMessage.content)).not.toBeInTheDocument();
  fireEvent.click(within(packets).getByRole("button", { name: "Clear · Packet filters" }));
  expect(await screen.findByText(liveMessage.content)).toBeInTheDocument();
});

it.each(["channel-a", "channel-b"])("resolves explicitly loaded history under a channel filter before accepting channel %s", async channelHash => {
  const fetch = vi.mocked(globalThis.fetch);
  const defaults = fetch.getMockImplementation()!;
  let resolveDetail: ((response: Response) => void) | undefined;
  const json = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }));
  fetch.mockImplementation((input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/packets")) return json(url.searchParams.has("cursor")
      ? { items: [historySummary("packet-older", heardAt - 60_000)], nextCursor: null, hasMore: false }
      : { items: [historySummary()], nextCursor: 20, hasMore: true });
    if (url.pathname.endsWith("/packets/packet-older")) return new Promise<Response>(resolve => { resolveDetail = resolve; });
    return defaults(input, init);
  });
  const view = render(<App />);
  expect(await screen.findByText(liveMessage.content)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("combobox", { name: /Select channels/ }));
  const option = await screen.findByRole("option", { name: /Community/ });
  fireEvent.click(option); fireEvent.click(option);
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Search channels" }), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Load older packets" }));
  await waitFor(() => expect(resolveDetail).toBeDefined());
  const provisional = view.container.querySelector<HTMLElement>('[data-meshlog-packet="packet-older"]')!;
  expect(provisional).toBeInTheDocument();
  expect(within(provisional).queryByRole("checkbox")).not.toBeInTheDocument();
  const detail = historyDetail("packet-older");
  detail.channelHash = channelHash;
  detail.parsedPayload = { type: "GROUP_TEXT", decrypted: { sender: "Live Walker", content: "Resolved older traffic" } };
  await act(async () => resolveDetail!(await json(detail)));
  if (channelHash === "channel-a") expect(await screen.findByText("Resolved older traffic")).toBeInTheDocument();
  else await waitFor(() => expect(view.container.querySelector('[data-meshlog-packet="packet-older"]')).not.toBeInTheDocument());
  expect(fetch.mock.calls.filter(([input]) => new URL(String(input), "http://localhost").pathname.endsWith("/packets"))).toHaveLength(2);
});

it("changes the header language without resetting selected channels or the live session", async () => {
  render(<App />);
  expect(await screen.findByText(liveMessage.content)).toBeInTheDocument();
  const sockets = [...Socket.instances];
  fireEvent.click(screen.getByRole("combobox", { name: /Select channels/ }));
  fireEvent.click(await screen.findByRole("option", { name: /Community/ }));
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Search channels" }), { key: "Escape" });
  expect(screen.queryByText(liveMessage.content)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Language: English" }));
  fireEvent.click(screen.getByRole("button", { name: "Lietuvių", exact: true }));
  await screen.findByRole("button", { name: "Kalba: Lietuvių" });
  expect(localStorage.getItem("beacon-language")).toBe("lt");
  expect(document.documentElement.lang).toBe("lt");
  expect(screen.queryByText(liveMessage.content)).not.toBeInTheDocument();
  expect(Socket.instances).toEqual(sockets);
  expect(sockets.every(socket => socket.readyState !== Socket.CLOSED)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Kalba: Lietuvių" }));
  fireEvent.click(screen.getByRole("button", { name: "English", exact: true }));
  await screen.findByRole("button", { name: "Language: English" });
  expect(screen.queryByText(liveMessage.content)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear · Packet filters" }));
  expect(await screen.findByText(liveMessage.content)).toBeInTheDocument();
});

it("distinguishes no known scope from named scopes across retained history and incoming packets", async () => {
  render(<App />);
  expect(await screen.findByText(liveMessage.content)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("combobox", { name: /^Scope/ }));
  const dialog = screen.getByRole("dialog", { name: "Scope" });
  fireEvent.click(within(dialog).getByRole("button", { name: "None", exact: true }));
  expect(screen.queryByText(liveMessage.content)).not.toBeInTheDocument();
  const noKnownScope = within(dialog).getByRole("option", { name: "no known scope", exact: true });
  fireEvent.click(noKnownScope);
  expect(await screen.findByText(liveMessage.content)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("option", { name: "#north", exact: true }));
  expect(screen.getByText(liveMessage.content)).toBeInTheDocument();
  fireEvent.click(noKnownScope);
  expect(screen.queryByText(liveMessage.content)).not.toBeInTheDocument();
  fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Escape" });
  const sockets = [...Socket.instances];
  act(() => {
    const socket = Socket.instances.at(-1)!;
    socket.open();
    socket.emit({ v: 1, type: "event", event: "channelMessage", data: { ...liveMessage, packetHash: "packet-b", content: "Scoped live traffic", scope: "#north" } });
    const event = liveObservation("observer-a", "packet-b", heardAt + 1000);
    socket.emit({ v: 1, type: "event", event: "packetObservation", data: { ...event, packet: { ...event.packet, scope: "#north" } } });
  });
  expect(await screen.findByText("Scoped live traffic")).toBeInTheDocument();
  expect(screen.queryByText(liveMessage.content)).not.toBeInTheDocument();
  expect(Socket.instances).toEqual(sockets);
  fireEvent.click(screen.getByRole("button", { name: "Clear · Packet filters" }));
  expect(await screen.findByText(liveMessage.content)).toBeInTheDocument();
  expect(screen.getByText("Scoped live traffic")).toBeInTheDocument();
});
