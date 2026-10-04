import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TrafficTab } from "../../../src/features/stats/TrafficTab";
import { useStatsObservations } from "../../../src/features/stats/useStats";



const query = { data: [{ hour: Date.UTC(2026, 8, 19, 12), iata: "YOW", observationCount: 1200, uniquePackets: 9999, activeObservers: 88 }], dataUpdatedAt: Date.UTC(2026, 8, 19, 12, 30), isPending: false, isLoading: false, isPlaceholderData: false, isError: false, isFetching: false, refetch: vi.fn() };
const originalData = query.data;
vi.mock("../../../src/features/stats/useStats", () => ({ useStatsObservations: vi.fn(() => query) }));
vi.mock("../../../src/features/stats/EChart", () => ({ EChart: vi.fn(() => <div data-testid="chart" />) }));

beforeEach(() => {
  query.data = originalData; query.isPending = false; query.isLoading = false; query.isPlaceholderData = false; query.isError = false; query.isFetching = false;
  vi.clearAllMocks();
});

describe("Traffic page", () => {




  it("shows exact reception counts and UTC/missing-history guidance without a refresh action", () => {
    render(<TrafficTab range="24h" />);
    expect(useStatsObservations).toHaveBeenCalledWith("24h");
    const table = screen.getByRole("table", { name: "Observations by area" });
    expect(within(table).getByRole("row", { name: /YOW.*1,200.*100.0%/ })).toBeInTheDocument();
    expect(screen.queryByText("9,999")).not.toBeInTheDocument();
    expect(screen.getByText(/not unique packets/)).toHaveTextContent(/UTC.*outage/);
    expect(screen.queryByRole("button", { name: /Refresh/ })).not.toBeInTheDocument();
  });

  it("does not display previous-region data while a new query is loading", () => {
    query.isPlaceholderData = true;
    render(<TrafficTab range="7d" />);
    expect(screen.queryByText("YOW")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("chart")).toHaveLength(0);
  });

  it("provides a visible error state without stale chart values", () => {
    query.isError = true;
    render(<TrafficTab range="30d" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load traffic");
    expect(screen.queryByText("YOW")).not.toBeInTheDocument();
  });
});

it("draws hourly sparks for observations, areas and the busiest hour, and a presence strip for active hours", () => {
  const at = (h: number, iata: string, n: number) => ({ hour: Date.UTC(2026, 8, 19, h), iata, observationCount: n, uniquePackets: 0, activeObservers: 0 });
  query.data = [at(10, "YOW", 5), at(11, "YOW", 9), at(11, "YUL", 2), at(12, "YOW", 3)];
  const { container } = render(<TrafficTab range="24h" />);
  expect(container.querySelectorAll("polyline")).toHaveLength(3);
  expect(container.querySelectorAll("[data-peak]")).toHaveLength(1);
  expect(container.querySelectorAll("rect")).toHaveLength(1);
});
