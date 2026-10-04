import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PathsTab } from "../../../src/features/stats/PathsTab";
import { usePathStats } from "../../../src/features/stats/usePathStats";



const query = { data: { since: 0, until: 3600000, receptions: 100, hashed: 60, empty: 20, trace: 10, unclassified: 10,
  hashWidths: [{ bytes: 1, receptions: 20 }, { bytes: 2, receptions: 30 }, { bytes: 3, receptions: 10 }], pathLengths: [{ entries: 0, receptions: 20 }, { entries: 2, receptions: 60 }],
  hourly: [{ hour: 0, receptions: 100, oneByte: 20, twoByte: 30, threeByte: 10, empty: 20, trace: 10, unclassified: 10 }] }, isPending: false, isPlaceholderData: false, isError: false, isFetching: false, refetch: vi.fn() };
vi.mock("../../../src/features/stats/usePathStats", () => ({ usePathStats: vi.fn(() => query) }));
const originalData = query.data;
vi.mock("../../../src/features/stats/EChart", () => ({ EChart: vi.fn(() => <div data-testid="chart" />) }));
beforeEach(() => { query.data = originalData; query.isPending = false; query.isPlaceholderData = false; query.isError = false; vi.clearAllMocks(); });



it("uses only nonempty hash paths for multi-byte share, exposes categories and explains remaining routes", () => {
  render(<PathsTab range="24h" />);
  expect(usePathStats).toHaveBeenCalledWith("24h");
  expect(screen.getByText("66.7%")).toBeInTheDocument();
  expect(screen.getByText(/unclassified packets/i)).toHaveTextContent("no usable path data");
  const table = screen.getByRole("table", { name: "Path classification counts" });
  expect(within(table).getByRole("row", { name: /Hash paths.*60.*60.0%/ })).toBeInTheDocument();
  expect(within(table).getByRole("row", { name: /Empty.*20.*20.0%/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Refresh/ })).not.toBeInTheDocument();
});
it.each(["isPending", "isPlaceholderData", "isError"] as const)("hides old values when %s", (state) => {
  query[state] = true; render(<PathsTab range="7d" />);
  expect(screen.queryByText("66.7%")).not.toBeInTheDocument();
  expect(screen.queryAllByTestId("chart")).toHaveLength(0);
  if (state === "isError") expect(screen.getByRole("alert")).toHaveTextContent("shorter");
});



it("draws hourly sparks for observations, hash paths, multi-byte share and most path entries", () => {
  const hour = (h: number) => ({ hour: h * 3600000, receptions: 50 + h, oneByte: 10, twoByte: 5 + h, threeByte: 1, empty: 5, trace: 1, unclassified: 1, maxEntries: 3 + h });
  query.data = { ...originalData, until: 3 * 3600000, hourly: [hour(0), hour(1), hour(2)] };
  const { container } = render(<PathsTab range="24h" />);
  expect(container.querySelectorAll("polyline")).toHaveLength(4);
});
