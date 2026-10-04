import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ScopesTab } from "../../../src/features/stats/ScopesTab";

import i18n from "../../../src/i18n";
const query = { data: [
  { name: "#west", packetCount: 3, observerCount: 2, nodeCount: 2 },
  { name: "#east", packetCount: 2, observerCount: 2, nodeCount: 3 },
], isPending: false, isLoading: false, isPlaceholderData: false, isError: false, isFetching: false, refetch: vi.fn() };
const originalData = query.data;
const H = 3_600_000;
const seriesQuery = { data: { hours: [0, 1, 2].map((i) => ({ hour: i * H, status: "complete", values: null })) }, isSuccess: true, isPlaceholderData: false };
vi.mock("../../../src/features/stats/useStats", () => ({ useScopes: () => query, useStatsSeries: () => seriesQuery }));
vi.mock("../../../src/features/stats/EChart", () => ({ EChart: vi.fn(() => <div data-testid="chart" />) }));
beforeEach(() => { vi.clearAllMocks(); query.data = originalData; query.isError = false; query.isPending = false; query.isPlaceholderData = false; });





it("shows exact scope counts, keeps membership semantics explicit and filters the whole view", () => {
  render(<ScopesTab range="24h" />);
  const table = screen.getByRole("table", { name: "Scope counts" });
  expect(within(table).getByRole("row", { name: /#west.*3.*2.*2/ })).toBeInTheDocument();
  expect(screen.getByText("Observers by scope")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /an observer can belong/ })).toBeInTheDocument();
  expect(screen.queryByText(/an observer can belong/, { selector: "p" })).not.toBeInTheDocument();
  expect(screen.getByText(/Scope activity/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a scope" }), { target: { value: "WEST" } });
  expect(screen.queryByText("#east")).not.toBeInTheDocument();
  expect(screen.getByText(/1 of 2 scopes/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Refresh/ })).not.toBeInTheDocument();
});

it("hides stale values while a region change is pending and on errors", () => {
  query.isPlaceholderData = true;
  const { rerender } = render(<ScopesTab range="24h" />);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryAllByTestId("chart")).toHaveLength(0);
  query.isPlaceholderData = false; query.isError = true; rerender(<ScopesTab range="24h" />);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not load scopes");
  expect(screen.queryByText("#west")).not.toBeInTheDocument();
});

it("draws hourly sparks on all four scope cards from the scopes left after searching", () => {
  query.data = [
    { name: "#west", packetCount: 3, observerCount: 2, nodeCount: 2, hourly: [{ hour: 0, packets: 1, observers: 1, nodes: 1 }, { hour: 2 * H, packets: 2, observers: 2, nodes: 0 }] },
    { name: "#east", packetCount: 2, observerCount: 2, nodeCount: 3, hourly: [{ hour: H, packets: 2, observers: 1, nodes: 3 }] },
  ] as typeof originalData;
  const { container } = render(<ScopesTab range="24h" />);
  const points = () => [...container.querySelectorAll("polyline")].map((l) => l.getAttribute("points"));
  expect(points()).toHaveLength(4);
  expect(screen.getByText("Line: hearing per hour")).toBeInTheDocument();
  expect(screen.getByText("Line: advertising per hour")).toBeInTheDocument();
  const before = points();
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a scope" }), { target: { value: "east" } });
  expect(points()).toHaveLength(4);
  expect(points()).not.toEqual(before);
});

it("shows no scoped packet total before any hour is rolled, keeping the membership counts", async () => {
  await act(() => i18n.changeLanguage("en"));
  const saved = seriesQuery.data;
  seriesQuery.data = { ...saved, completeHours: 0 } as typeof saved;
  try {
    render(<ScopesTab range="24h" />);
    expect(within(screen.getByText("Scoped packets").parentElement!.parentElement!).getByText("—")).toBeInTheDocument();
    expect(within(screen.getAllByText("Observers")[0]!.parentElement!.parentElement!).getByText("4")).toBeInTheDocument();
  } finally { seriesQuery.data = saved; }
});
