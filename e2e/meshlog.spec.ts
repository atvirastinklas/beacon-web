import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { heardAt, historyDetail, historySummary, liveMessage, liveNode, liveNodeDetail, liveObservation, liveObserver, observerPublicKeys } from "../tests/features/meshlog/live-fixtures";
import type { ChannelSummary } from "../src/features/channels/types";
import type { ObserverSummary } from "../src/features/observers/types";

async function liveBackend(page: Page, frontendOrigin: string, failHistory = false, channels: ChannelSummary[] = [
  { id: 1, channelHash: "channel-a", name: "Community", keyKnown: true, isHashtag: true, lastSeen: heardAt },
], observers: ObserverSummary[] = ["a", "b"].map(id => ({
  id: `observer-${id}`, displayName: `Live RX ${id.toUpperCase()}`, iata: "RIX", status: "online",
})), packetScopes: Record<string, string> = {}) {
  const errors: string[] = [];
  const requests: string[] = [];
  const subscriptions: string[] = [];
  const configurations: boolean[] = [];
  let socket: WebSocketRoute | undefined;
  let historyFailed = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem("beacon-language")) localStorage.setItem("beacon-language", "en");
  });
  const relay = { ...liveNode, id: "internal-relay-uuid", publicKey: "aabbccddeeff0011", name: "Live Relay", nodeType: 2, nodeTypeName: "Repeater", lat: 56.951, lng: 24.105 };
  const bench = { ...liveNode, id: "internal-bench-uuid", publicKey: "1234567890abcdef", name: "Workshop Bench", lat: 56.96, lng: 24.16 };
  const detail = (hash: string) => {
    const value = historyDetail(hash, hash === "packet-a" ? ["observer-a", "observer-b"] : ["observer-a"]);
    value.scope = packetScopes[hash];
    value.observations.forEach(report => {
      report.pathLength.hashSize = 2;
      report.resolvedPath[0]!.hashBytes = "aabb";
      report.resolvedPath[0]!.nodes[0] = { id: relay.id, publicKey: relay.publicKey, name: relay.name!, latitude: relay.lat!, longitude: relay.lng! };
      if (report.observerId === "observer-b") {
        report.pathLength.hopCount = 3;
        report.pathBytes = "aabbccddeeff";
        report.resolvedPath.push(
          { confidence: "ambiguous", hashBytes: "ccdd", nodes: [
            { id: "candidate-one", name: "First candidate", publicKey: "ccdd0011".repeat(8) },
            { id: "candidate-two", name: "Second candidate", publicKey: "ccdd2233".repeat(8) },
          ] },
          { confidence: "none", hashBytes: "eeff", nodes: [] },
        );
      }
    });
    if (hash === "packet-advert") {
      value.header.payloadType = 4; value.header.payloadTypeName = "ADVERT";
      value.firstHeardAt = value.lastHeardAt = heardAt + 26_000;
      value.parsedPayload = undefined;
      value.observations[0]!.resolvedSource = { confidence: "high", nodes: [{ id: bench.id, publicKey: bench.publicKey, name: bench.name!, latitude: bench.lat!, longitude: bench.lng! }] };
    }
    if (hash === "packet-older") {
      value.firstHeardAt = value.lastHeardAt = heardAt - 3_600_000;
      value.parsedPayload = { type: "GROUP_TEXT", decrypted: { sender: "Live Walker", content: "Earlier history" } };
    }
    if (hash === "packet-live") {
      value.firstHeardAt = value.lastHeardAt = heardAt + 60_000;
      value.observations.forEach(report => { report.heardAt = heardAt + 60_000; });
    }
    if (hash === "packet-unknown") {
      value.channelHash = "7f";
      value.parsedPayload = { type: "GROUP_TEXT", decrypted: { sender: "Live Walker", content: "Unknown channel traffic" } };
    }
    const extraTypes: Record<string, { value: number; name: string }> = {
      "packet-request": { value: 0, name: "REQ" },
      "packet-data": { value: 6, name: "GRP_DATA" },
      "packet-future-type": { value: 14, name: "FUTURE_14" },
      "packet-reserved-type": { value: 12, name: "TYPE_12" },
      "packet-envelope": { value: 0, name: "REQ" },
      "packet-anonymous": { value: 7, name: "ANON_REQ" },
    };
    const extraType = extraTypes[hash];
    if (extraType) {
      value.header.payloadType = extraType.value;
      value.header.payloadTypeName = extraType.name;
      value.parsedPayload = undefined;
      value.decrypted = false;
    }
    if (hash === "packet-envelope" || hash === "packet-anonymous") {
      value.parsedPayload = hash === "packet-envelope"
        ? { type: "REQUEST", sourceHash: "A1", destinationHash: "B2", ciphertext: "0011" }
        : { type: "ANON_REQUEST", destination: 0, ephemeralPubKey: "ee".repeat(32), ciphertext: "0011" };
      value.observations.forEach(report => {
        report.resolvedSource = undefined;
        report.resolvedDestination = undefined;
        report.resolvedPath = [];
        report.pathLength = { raw: "00", hashSize: 1, hopCount: 0 };
      });
    }
    return value;
  };
  const initial = [historySummary("packet-advert", heardAt + 26_000), historySummary()];
  initial[0] = { ...initial[0]!, payloadType: 4, payloadTypeName: "ADVERT", summary: "Workshop Bench" };
  initial.forEach(packet => { packet.scope = packetScopes[packet.packetHash]; });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/v1/")) {
      requests.push(url.pathname + url.search);
      const empty = { items: [], nextCursor: null, hasMore: false };
      let body: unknown;
      if (url.pathname.endsWith("/regions")) body = [];
      else if (url.pathname.endsWith("/scopes")) body = ["#north", "#south", "#directory-only"];
      else if (url.pathname.endsWith("/nodes")) body = { ...empty, items: [liveNode, relay, bench] };
      else if (url.pathname.includes("/nodes/")) {
        const id = url.pathname.split("/").at(-1);
        const node = [liveNode, relay, bench].find(node => node.id === id);
        if (!node) throw new Error(`Unexpected test node ${id}`);
        body = liveNodeDetail(node);
      }
      else if (url.pathname.endsWith("/observers")) body = { ...empty, items: observers };
      else if (url.pathname.includes("/observers/")) body = liveObserver(url.pathname.split("/").at(-1)!);
      else if (url.pathname.endsWith("/channels")) body = { ...empty, items: channels };
      else if (url.pathname.endsWith("/packets")) {
        if (failHistory && !historyFailed) {
          historyFailed = true;
          return route.fulfill({ status: 503, json: { error: { code: "test", message: "Unavailable" } } });
        }
        body = url.searchParams.has("cursor") ? { ...empty, items: [{ ...historySummary("packet-older", heardAt - 3_600_000), scope: packetScopes["packet-older"] }] } : { items: initial, nextCursor: 20, hasMore: true };
      } else if (url.pathname.includes("/packets/")) body = detail(url.pathname.split("/").at(-1)!);
      else throw new Error(`Unexpected test API endpoint ${url.pathname}`);
      return route.fulfill({ json: body });
    }
    if (url.origin === frontendOrigin || url.origin === "https://tiles.openfreemap.org") return route.continue();
    return route.abort();
  });
  await page.routeWebSocket("**/*", connection => {
    const url = new URL(connection.url());
    if (url.host === new URL(frontendOrigin).host && url.pathname === "/") { connection.connectToServer(); return; }
    socket = connection;
    connection.onMessage(message => {
      const data = JSON.parse(String(message));
      if (data.type === "configure") configurations.push(data.resolvePath === true);
      if (data.type === "subscribe") {
        subscriptions.push(String(data.id));
        connection.send(JSON.stringify({ v: 1, type: "subscribed", id: data.id, subscriptionId: "test" }));
      }
      if (data.type === "ping") connection.send(JSON.stringify({ v: 1, type: "pong", id: data.id }));
    });
    connection.send(JSON.stringify({ v: 1, type: "hello", serverTime: heardAt, connectionId: "test" }));
  });
  return { errors, requests, subscriptions, configurations, send: (event: string, data: unknown) => socket!.send(JSON.stringify({ v: 1, type: "event", event, data })) };
}

// Match the unpitched, zero-bearing fitBounds used by MeshlogMap's initial directory framing.
async function directoryMarkerPoint(page: Page, longitude: number, latitude: number) {
  const bounds = (await page.locator(".meshlog-map-canvas").boundingBox())!;
  const mercator = (lng: number, lat: number) => [
    (lng + 180) / 360,
    (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2,
  ];
  const points = [[24.087, 56.943], [24.105, 56.951], [24.16, 56.96]].map(([lng, lat]) => mercator(lng!, lat!));
  const xs = points.map(point => point[0]!); const ys = points.map(point => point[1]!);
  const west = Math.min(...xs), east = Math.max(...xs), north = Math.min(...ys), south = Math.max(...ys);
  const scale = Math.min((bounds.width - 80) / (east - west), (bounds.height - 80) / (south - north), 512 * 2 ** 13);
  const [x, y] = mercator(longitude, latitude);
  return { x: bounds.x + bounds.width / 2 + (x! - (west + east) / 2) * scale, y: bounds.y + bounds.height / 2 + (y! - (north + south) / 2) * scale };
}

async function liveFlowPixelCount(page: Page) {
  const image = await page.locator(".meshlog-map-canvas").screenshot();
  return page.locator(".meshlog-map-canvas").evaluate(async (element, { image, color }) => {
    const document = element.ownerDocument;
    const png = document.createElement("img"); png.src = `data:image/png;base64,${image}`;
    await png.decode();
    const canvas = document.createElement("canvas"); canvas.width = png.width; canvas.height = png.height;
    const context = canvas.getContext("2d")!; context.drawImage(png, 0, 0);
    const pixels = context.getImageData(0, 0, png.width, png.height).data;
    const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (rgb.every((value, channel) => Math.abs(value - pixels[index + channel]!) <= 5)) count++;
    }
    return count;
  }, { image: image.toString("base64"), color: "#ff6b35" });
}

test("live history, observer paths and desktop layout use the real integration boundary", async ({ page }, testInfo) => {
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin);
  const darkStyle = page.waitForResponse("https://tiles.openfreemap.org/styles/dark");
  await page.goto("/experimental/meshlog?iata=RIX");
  expect((await darkStyle).ok()).toBe(true);
  await expect(page.getByText(liveMessage.content, { exact: true })).toBeVisible();
  await expect(page.locator(".meshlog-brand").getByText("LIVE", { exact: true })).toBeVisible();
  await expect(page.getByText("DEMO", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Hash", exact: true }).click();
  await expect(page.locator("#meshlog-contacts .meshlog-id")).toHaveText(["01234567", "12345678", "aabb"]);
  await expect(page.locator("#meshlog-contacts")).not.toContainText("internal-relay-uuid");
  const packetRow = page.locator('[data-meshlog-packet="packet-a"]');
  const packet = packetRow.getByRole("button", { name: "Packet details: GRP_TXT · Live Walker · 10:23:52" });
  const packetPath = packetRow.getByRole("checkbox", { name: "Map path · Live Walker · 10:23:52" });
  await expect(packet).toHaveAttribute("aria-expanded", "false");
  await expect(packet.locator("[id^='meshlog-message-']")).toHaveText("<Live Walker> Hello from live mode");
  const groupTypeBadge = packet.getByText("GRP_TXT", { exact: true });
  await expect(groupTypeBadge).toBeVisible();
  await expect(groupTypeBadge).toHaveClass(/text-secondary/);
  expect((await groupTypeBadge.boundingBox())!.height).toBeLessThanOrEqual(20);
  await expect(packet.getByText("#Community", { exact: true })).toBeVisible();
  const nameColor = await packet.getByText("Live Walker", { exact: true }).evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).color);
  expect(nameColor).toBe(await packet.locator(".meshlog-message").evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).color));
  expect(nameColor).not.toBe(await packet.locator(".meshlog-name").evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).color));
  const advert = page.locator(".meshlog-message-row").filter({ has: page.getByRole("button", { name: "Packet details: ADVERT · Workshop Bench · 10:24:18" }) });
  await expect(advert.locator(".meshlog-name")).toHaveText("Workshop Bench");
  await expect(advert.getByText("ADVERT", { exact: true })).toHaveClass(/text-green/);
  const textBounds = (await advert.locator(".meshlog-meta").boundingBox())!;
  const checkBounds = (await advert.getByRole("checkbox").boundingBox())!;
  expect(Math.abs(textBounds.y + textBounds.height / 2 - checkBounds.y - checkBounds.height / 2)).toBeLessThanOrEqual(1);
  expect(await packetPath.evaluate(input => input.ownerDocument.defaultView!.getComputedStyle(input).appearance)).toBe("none");
  await packet.hover();
  await page.screenshot({ path: testInfo.outputPath("live-path-hover.png") });
  await packetPath.check();
  await page.locator(".meshlog-map").hover();
  await page.screenshot({ path: testInfo.outputPath("live-path-pinned.png") });
  await packetPath.uncheck();
  await packet.click();
  await expect(packet).toHaveAttribute("aria-expanded", "true");
  const observerPath = page.getByRole("checkbox", { name: "Map path · Live RX A · Live Walker · 10:23:52" });
  const secondObserverPath = page.getByRole("checkbox", { name: "Map path · Live RX B · Live Walker · 10:23:52" });
  const observerReport = page.locator(".meshlog-report").filter({ has: observerPath });
  const observerLabel = observerReport.getByText("Live RX A", { exact: true });
  await expect(observerLabel).toBeVisible();
  await expect(observerReport.getByText("aabb", { exact: true })).toBeVisible();
  await expect(observerReport.getByText("Live Relay", { exact: true })).toHaveCount(0);
  await packetPath.focus();
  await page.keyboard.press("Tab");
  await expect(observerLabel).toBeFocused();
  const tooltip = page.getByRole("tooltip").and(page.locator("[data-open]"));
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Live RX A");
  await expect(tooltip).toContainText("RIX");
  await expect(tooltip).toContainText(observerPublicKeys["observer-a"]!);
  await expect(observerPath).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await observerLabel.hover();
  await expect(tooltip).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("live-observer-tooltip.png") });
  const singleHop = observerReport.locator('.meshlog-path-code[data-state="resolved"]');
  const secondReport = page.locator(".meshlog-report").filter({ has: secondObserverPath });
  const ambiguousHop = secondReport.locator('.meshlog-path-code[data-state="ambiguous"]');
  const unresolvedHop = secondReport.locator('.meshlog-path-code[data-state="unresolved"]');
  await expect(singleHop).toHaveAttribute("aria-label", "aabb · Nodes: 1");
  await expect(ambiguousHop).toHaveAttribute("aria-label", "ccdd · Nodes: 2");
  await expect(unresolvedHop).toHaveAttribute("aria-label", "eeff · Nodes: 0");
  await singleHop.hover();
  await expect(tooltip).toContainText("Nodes: 1");
  await expect(tooltip).toContainText("Live Relay");
  await ambiguousHop.hover();
  await expect(tooltip).toContainText("Nodes: 2");
  await expect(tooltip).toContainText("First candidate");
  await expect(tooltip).toContainText("Second candidate");
  await expect(tooltip).not.toContainText("candidate-one");
  await page.screenshot({ path: testInfo.outputPath("live-hop-ambiguous-tooltip.png") });
  await ambiguousHop.focus();
  await page.keyboard.press("Tab");
  await expect(unresolvedHop).toBeFocused();
  await expect(tooltip).toContainText("Nodes: 0");
  await expect(tooltip).toContainText("Unknown");
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(observerPath).not.toBeChecked();
  await expect(secondObserverPath).not.toBeChecked();
  await observerReport.hover();
  await observerPath.focus();
  await page.keyboard.press("Space");
  await expect(observerPath).toBeChecked();
  await expect(secondObserverPath).not.toBeChecked();
  await expect(packetPath).toHaveJSProperty("indeterminate", true);
  await page.locator(".meshlog-map").hover();
  await page.screenshot({ path: testInfo.outputPath("live-observer-pinned.png") });
  await observerPath.uncheck();
  await page.locator(".meshlog-map").hover();
  await packet.click();
  const channelTrigger = page.getByRole("combobox", { name: /Select channels/ });
  await channelTrigger.click();
  const channel = page.getByRole("option", { name: /Community/ });
  await expect(channel).toHaveAttribute("aria-selected", "true");
  await channel.click();
  await expect(packet).toHaveCount(0);
  await channel.click();
  await expect(packet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(channelTrigger).toBeFocused();
  await page.getByRole("button", { name: "Load older packets" }).click();
  await expect(page.getByText("Earlier history", { exact: true })).toBeVisible();
  backend.send("channelMessage", { ...liveMessage, packetHash: "packet-live", content: "New live traffic" });
  backend.send("packetObservation", liveObservation("observer-a", "packet-live", heardAt + 60_000));
  await expect(page.getByText("New live traffic", { exact: true })).toBeVisible();
  await expect(page.getByText("Earlier history", { exact: true })).toBeVisible();
  await expect(page.locator(".meshlog-message-row")).toHaveCount(4);
  const search = page.getByRole("searchbox");
  await search.fill("aabb");
  await expect(page.locator("#meshlog-contacts .meshlog-id")).toHaveText(["aabb"]);
  await search.fill("");
  for (const width of [1440, 1100, 901]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.locator("html").evaluate(element => ({ horizontal: element.scrollWidth > element.clientWidth, vertical: element.scrollHeight > element.clientHeight }))).toEqual({ horizontal: false, vertical: false });
    await page.screenshot({ path: testInfo.outputPath(`live-${width}.png`) });
    await packet.click();
    await expect(observerPath).toBeVisible();
    await packetPath.focus();
    await page.keyboard.press("Tab");
    await expect(observerLabel).toBeFocused();
    await expect(tooltip).toBeVisible();
    const tooltipBounds = (await tooltip.boundingBox())!;
    expect(tooltipBounds.x).toBeGreaterThanOrEqual(0);
    expect(tooltipBounds.x + tooltipBounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`live-observer-tooltip-${width}.png`) });
    await page.keyboard.press("Escape");
    await ambiguousHop.hover();
    await expect(tooltip).toContainText("Second candidate");
    const hopBounds = (await tooltip.boundingBox())!;
    expect(hopBounds.x).toBeGreaterThanOrEqual(0);
    expect(hopBounds.x + hopBounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`live-hop-tooltip-${width}.png`) });
    await page.keyboard.press("Escape");
    const observers = page.locator("#meshlog-messages").getByRole("combobox", { name: /observers/i });
    await observers.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    const bounds = (await listbox.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`live-expanded-${width}.png`) });
    await page.keyboard.press("Escape");
    await packet.click();
  }
  expect(backend.errors).toEqual([]);
  expect(backend.requests.some(url => url.includes("cursor=20"))).toBe(true);
  const historyRequests = backend.requests.map(path => new URL(path, "http://test.local")).filter(url => url.pathname.endsWith("/packets"));
  expect(historyRequests.find(url => !url.searchParams.has("cursor"))!.searchParams.get("limit")).toBe("30");
  expect(historyRequests.find(url => url.searchParams.get("cursor") === "20")!.searchParams.get("limit")).toBe("50");
});

test("history failure is retryable without stopping the live stream", async ({ page }, testInfo) => {
  await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin, true);
  await page.goto("/experimental/meshlog?iata=RIX");
  const retry = page.getByRole("button", { name: "Retry · Packets" });
  await expect(retry).toBeVisible();
  await expect(page.locator(".meshlog-brand").getByText("LIVE", { exact: true })).toBeVisible();
  await retry.click();
  await expect(page.getByText(liveMessage.content, { exact: true })).toBeVisible();
  await expect(retry).toHaveCount(0);
});

test("large channel directories leave packets visible across desktop widths", async ({ page }, testInfo) => {
  const channels: ChannelSummary[] = [
    { id: 1, channelHash: "channel-a", name: "Community", keyKnown: true, isHashtag: true, lastSeen: heardAt },
    ...Array.from({ length: 7 }, (_, index) => ({
      id: index + 2, channelHash: `known-${index}`,
      name: index === 6 ? "Regional emergency coordination / North coast community" : `Regional ${index + 1}`,
      keyKnown: true, isHashtag: true, lastSeen: heardAt,
    })),
    ...Array.from({ length: 170 }, (_, index) => ({
      id: index + 100, channelHash: index.toString(16).padStart(2, "0"), name: null,
      keyKnown: false, isHashtag: false, lastSeen: heardAt,
    })),
  ];
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin, false, channels);
  await page.goto("/experimental/meshlog?iata=RIX");
  const packet = page.locator('[data-meshlog-packet="packet-a"]');
  await expect(packet).toBeVisible();
  backend.send("channelMessage", { ...liveMessage, packetHash: "packet-unknown", channelHash: "7f", content: "Unknown channel traffic" });
  backend.send("packetObservation", liveObservation("observer-a", "packet-unknown", heardAt + 60_000));
  await expect(page.getByText("Unknown channel traffic", { exact: true })).toBeVisible();
  for (const width of [1440, 1100, 901]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(packet).toBeInViewport();
    const bounds = (await packet.boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThan(700);
    await page.screenshot({ path: testInfo.outputPath(`channels-178-${width}.png`) });
    const trigger = page.getByRole("combobox", { name: /Select channels/ });
    await trigger.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("group", { name: "Known channels", exact: true })).toBeVisible();
    await expect(listbox.getByRole("group", { name: "Unknown channels", exact: true })).toBeVisible();
    const popupBounds = (await listbox.boundingBox())!;
    expect(popupBounds.x).toBeGreaterThanOrEqual(0);
    expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(width);
    expect(popupBounds.y).toBeGreaterThanOrEqual(0);
    expect(popupBounds.y + popupBounds.height).toBeLessThanOrEqual(900);
    await page.screenshot({ path: testInfo.outputPath(`channels-picker-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(listbox).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  const trigger = page.getByRole("combobox", { name: /Select channels/ });
  await trigger.click();
  const listbox = page.getByRole("listbox");
  const search = page.locator('input[role="combobox"]');
  await expect(search).toBeFocused();
  await expect(page.getByRole("tablist", { name: "Channel views" })).toHaveCount(0);
  await expect(page.getByText("Grouped by whether the channel key is known. Changes apply immediately.")).toHaveCount(0);
  await expect(page.getByText("All, None and group checkboxes also include channels hidden by search.")).toHaveCount(0);
  const knownGroup = page.getByRole("button", { name: "Known channels", exact: true });
  const unknownGroup = page.getByRole("button", { name: "Unknown channels", exact: true });
  await expect(knownGroup).toHaveAttribute("aria-pressed", "true");
  await expect(unknownGroup).toHaveAttribute("aria-pressed", "true");
  await unknownGroup.click();
  await expect(page.locator('[data-meshlog-packet="packet-unknown"]')).toHaveCount(0);
  await expect(packet).toBeVisible();
  await knownGroup.focus();
  await page.keyboard.press("Space");
  await expect(packet).toHaveCount(0);
  await expect(unknownGroup).toHaveAttribute("aria-pressed", "false");
  await knownGroup.click();
  await expect(packet).toBeVisible();
  await expect(listbox.getByRole("option", { selected: true })).toHaveCount(8);
  await search.fill("7F");
  await listbox.getByRole("option", { name: /#7f/ }).click();
  await expect(unknownGroup).toHaveAttribute("aria-pressed", "mixed");
  await unknownGroup.click();
  await search.fill("");
  await expect(knownGroup).toHaveAttribute("aria-pressed", "true");
  await expect(listbox.getByRole("option", { selected: true })).toHaveCount(178);
  await page.getByRole("button", { name: "None", exact: true }).click();
  await expect(page.locator('[data-meshlog-packet="packet-unknown"]')).toHaveCount(0);
  await expect(packet).toHaveCount(0);
  await expect(page.locator('[data-meshlog-packet="packet-advert"]')).toBeVisible();
  await search.fill("North coast");
  const longName = listbox.getByRole("option", { name: /Regional emergency coordination \/ North coast community/ });
  await expect(longName).toBeVisible();
  await longName.click();
  await expect(longName).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("channels-long-name-901.png") });
  await search.fill("7F");
  const unknown = listbox.getByRole("option", { name: /#7f/ });
  await expect(unknown).toHaveAttribute("aria-selected", "false");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(unknown).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Unknown channel traffic", { exact: true })).toBeVisible();
  await expect(packet).toHaveCount(0);
  await search.fill("Community");
  const community = listbox.getByRole("option", { name: /^#?Community$/i });
  await community.click();
  await expect(packet).toBeVisible();
  await expect(community).toHaveAttribute("aria-selected", "true");
  await search.fill("");
  await expect(listbox.getByRole("option", { selected: true })).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("channels-selected-901.png") });
  await search.fill("not-a-channel");
  await expect(listbox.getByRole("option")).toHaveCount(0);
  await expect(page.getByText("No matching channels loaded.", { exact: true })).toBeVisible();
  await search.fill("");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(packet).toBeVisible();
  await expect(listbox.getByRole("option", { selected: true })).toHaveCount(178);
  await page.locator(".meshlog-map").click({ position: { x: 200, y: 850 } });
  await expect(listbox).toHaveCount(0);
  expect(backend.errors).toEqual([]);
});

test("compact header, observer and type comboboxes preserve filters across language changes", async ({ page }, testInfo) => {
  const observers: ObserverSummary[] = [
    ...["a", "b"].map(id => ({ id: `observer-${id}`, displayName: `Live RX ${id.toUpperCase()}`, iata: "RIX", status: "online" as const })),
    ...Array.from({ length: 28 }, (_, index) => ({ id: `receiver-${index}`, displayName: `Receiver ${index + 1}`, iata: "RIX", status: "online" as const })),
  ];
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin, false, undefined, observers);
  await page.goto("/experimental/meshlog?iata=RIX");
  const packets = page.locator("#meshlog-messages");
  const packet = page.locator('[data-meshlog-packet="packet-a"]');
  const advert = page.locator('[data-meshlog-packet="packet-advert"]');
  await expect(packet).toBeVisible();
  await expect(packets.getByRole("button", { name: "Observer filters · Settings" })).toHaveCount(0);
  await expect(packets.getByRole("checkbox", { name: "Channel", exact: true })).toHaveCount(0);
  await expect(packets.getByRole("combobox")).toHaveCount(4);
  const observerFilter = packets.getByRole("combobox", { name: /observers/i });
  const typeFilter = packets.getByRole("combobox", { name: /^Packet types/ });
  await typeFilter.click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(13);
  await expect(page.getByRole("listbox").getByRole("option", { selected: true })).toHaveCount(13);
  await page.keyboard.press("Escape");
  for (const width of [1440, 1100, 901]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".meshlog-brand").getByText("LIVE", { exact: true })).toBeVisible();
    await expect(packets.locator(".meshlog-header-region")).toHaveCount(0);
    const filtersBounds = (await packets.locator(".meshlog-packet-filters").boundingBox())!;
    expect(filtersBounds.height).toBeLessThan(150);
    await expect(packet).toBeInViewport();
    await page.getByRole("button", { name: "Language: English" }).click();
    const languageMenu = page.getByRole("group", { name: "Language", exact: true });
    await expect(languageMenu.getByRole("button", { name: "Lietuvių", exact: true })).toBeVisible();
    const languageBounds = (await languageMenu.boundingBox())!;
    expect(languageBounds.x).toBeGreaterThanOrEqual(0);
    expect(languageBounds.x + languageBounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`header-language-en-${width}.png`) });
    await page.keyboard.press("Escape");
    await observerFilter.click();
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(30);
    await page.screenshot({ path: testInfo.outputPath(`header-observers-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(observerFilter).toBeFocused();
  }
  await observerFilter.click();
  await page.getByRole("button", { name: "None", exact: true }).click();
  await expect(packet).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(packet).toBeVisible();
  const observerSearch = page.locator('input[role="combobox"]');
  await observerSearch.fill("Live RX B");
  await observerSearch.press("ArrowDown");
  await observerSearch.press("Enter");
  await expect(page.getByRole("option", { name: /Live RX B/ })).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Escape");
  await typeFilter.click();
  const typeSearch = page.locator('input[role="combobox"]');
  await typeSearch.fill("Advert");
  await typeSearch.press("ArrowDown");
  await typeSearch.press("Enter");
  await expect(advert).toHaveCount(0);
  await expect(packet).toBeVisible();
  await page.keyboard.press("Escape");
  await packet.locator(".meshlog-row-trigger").click();
  await expect(packet.getByText("Live RX A", { exact: true })).toBeVisible();
  await expect(packet.getByText("Live RX B", { exact: true })).toHaveCount(0);
  const pin = packet.locator(".meshlog-message-main").getByRole("checkbox");
  await pin.check();
  await page.getByRole("button", { name: "Language: English" }).click();
  await page.getByRole("button", { name: "Lietuvių", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kalba: Lietuvių" })).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("lang", "lt");
  expect(await page.evaluate(() => localStorage.getItem("beacon-language"))).toBe("lt");
  await expect(advert).toHaveCount(0);
  await expect(pin).toBeChecked();
  await expect(packet.getByText("Live RX A", { exact: true })).toBeVisible();
  await expect(packet.getByText("Live RX B", { exact: true })).toHaveCount(0);
  for (const width of [1440, 1100, 901]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".meshlog-brand").getByText("TIESIOGIAI", { exact: true })).toBeVisible();
    await expect(packets.getByRole("combobox", { name: /Stebėtojai/i })).toBeVisible();
    await expect(packets.getByRole("combobox", { name: /^Paketų tipai/ })).toBeVisible();
    await expect(advert).toHaveCount(0);
    await expect(pin).toBeChecked();
    await expect(packet.getByText("Live RX B", { exact: true })).toHaveCount(0);
    expect(await page.locator("html").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`header-lithuanian-${width}.png`) });
  }
  await page.reload();
  await expect(page.getByRole("button", { name: "Kalba: Lietuvių" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "lt");
  await expect(page.getByText(liveMessage.content, { exact: true })).toBeVisible();
  expect(backend.errors).toEqual([]);
});

test("directory retry stays in the compact top bar in both languages", async ({ page }, testInfo) => {
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin);
  let failed = false;
  await page.route("**/api/v1/observers**", async route => {
    if (new URL(route.request().url()).pathname.endsWith("/observers") && !failed) {
      failed = true;
      return route.fulfill({ status: 503, json: { error: { code: "test", message: "Unavailable" } } });
    }
    return route.fallback();
  });
  await page.goto("/experimental/meshlog?iata=RIX");
  const headerHost = page.locator(".meshlog-workspace-header");
  const header = headerHost.locator(".meshlog-brand");
  const retry = header.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  await expect(headerHost.getByRole("alert").getByText("Failed to load", { exact: true })).toBeVisible();
  await expect(headerHost.locator(".meshlog-live-state").getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  for (const width of [1440, 1100, 901]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(retry).toBeVisible();
    await expect(header.locator('[data-slot="live-badge"]')).toBeVisible();
    await expect(header.getByRole("button", { name: "Language: English" })).toBeVisible();
    const headerBounds = (await header.boundingBox())!;
    const retryBounds = (await retry.boundingBox())!;
    expect(headerBounds.height).toBeLessThanOrEqual(60);
    expect(retryBounds.x).toBeGreaterThanOrEqual(headerBounds.x);
    expect(retryBounds.x + retryBounds.width).toBeLessThanOrEqual(headerBounds.x + headerBounds.width);
    await page.screenshot({ path: testInfo.outputPath(`header-retry-${width}.png`) });
  }
  await header.getByRole("button", { name: "Language: English" }).click();
  await page.getByRole("button", { name: "Lietuvių", exact: true }).click();
  const lithuanianRetry = header.getByRole("button", { name: "Bandyti dar kartą", exact: true });
  await expect(lithuanianRetry).toBeVisible();
  const lithuanianHeaderBounds = (await header.boundingBox())!;
  const lithuanianRetryBounds = (await lithuanianRetry.boundingBox())!;
  expect(lithuanianHeaderBounds.height).toBeLessThanOrEqual(60);
  expect(lithuanianRetryBounds.x + lithuanianRetryBounds.width).toBeLessThanOrEqual(lithuanianHeaderBounds.x + lithuanianHeaderBounds.width);
  await page.screenshot({ path: testInfo.outputPath("header-retry-lithuanian-901.png") });
  await lithuanianRetry.focus();
  await page.keyboard.press("Enter");
  await expect(lithuanianRetry).toHaveCount(0);
  await expect(headerHost.locator(".meshlog-live-state")).toHaveCount(0);
  await expect(page.getByText(liveMessage.content, { exact: true })).toBeVisible();
  expect(backend.errors).toEqual([]);
});

test("scope filters combine retained history and live traffic without resetting pins or the subscription", async ({ page }, testInfo) => {
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin, false, undefined, undefined, {
    "packet-a": "#north", "packet-older": "#south", "packet-south": "#south", "packet-fresh": "#fresh",
  });
  await page.goto("/experimental/meshlog?iata=RIX");
  const packets = page.locator("#meshlog-messages");
  const north = page.locator('[data-meshlog-packet="packet-a"]');
  const older = page.locator('[data-meshlog-packet="packet-older"]');
  const advert = page.locator('[data-meshlog-packet="packet-advert"]');
  await expect(north).toBeVisible();
  await page.getByRole("button", { name: "Load older packets", exact: true }).click();
  await expect(older).toBeVisible();
  const pin = north.locator(".meshlog-message-main").getByRole("checkbox");
  await pin.check();
  const subscriptions = backend.subscriptions.length;
  const scope = packets.getByRole("combobox", { name: /^Scope/ });
  await scope.click();
  const listbox = page.getByRole("listbox");
  const popup = page.getByRole("dialog", { name: "Scope", exact: true });
  await expect(listbox.getByRole("option", { name: "#directory-only", exact: true })).toBeVisible();
  await expect(listbox.getByRole("option", { selected: true })).toHaveCount(4);
  await popup.getByRole("button", { name: "None", exact: true }).click();
  await expect(packets.locator("[data-meshlog-packet]")).toHaveCount(0);
  await expect(page.locator("#meshlog-contacts .meshlog-row")).toHaveCount(3);
  const input = popup.getByRole("combobox");
  await input.fill("#south");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(older).toBeVisible();
  await expect(north).toHaveCount(0);
  await expect(advert).toHaveCount(0);
  await page.keyboard.press("Escape");
  const send = (hash: string, scopeName: string, content: string) => {
    backend.send("channelMessage", { ...liveMessage, packetHash: hash, content, scope: scopeName, scopeStatus: "matched" });
    const event = liveObservation("observer-a", hash, heardAt + 60_000);
    backend.send("packetObservation", { ...event, packet: { ...event.packet, scope: scopeName } });
  };
  send("packet-south", "#south", "Scoped live traffic");
  send("packet-fresh", "#fresh", "New scope traffic");
  await expect(page.getByText("Scoped live traffic", { exact: true })).toBeVisible();
  await expect(page.getByText("New scope traffic", { exact: true })).toHaveCount(0);
  await scope.click();
  const fresh = listbox.getByRole("option", { name: "#fresh", exact: true });
  await expect(fresh).toHaveAttribute("aria-selected", "false");
  await fresh.click();
  await expect(page.getByText("New scope traffic", { exact: true })).toBeVisible();
  await expect(page.getByText("Scoped live traffic", { exact: true })).toBeVisible();
  await popup.getByRole("button", { name: "All", exact: true }).click();
  await expect(pin).toBeChecked();
  await popup.getByRole("button", { name: "None", exact: true }).click();
  await listbox.getByRole("option", { name: "no known scope", exact: true }).click();
  await expect(advert).toBeVisible();
  await expect(north).toHaveCount(0);
  await expect(older).toHaveCount(0);
  await expect(page.getByText("Scoped live traffic", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await packets.getByRole("button", { name: "Clear · Packet filters", exact: true }).click();
  await expect(pin).toBeChecked();
  await expect(older).toBeVisible();
  for (const width of [1440, 1100, 901]) {
    await page.setViewportSize({ width, height: 900 });
    await scope.click();
    const bounds = (await popup.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`scope-filter-${width}.png`) });
    await page.keyboard.press("Escape");
  }
  expect(backend.subscriptions).toHaveLength(subscriptions);
  expect(backend.errors).toEqual([]);
});

test("actual packet types distinguish group text and data and expose compact colored badges", async ({ page }, testInfo) => {
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin);
  await page.goto("/experimental/meshlog?iata=RIX");
  const textPacket = page.locator('[data-meshlog-packet="packet-a"]');
  await expect(textPacket).toBeVisible();
  const types = page.getByRole("combobox", { name: /^Packet types/ });
  await types.click();
  const popup = page.getByRole("dialog", { name: "Packet types", exact: true });
  const listbox = popup.getByRole("listbox");
  await expect(listbox.getByRole("option", { selected: true })).toHaveCount(13);
  for (const name of ["REQ", "RESPONSE", "TXT_MSG", "ACK", "ADVERT", "GRP_TXT", "GRP_DATA", "ANON_REQ", "PATH", "TRACE", "MULTI_PART", "CONTROL", "CUSTOM"]) {
    await expect(listbox.getByRole("option", { name, exact: true })).toHaveCount(1);
  }
  await expect(listbox.getByRole("option", { name: "ADVERT", exact: true }).getByText("ADVERT", { exact: true })).toHaveClass(/text-green/);
  await expect(listbox.getByRole("option", { name: "GRP_DATA", exact: true }).getByText("GRP_DATA", { exact: true })).toHaveClass(/text-secondary/);
  await expect(listbox.getByRole("option", { name: "REQ", exact: true }).getByText("REQ", { exact: true })).toHaveClass(/text-warn/);
  await popup.getByRole("button", { name: "None", exact: true }).click();
  await listbox.getByRole("option", { name: "GRP_DATA", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(textPacket).toHaveCount(0);
  const emitType = (hash: string, payloadType: number, payloadTypeName: string) => {
    const event = liveObservation("observer-a", hash, heardAt + 60_000);
    backend.send("packetObservation", { ...event, packet: { ...event.packet, payloadType, payloadTypeName } });
  };
  emitType("packet-data", 6, "GRP_DATA");
  const dataPacket = page.locator('[data-meshlog-packet="packet-data"]');
  await expect(dataPacket).toBeVisible();
  await expect(types.getByText("GRP_DATA", { exact: true })).toHaveClass(/text-secondary/);
  await expect(dataPacket.getByText("GRP_DATA", { exact: true })).toHaveClass(/text-secondary/);
  await expect(textPacket).toHaveCount(0);
  emitType("packet-request", 0, "REQ");
  await expect(page.locator('[data-meshlog-packet="packet-request"]')).toHaveCount(0);
  await types.click();
  await listbox.getByRole("option", { name: "GRP_TXT", exact: true }).click();
  await expect(textPacket).toBeVisible();
  await expect(dataPacket).toBeVisible();
  await page.keyboard.press("Escape");
  emitType("packet-future-type", 14, "FUTURE_14");
  const futurePacket = page.locator('[data-meshlog-packet="packet-future-type"]');
  await expect(futurePacket).toHaveCount(0);
  await types.click();
  const futureOption = listbox.getByRole("option", { name: "FUTURE_14", exact: true });
  await expect(futureOption).toHaveAttribute("aria-selected", "false");
  await popup.getByRole("button", { name: "All", exact: true }).click();
  await expect(futurePacket).toBeVisible();
  await expect(futurePacket.getByText("FUTURE_14", { exact: true })).toHaveClass(/text-text-muted/);
  await expect(page.locator('[data-meshlog-packet="packet-request"]').getByText("REQ", { exact: true })).toHaveClass(/text-warn/);
  await page.keyboard.press("Escape");
  emitType("packet-reserved-type", 12, "TYPE_12");
  await expect(page.locator('[data-meshlog-packet="packet-reserved-type"]')).toBeVisible();
  await types.click();
  await expect(listbox.getByRole("option", { selected: true })).toHaveCount(15);
  await page.screenshot({ path: testInfo.outputPath("actual-packet-types.png") });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 901, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("packet-type-badges-901.png") });
  expect(backend.errors).toEqual([]);
});

test("unknown packet endpoints use muted real hashes and unavailable paths have no checkbox", async ({ page }, testInfo) => {
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin);
  await page.goto("/experimental/meshlog?iata=RIX");
  await expect(page.getByText(liveMessage.content, { exact: true })).toBeVisible();
  for (const [hash, payloadType, payloadTypeName] of [["packet-envelope", 0, "REQ"], ["packet-anonymous", 7, "ANON_REQ"]] as const) {
    const event = liveObservation("observer-a", hash, heardAt + 60_000);
    backend.send("packetObservation", { ...event,
      packet: { ...event.packet, payloadType, payloadTypeName },
      observation: { ...event.observation, resolvedSource: null, resolvedDestination: null, resolvedPath: [], pathLength: { raw: "00", hashSize: 1, hopCount: 0 } },
    });
  }
  const envelope = page.locator('[data-meshlog-packet="packet-envelope"]');
  const anonymous = page.locator('[data-meshlog-packet="packet-anonymous"]');
  const originator = envelope.getByText("a1", { exact: true });
  const target = envelope.getByText("b2", { exact: true });
  await expect(originator).toBeVisible();
  await expect(target).toBeVisible();
  await expect(anonymous.getByText("00", { exact: true })).toBeVisible();
  await expect(anonymous).not.toContainText("eeeeeeee");
  await expect(envelope.getByRole("checkbox")).toHaveCount(0);
  await expect(anonymous.getByRole("checkbox")).toHaveCount(0);
  // Missing path controls retain the same row rhythm and noninteractive control space.
  const available = page.locator('[data-meshlog-packet="packet-advert"] .meshlog-message-main');
  await expect(available.getByRole("checkbox")).toBeVisible();
  const availableHeight = (await available.boundingBox())!.height;
  expect((await envelope.locator(".meshlog-message-main").boundingBox())!.height).toBe(availableHeight);
  expect((await anonymous.locator(".meshlog-message-main").boundingBox())!.height).toBe(availableHeight);
  const mutedColors = await originator.evaluate(element => ["--color-text-muted", "--color-text-dim"].map(token => {
    const probe = element.ownerDocument.createElement("span");
    probe.style.color = `var(${token})`;
    element.ownerDocument.body.append(probe);
    const color = element.ownerDocument.defaultView!.getComputedStyle(probe).color;
    probe.remove();
    return color;
  }));
  expect(mutedColors).toContain(await originator.evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).color));
  expect(mutedColors).toContain(await target.evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).color));
  await envelope.locator(".meshlog-row-trigger").focus();
  await page.keyboard.press("Enter");
  await expect(envelope.locator(".meshlog-report")).toBeVisible();
  await expect(envelope.getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator('#meshlog-messages input[type="checkbox"]:disabled')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("unknown-endpoints.png") });
  await page.setViewportSize({ width: 901, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("unknown-endpoints-901.png") });
  expect(backend.errors).toEqual([]);
});

test("live packet flow stays enabled without a map toggle and leaves pinned paths independent", async ({ page }, testInfo) => {
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin);
  await page.goto("/experimental/meshlog?iata=RIX");
  await expect(page.getByText(liveMessage.content, { exact: true })).toBeVisible();
  await expect(page.locator(".meshlog-map-status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /live map packet flow/ })).toHaveCount(0);
  expect(await liveFlowPixelCount(page)).toBe(0);
  const packetPin = page.locator('[data-meshlog-packet="packet-a"]').getByRole("checkbox").first();
  await packetPin.check();
  await page.mouse.move(10, 10);
  const subscriptionCount = backend.subscriptions.length;
  const event = liveObservation("observer-a", "packet-flow-live", heardAt + 120_000);
  const source = event.observation.resolvedSource!;
  const destination = { confidence: "high" as const, nodes: [{ id: "flow-destination", publicKey: "ff".repeat(32), name: "Flow destination", latitude: 56.96, longitude: 24.16 }] };
  backend.send("packetObservation", { ...event, observation: { ...event.observation,
    resolvedPath: [...event.observation.resolvedPath!, ...Array.from({ length: 40 }, () => ({ confidence: "none" as const, nodes: [] }))],
    resolvedSource: source, resolvedDestination: destination,
  } });
  await expect(page.locator('[data-meshlog-packet="packet-flow-live"]')).toBeVisible();
  await expect.poll(() => liveFlowPixelCount(page)).toBeGreaterThan(10);
  await page.screenshot({ path: testInfo.outputPath("live-packet-flow.png") });
  await expect(packetPin).toBeChecked();
  await page.getByRole("button", { name: "Clear paths", exact: true }).click();
  await expect(packetPin).not.toBeChecked();
  await expect.poll(() => liveFlowPixelCount(page)).toBeGreaterThan(10);
  await page.screenshot({ path: testInfo.outputPath("cleared-pins-keeps-live-flow.png") });
  expect(backend.subscriptions).toHaveLength(subscriptionCount);
  expect(backend.configurations.length).toBeGreaterThan(0);
  expect(backend.configurations.every(Boolean)).toBe(true);
  await page.setViewportSize({ width: 901, height: 900 });
  await expect(page.getByRole("button", { name: /live map packet flow/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("live-map-without-toggle-901.png") });
  expect(backend.errors).toEqual([]);
});

test("map node tooltips and contact details use actual Beacon node data and existing role assets", async ({ page }, testInfo) => {
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin);
  await page.goto("/experimental/meshlog?iata=RIX");
  await expect(page.getByText(liveMessage.content, { exact: true })).toBeVisible();
  await expect(page.locator(".meshlog-map-status")).toHaveCount(0);
  const point = await directoryMarkerPoint(page, 24.16, 56.96);
  const tooltip = page.getByRole("tooltip").filter({ hasText: "Workshop Bench" });
  // Glyph images are asynchronously rasterized after style readiness; hover once actually painted.
  await expect(async () => {
    await page.mouse.move(point.x - 30, point.y);
    await page.mouse.move(point.x, point.y);
    await expect(tooltip).toBeVisible({ timeout: 300 });
  }).toPass({ timeout: 5000 });
  await expect(tooltip).not.toContainText("internal-bench-uuid");
  await expect(tooltip).not.toContainText("1234567890abcdef");
  await expect(tooltip.getByText("12345678", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("node-marker-tooltip.png") });
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  const nodes = page.getByRole("region", { name: "Nodes", exact: true });
  const roleIcons = nodes.getByRole("img");
  await expect(roleIcons).toHaveCount(3);
  await expect(nodes.getByRole("img", { name: "Companion", exact: true })).toHaveCount(2);
  await expect(nodes.getByRole("img", { name: "Repeater", exact: true })).toHaveCount(1);
  await expect(roleIcons.locator("img")).toHaveCount(3);
  expect(await roleIcons.locator("img").evaluateAll(elements => elements.every(element => element.getAttribute("src")?.startsWith("data:image/svg+xml")))).toBe(true);
  expect(backend.requests.filter(path => /\/nodes\//.test(path))).toHaveLength(0);
  const contact = nodes.getByRole("button", { name: "Node Detail: Live Walker", exact: true });
  await contact.click();
  await expect.poll(() => backend.requests.filter(path => path.endsWith(`/nodes/${liveNode.id}`)).length).toBe(1);
  await expect(nodes).toContainText("1.12.0");
  await expect(nodes).toContainText("#north");
  await expect(nodes).toContainText("868");
  await expect(nodes).toContainText(liveNode.publicKey);
  await expect(nodes).not.toContainText("Battery");
  await page.screenshot({ path: testInfo.outputPath("actual-contact-details.png") });
  expect(backend.errors).toEqual([]);
});

test("mobile keeps the map above adjustable tabbed packets and contacts without losing state", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin);
  await page.goto("/experimental/meshlog?iata=RIX");
  await expect(page.getByText(liveMessage.content, { exact: true })).toBeVisible();
  const packetTab = page.getByRole("tab", { name: "Packets", exact: true });
  const nodeTab = page.getByRole("tab", { name: /^(Nodes|Contacts)$/ });
  await expect(packetTab).toHaveAttribute("aria-selected", "true");
  const packetPin = page.locator('[data-meshlog-packet="packet-a"]').getByRole("checkbox").first();
  await packetPin.check();
  const subscriptionCount = backend.subscriptions.length;
  const map = page.locator("#meshlog-map-panel");
  const divider = page.locator('[role="separator"][aria-orientation="horizontal"]');
  await expect(divider).toBeVisible();
  const before = Number(await divider.getAttribute("aria-valuenow"));
  await divider.focus();
  await page.keyboard.press("ArrowUp");
  expect(Number(await divider.getAttribute("aria-valuenow"))).toBeLessThan(before);
  await nodeTab.click();
  await expect(nodeTab).toHaveAttribute("aria-selected", "true");
  const nodes = page.getByRole("region", { name: "Nodes", exact: true });
  await expect(nodes.getByRole("button", { name: "Node Detail: Live Walker", exact: true })).toBeVisible();
  const mapBounds = (await map.boundingBox())!; const nodeBounds = (await nodes.boundingBox())!;
  expect(mapBounds.y + mapBounds.height).toBeLessThanOrEqual(nodeBounds.y);
  await expect(page.getByRole("link", { name: /Beacon$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Language: English", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-contacts-390.png") });
  const handle = (await divider.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 50, { steps: 5 });
  await page.mouse.up();
  await packetTab.click();
  await expect(packetPin).toBeChecked();
  expect(backend.subscriptions).toHaveLength(subscriptionCount);
  for (const viewport of [{ width: 360, height: 740 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect(packetTab).toBeVisible();
    expect(await page.locator("html").evaluate(element => ({ x: element.scrollWidth > element.clientWidth, y: element.scrollHeight > element.clientHeight }))).toEqual({ x: false, y: false });
    if (viewport.height < 500) {
      await page.locator("#meshlog-messages").evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(packetPin).toBeInViewport();
      await expect(map).toBeInViewport();
    }
    await page.screenshot({ path: testInfo.outputPath(`mobile-${viewport.width}.png`) });
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Nodes", exact: true })).toBeVisible();
  expect(backend.errors).toEqual([]);
});

test("large retained lists virtualize without losing expansions, pins, or mobile tab state", async ({ page }, testInfo) => {
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin);
  const directory = [liveNode, ...Array.from({ length: 999 }, (_, index) => ({
    ...liveNode, id: `zz-contact-${index.toString().padStart(4, "0")}`, name: `Contact ${index.toString().padStart(4, "0")}`,
    publicKey: (index + 1).toString(16).padStart(64, "0"),
  }))];
  const summaries = Array.from({ length: 80 }, (_, index) => historySummary(`bulk-packet-${index.toString().padStart(4, "0")}`, heardAt - index * 1000));
  const historyLimits: string[] = [];
  await page.route(url => url.pathname === "/api/v1/nodes", route => route.fulfill({ json: { items: directory, nextCursor: null, hasMore: false } }));
  await page.route(url => url.pathname === "/api/v1/packets", route => {
    const url = new URL(route.request().url());
    historyLimits.push(url.searchParams.get("limit")!);
    return route.fulfill({ json: url.searchParams.has("cursor")
      ? { items: summaries.slice(30), nextCursor: null, hasMore: false }
      : { items: summaries.slice(0, 30), nextCursor: 20, hasMore: true } });
  });
  await page.goto("/experimental/meshlog?iata=RIX");
  await expect(page.locator(".meshlog-result-count")).toContainText("Nodes: 1000");
  await expect(page.locator(".meshlog-result-count")).toContainText("Packets: 30");
  await expect.poll(() => page.locator("#meshlog-contacts .meshlog-row").count()).toBeLessThan(80);
  const contact = page.getByRole("button", { name: "Node Detail: Live Walker", exact: true });
  await contact.click();
  await expect(page.locator("#meshlog-contacts")).toContainText("1.12.0");
  await page.locator("#meshlog-contacts").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(contact).toHaveCount(0);
  await page.locator("#meshlog-contacts").evaluate(element => { element.scrollTop = 0; });
  await expect(contact).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#meshlog-contacts")).toContainText("1.12.0");

  const packetRow = page.locator('[data-meshlog-packet="bulk-packet-0000"]');
  const packet = packetRow.locator(".meshlog-row-trigger").first();
  await expect(packetRow.getByRole("checkbox").first()).toBeVisible();
  await packetRow.getByRole("checkbox").first().check();
  await packet.click();
  await expect(packet).toHaveAttribute("aria-expanded", "true");
  await page.locator("#meshlog-messages").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.getByRole("button", { name: "Load older packets", exact: true }).click();
  await expect(page.locator(".meshlog-result-count")).toContainText("Packets: 80");
  expect(historyLimits).toEqual(["30", "50"]);
  await page.locator("#meshlog-messages").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(packetRow).toHaveCount(0);
  expect(await page.locator("[data-meshlog-packet]").count()).toBeLessThan(60);
  await page.locator("#meshlog-messages").evaluate(element => { element.scrollTop = 0; });
  await expect(packet).toHaveAttribute("aria-expanded", "true");
  await expect(packetRow.getByRole("checkbox").first()).toBeChecked();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await expect(contact).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("tab", { name: "Packets", exact: true }).click();
  await expect(packet).toHaveAttribute("aria-expanded", "true");
  await expect(packetRow.getByRole("checkbox").first()).toBeChecked();
  expect(await page.locator("#meshlog-contacts .meshlog-row").count()).toBeLessThan(80);
  await page.screenshot({ path: testInfo.outputPath("virtualized-mobile-retained-state.png") });
  expect(backend.errors).toEqual([]);
});

test("node types use the same searchable multi-select and preserve filters and pins", async ({ page }, testInfo) => {
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin);
  await page.goto("/experimental/meshlog?iata=RIX");
  await expect(page.getByText(liveMessage.content, { exact: true })).toBeVisible();
  const packet = page.locator('[data-meshlog-packet="packet-a"]');
  await packet.getByRole("checkbox").first().check();
  const subscriptionCount = backend.subscriptions.length;
  const nodes = page.locator("#meshlog-contacts");
  const trigger = nodes.getByRole("combobox", { name: /^Node type/ });
  await expect(trigger).toHaveAccessibleName("Node type · All · 4");
  await expect(nodes.getByRole("checkbox", { name: "Companion", exact: true })).toHaveCount(0);
  await trigger.click();
  const options = page.getByRole("listbox", { name: "Node type", exact: true });
  await expect(options.getByRole("option", { selected: true })).toHaveCount(4);
  const search = page.getByRole("combobox", { name: "Search types", exact: true });
  await search.fill("comp");
  await expect(options.getByRole("option")).toHaveCount(1);
  await options.getByRole("option", { name: "Companion", exact: true }).click();
  await expect(options.getByRole("option", { name: "Companion", exact: true })).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Escape");
  await expect(nodes.getByRole("button", { name: "Node Detail: Live Relay", exact: true })).toBeVisible();
  await expect(nodes.getByRole("button", { name: "Node Detail: Live Walker", exact: true })).toHaveCount(0);
  await expect(packet).toHaveCount(0);
  await trigger.click();
  await page.locator(".meshlog-filter-popup").getByRole("button", { name: "All", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(packet.getByRole("checkbox").first()).toBeChecked();
  await expect(trigger).toHaveAccessibleName("Node type · All · 4");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await trigger.click();
  const popup = (await page.locator(".meshlog-filter-popup").boundingBox())!;
  expect(popup.x).toBeGreaterThanOrEqual(0);
  expect(popup.x + popup.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("mobile-node-type-combobox.png") });
  expect(backend.subscriptions).toHaveLength(subscriptionCount);
  expect(backend.errors).toEqual([]);
});

test("overview node circles keep black and white contrast rings on light and dark maps", async ({ page }, testInfo) => {
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin);
  const directory = [
    { ...liveNode, lat: 54, lng: 22 },
    { ...liveNode, id: "contrast-repeater", name: "Contrast repeater", nodeTypeName: "repeater", lat: 56, lng: 24 },
    { ...liveNode, id: "contrast-sensor", name: "Contrast sensor", nodeTypeName: "sensor", lat: 58, lng: 26 },
    { ...liveNode, id: "overlap-one", name: "Overlap one", nodeTypeName: "repeater", lat: 56.03, lng: 24.04 },
    { ...liveNode, id: "overlap-two", name: "Overlap two", nodeTypeName: "repeater", lat: 56.06, lng: 24.08 },
    { ...liveNode, id: "overlap-three", name: "Overlap three", nodeTypeName: "repeater", lat: 56.09, lng: 24.12 },
  ];
  await page.route(url => url.pathname === "/api/v1/nodes", route => route.fulfill({ json: { items: directory, nextCursor: null, hasMore: false } }));
  let background = "#ffffff";
  await page.route("https://tiles.openfreemap.org/styles/dark", async route => {
    // Keep the provider's font configuration, but isolate marker contrast from basemap detail.
    const style = await (await route.fetch()).json();
    return route.fulfill({ json: { ...style, sources: {}, layers: [
      { id: "contrast-background", type: "background", paint: { "background-color": background } },
    ] } });
  });
  for (const theme of ["light", "dark"]) {
    background = theme === "light" ? "#ffffff" : "#111111";
    await page.goto("/experimental/meshlog?iata=RIX");
    await expect(page.locator(".meshlog-map-status")).toHaveCount(0);
    await expect(page.locator(".meshlog-result-count")).toContainText("Nodes: 6");
    await page.screenshot({ path: testInfo.outputPath(`overview-contrast-${theme}.png`) });
  }
  expect(backend.errors).toEqual([]);
});

test("supported contact settings use real age data without hiding packet history or requesting telemetry", async ({ page }, testInfo) => {
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin);
  const now = Date.now();
  const directory = [
    { ...liveNode, iatas: [{ iata: "RIX", lastHeard: now - 30 * 86_400_000 }] },
    { ...liveNode, id: "fresh-contact", name: "Fresh contact", lat: null, lng: null, iatas: [{ iata: "RIX", lastHeard: now }] },
  ];
  const telemetryRequests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).hostname === "telemetry.ite.lt") telemetryRequests.push(request.url()); });
  await page.route(url => url.pathname === "/api/v1/nodes", route => route.fulfill({ json: { items: directory, nextCursor: null, hasMore: false } }));
  await page.goto("/experimental/meshlog?iata=RIX");
  await expect(page.getByText(liveMessage.content, { exact: true })).toBeVisible();
  const nodes = page.locator("#meshlog-contacts");
  const oldContact = nodes.getByRole("button", { name: "Node Detail: Live Walker", exact: true });
  await expect(nodes.getByRole("button", { name: "Node Detail: Fresh contact", exact: true })).toBeVisible();
  await expect(oldContact).toHaveCount(0);
  await nodes.getByRole("button", { name: /Settings$/ }).click();
  const settings = page.locator(".meshlog-popover");
  await expect(settings.getByLabel(/^Expired after/)).toHaveValue("3");
  await expect(settings.getByLabel(/^Very expired after/)).toHaveValue("7");
  const hideAfter = settings.getByLabel(/^Hide after/);
  await expect(hideAfter).toHaveValue("21");
  await expect(settings.getByLabel(/^Clock warning after/)).toHaveValue("30");
  await expect(settings.getByRole("checkbox", { name: /Show advert interval/ })).toBeDisabled();
  await expect(settings.getByRole("checkbox", { name: /Show telemetry/ })).toBeDisabled();
  await hideAfter.fill("365");
  await hideAfter.press("Tab");
  await expect(oldContact).toBeVisible();
  await expect(page.getByText(liveMessage.content, { exact: true })).toBeVisible();
  await settings.getByRole("checkbox", { name: /time warnings/i }).uncheck();
  await settings.getByRole("checkbox", { name: /location warnings/i }).uncheck();
  await hideAfter.fill("21");
  await hideAfter.press("Tab");
  await expect(oldContact).toHaveCount(0);
  await expect(page.getByText(liveMessage.content, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("supported-contact-settings.png") });
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect(nodes.getByRole("button", { name: /Settings$/ })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await nodes.getByRole("button", { name: /Settings$/ }).click();
  const popup = (await settings.boundingBox())!;
  expect(popup.x).toBeGreaterThanOrEqual(0);
  expect(popup.x + popup.width).toBeLessThanOrEqual(390);
  expect(popup.y).toBeGreaterThanOrEqual(0);
  expect(popup.y + popup.height).toBeLessThanOrEqual(844);
  await settings.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(settings.getByRole("checkbox", { name: /Show telemetry/ })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("mobile-contact-settings.png") });
  expect(telemetryRequests).toEqual([]);
  expect(backend.errors).toEqual([]);
});

test("direct observations stay inline with the observer on desktop and mobile", async ({ page }, testInfo) => {
  const observers = [
    { id: "observer-a", displayName: "LT-VM Stadionas A3 OBS", iata: "RIX", status: "online" as const },
    { id: "observer-b", displayName: "Kūmas", iata: "RIX", status: "online" as const },
  ];
  const backend = await liveBackend(page, new URL(testInfo.project.use.baseURL!).origin, false, undefined, observers);
  const detail = historyDetail("packet-advert", ["observer-a", "observer-b"]);
  detail.header.payloadType = 4; detail.header.payloadTypeName = "ADVERT";
  detail.firstHeardAt = detail.lastHeardAt = heardAt + 26_000;
  detail.parsedPayload = undefined;
  detail.observations.forEach(report => {
    report.resolvedSource = { confidence: "high", nodes: [{ id: "internal-bench-uuid", publicKey: "1234567890abcdef", name: "Workshop Bench", latitude: 56.96, longitude: 24.16 }] };
    report.resolvedPath = []; report.resolvedDestination = undefined; report.pathBytes = "";
    report.pathLength = { raw: "00", hopCount: 0, hashSize: 2 };
  });
  await page.route(url => url.pathname === "/api/v1/packets/packet-advert", route => route.fulfill({ json: detail }));
  await page.goto("/experimental/meshlog?iata=RIX");
  const advert = page.locator('[data-meshlog-packet="packet-advert"]');
  await advert.locator(".meshlog-row-trigger").first().click();
  const reports = advert.locator(".meshlog-report");
  await expect(reports).toHaveCount(2);
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (let index = 0; index < 2; index++) {
      const report = reports.nth(index);
      const direct = report.getByText("Direct", { exact: true });
      await expect(direct).toBeVisible();
      await expect.poll(() => direct.evaluate(element => {
        const time = element.closest(".meshlog-report")!.querySelector("time")!.getBoundingClientRect();
        const label = element.getBoundingClientRect();
        return Math.abs(time.y + time.height / 2 - label.y - label.height / 2);
      })).toBeLessThanOrEqual(2);
    }
    await page.screenshot({ path: testInfo.outputPath(`inline-direct-${width}.png`) });
  }
  expect(backend.errors).toEqual([]);
});
