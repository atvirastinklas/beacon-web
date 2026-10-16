import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RepeaterTelemetry from "../../../src/features/nodes/RepeaterTelemetry";
import i18n from "../../../src/i18n";

const readings = [
  { iso: "2026-10-11T00:00:00+03:00", battery_v: 4.2, temperature_c: 18, rssi: -120, snr: -11 },
  { iso: "2026-10-11T01:00:00+03:00", battery_v: 4.18, temperature_c: 19, rssi: -119, snr: -10 },
  { iso: "2026-10-14T13:24:57+03:00", battery_v: 4.15, temperature_c: 20, rssi: -118, snr: -9.75 },
];

function success(telemetry: Array<{ iso: string; battery_v: number | null; temperature_c: number | null; rssi: number | null; snr: number | null }> = readings) {
  return new Response(JSON.stringify({ success: true, telemetry }), { status: 200 });
}

function renderTelemetry(publicKey = "aabbccddeeff", client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <RepeaterTelemetry publicKey={publicKey} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    return this.id === "recharts_measurement_span"
      ? new DOMRect(0, 0, (this.textContent?.length ?? 0) * 6, 12)
      : new DOMRect(0, 0, 376, 112);
  });
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RepeaterTelemetry", () => {
  it("loads the selected public key without blocking the surrounding details", () => {
    const intervals = vi.spyOn(globalThis, "setInterval");
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);

    renderTelemetry();

    expect(screen.getByRole("status")).toHaveTextContent("Loading...");
    expect(fetch).toHaveBeenCalledWith(
      "https://telemetry.ite.lt/api/node/aabbccddeeff",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(intervals).not.toHaveBeenCalled();
  });

  it("renders four compact, unit-labelled charts with latest values and actual elapsed-time spacing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(success()));

    renderTelemetry();

    const battery = await screen.findByRole("application", { name: "Battery (V) over time" });
    expect(screen.getAllByRole("application")).toHaveLength(4);
    expect(screen.getByRole("application", { name: "Temperature (°C) over time" })).toBeInTheDocument();
    expect(screen.getByRole("application", { name: "RSSI (dBm) over time" })).toBeInTheDocument();
    expect(screen.getByRole("application", { name: "SNR (dB) over time" })).toBeInTheDocument();
    for (const value of ["4.15 V", "20 °C", "-118 dBm", "-9.75 dB"]) {
      expect(screen.getByText(value, { selector: "figcaption span" })).toBeInTheDocument();
    }
    expect(screen.getByText("Latest reading:")).toBeInTheDocument();
    expect(battery).toHaveAttribute("height", "112");
    expect(battery.querySelector(".recharts-yAxis-tick-labels")).toHaveTextContent("V");
    await waitFor(() => expect(battery.querySelectorAll(".recharts-line-dots circle")).toHaveLength(3));
    const dots = Array.from(battery.querySelectorAll(".recharts-line-dots circle"));
    const x = dots.map((dot) => Number(dot.getAttribute("cx")));
    expect(x[1]! - x[0]!).toBeGreaterThan(0);
    expect(x[1]! - x[0]!).toBeLessThan((x[2]! - x[0]!) / 10);
    const stroke = battery.querySelector(".recharts-line-curve");
    expect(stroke?.getAttribute("d")).not.toMatch(/[CQ]/);
    expect(stroke).not.toHaveAttribute("stroke-dasharray");
  });

  it("matches neighboring detail fields with dim labels and normal values", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(success()));
    renderTelemetry();

    const latestLabel = await screen.findByText("Latest reading:");
    expect(latestLabel).toHaveClass("text-text-dim");
    expect(latestLabel.nextElementSibling).toHaveClass("text-text-normal");
    for (const figure of screen.getAllByRole("figure")) {
      const caption = figure.querySelector("figcaption")!;
      expect(caption.firstElementChild).toHaveClass("text-text-dim");
      expect(caption.firstElementChild?.querySelector("span")).toHaveClass("text-text-dim");
      expect(caption.lastElementChild).toHaveClass("text-text-normal");
    }
  });

  it("keeps a single reading as a finite visible dot on each independent chart", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(success([readings[2]!])));

    renderTelemetry();

    await screen.findByRole("application", { name: "Battery (V) over time" });
    for (const chart of screen.getAllByRole("application")) {
      await waitFor(() => expect(chart.querySelectorAll(".recharts-line-dots circle")).toHaveLength(1));
      const dot = chart.querySelector(".recharts-line-dots circle")!;
      expect(Number(dot.getAttribute("cx"))).toBeGreaterThanOrEqual(68);
      expect(Number(dot.getAttribute("cx"))).toBeLessThanOrEqual(364);
      expect(Number(dot.getAttribute("cy"))).toBeGreaterThanOrEqual(6);
      expect(Number(dot.getAttribute("cy"))).toBeLessThanOrEqual(88);
      expect(chart.innerHTML).not.toMatch(/NaN|Infinity/);
    }
  });

  it("leaves null samples as gaps and does not substitute an older latest value", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(success([
      { ...readings[0]!, temperature_c: null },
      { ...readings[1]!, battery_v: null, temperature_c: null },
      { ...readings[2]!, temperature_c: null },
      { ...readings[2]!, iso: "2026-10-14T14:00:00+03:00", battery_v: null, temperature_c: null },
    ])));

    renderTelemetry();

    const chart = await screen.findByRole("application", { name: "Battery (V) over time" });
    await waitFor(() => expect(chart.querySelectorAll(".recharts-line-dots circle")).toHaveLength(2));
    expect(chart.querySelector(".recharts-line-curve")?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(chart.closest("figure")?.querySelector("figcaption")).toHaveTextContent("—");
    expect(chart.closest("figure")?.querySelector("figcaption")).not.toHaveTextContent("4.15");
    expect(screen.queryByRole("application", { name: "Temperature (°C) over time" })).not.toBeInTheDocument();
    expect(screen.getByText("No readings for this metric.")).toBeInTheDocument();
    expect(screen.getAllByRole("figure")).toHaveLength(4);
  });

  it("recovers from a network error only when the user retries", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetch);

    renderTelemetry();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load telemetry.");
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("application", { name: "Battery (V) over time" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([200, 404])("shows a quiet empty state for an empty response (%s)", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      status === 404 ? new Response(null, { status }) : success([]),
    ));

    renderTelemetry();

    expect(await screen.findByText("No telemetry readings available.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("application")).not.toBeInTheDocument();
  });

  it("supports keyboard reading tooltips and redraws their labels and units in Lithuanian", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(success()));
    renderTelemetry();

    const battery = await screen.findByRole("application", { name: "Battery (V) over time" });
    expect(battery).toHaveAccessibleDescription(/left and right arrow keys/);
    fireEvent.focus(battery);
    fireEvent.keyDown(battery, { key: "ArrowRight" });

    const tooltip = await screen.findByRole("status");
    expect(tooltip).toHaveTextContent("Battery");
    expect(tooltip).toHaveTextContent("4.18 V");
    expect(tooltip).toHaveTextContent("2026");

    await act(() => i18n.changeLanguage("lt"));
    expect(screen.getByRole("application", { name: "Baterija (V) kitimas laike" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Baterija");
    expect(screen.getByRole("status")).toHaveTextContent("4,18 V");
    expect(screen.getByText("Paskutinė telemetrija:")).toBeInTheDocument();
    expect(screen.getByText("4,15 V", { selector: "figcaption span" })).toBeInTheDocument();
  });

  it("reuses the five-minute cache on reopen and refreshes expired data only on another open", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetch = vi.fn()
      .mockResolvedValueOnce(success())
      .mockResolvedValueOnce(success([{ ...readings[2]!, battery_v: 4.05 }]));
    vi.stubGlobal("fetch", fetch);

    const first = renderTelemetry("aabbccddeeff", client);
    await screen.findByText("4.15 V", { selector: "figcaption span" });
    const query = client.getQueryCache().getAll()[0]!;
    await act(async () => {
      client.setQueryData(query.queryKey, query.state.data, { updatedAt: Date.now() - 299_000 });
    });
    first.unmount();
    const second = renderTelemetry("aabbccddeeff", client);
    expect(screen.getByText("4.15 V", { selector: "figcaption span" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      client.setQueryData(query.queryKey, query.state.data, { updatedAt: Date.now() - 300_001 });
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("4.15 V", { selector: "figcaption span" })).toBeInTheDocument();

    second.unmount();
    renderTelemetry("aabbccddeeff", client);
    expect(await screen.findByText("4.05 V", { selector: "figcaption span" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([296, 376])("keeps all four plots within their %spx mobile/sidebar content width", async (width) => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function () {
      return this.id === "recharts_measurement_span"
        ? new DOMRect(0, 0, (this.textContent?.length ?? 0) * 6, 12)
        : new DOMRect(0, 0, width, 112);
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(success()));
    renderTelemetry();

    await screen.findByRole("application", { name: "Battery (V) over time" });
    for (const chart of screen.getAllByRole("application")) {
      expect(chart).toHaveAttribute("viewBox", `0 0 ${width} 112`);
      const dots = chart.querySelectorAll(".recharts-line-dots circle");
      expect(dots).toHaveLength(3);
      for (const dot of dots) {
        expect(Number(dot.getAttribute("cx"))).toBeGreaterThanOrEqual(68);
        expect(Number(dot.getAttribute("cx"))).toBeLessThanOrEqual(width - 12);
      }
    }
  });
});
