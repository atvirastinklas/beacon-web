import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SignalTab } from "../../../src/features/stats/SignalTab";
import { useSignalStats } from "../../../src/features/stats/useSignalStats";


import type { SignalStats } from "../../../src/features/stats/types";

const query = { data: { since: 0, until: 3600000, receptions: 100, snr: { samples: 80, average: 0, histogram: [{ lower: -5, upper: 0, count: 80 }] }, rssi: { samples: 90, average: -102.5, histogram: [{ lower: -110, upper: -100, count: 90 }] }, hourly: [{ hour: 0, receptions: 100, snrSamples: 80, snrAverage: 0, rssiSamples: 90, rssiAverage: -102.5 }] } as SignalStats, isPending: false, isPlaceholderData: false, isError: false, isFetching: false, refetch: vi.fn() };
const originalData = query.data;
vi.mock("../../../src/features/stats/useSignalStats", () => ({ useSignalStats: vi.fn(() => query) }));
vi.mock("../../../src/features/stats/EChart", () => ({ EChart: vi.fn(() => <div data-testid="chart" />) }));
beforeEach(() => { query.data = originalData; query.isPending = false; query.isPlaceholderData = false; query.isError = false; vi.clearAllMocks(); });


it("shows measured units and exact sample coverage without treating zero SNR as missing", () => {
  render(<SignalTab range="24h" />);
  expect(useSignalStats).toHaveBeenCalledWith("24h");
  expect(screen.getByText("0.0 dB")).toBeInTheDocument();
  expect(screen.getByText("-102.5 dBm")).toBeInTheDocument();
  expect(screen.getByText(/last hop/i)).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "Signal sample availability" });
  expect(within(table).getByRole("row", { name: /SNR.*80.*20.*80.0%/ })).toBeInTheDocument();
  expect(within(table).getByRole("row", { name: /RSSI.*90.*10.*90.0%/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Refresh/ })).not.toBeInTheDocument();
});
it.each(["isPending", "isPlaceholderData", "isError"] as const)("hides previous filter values when %s", (state) => {
  query[state] = true;
  render(<SignalTab range="7d" />);
  expect(screen.queryByText("-102.5 dBm")).not.toBeInTheDocument();
  expect(screen.queryAllByTestId("chart")).toHaveLength(0);
  if (state === "isError") expect(screen.getByRole("alert")).toHaveTextContent("shorter");
});




it("draws hourly sparks for observations, SNR and RSSI, and a presence strip for hours with records", () => {
  const hour = (h: number) => ({ hour: h * 3600000, receptions: 10 + h, snrSamples: 5, snrAverage: h, rssiSamples: 5, rssiAverage: -100 - h });
  query.data = { ...originalData, until: 3 * 3600000, hourly: [hour(0), hour(1), hour(2)] };
  const { container } = render(<SignalTab range="24h" />);
  expect(container.querySelectorAll("polyline")).toHaveLength(3);
  expect(container.querySelectorAll("rect")).toHaveLength(1);
});
