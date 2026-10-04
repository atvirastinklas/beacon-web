import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ClockDriftTab } from "../../../src/features/stats/ClockDriftTab";

import type { ClockDriftEntry } from "../../../src/features/stats/types";
import i18n from "../../../src/i18n";

const rows: ClockDriftEntry[] = [
  { nodeId: "fixture-a", nodeName: "Alpha", nodeType: 2, nodeTypeName: "Repeater", clockDriftSeconds: 3599, clockCheckedAt: 1000, iatas: [{ iata: "YVR", lastHeard: 1000 }] },
  { nodeId: "fixture-b", nodeName: "Beta", nodeType: 3, nodeTypeName: "Room", clockDriftSeconds: -3600, clockCheckedAt: 2000, iatas: [{ iata: "YOW", lastHeard: 2000 }] },
];
const query = { data: rows, isLoading: false, isPending: false, isPlaceholderData: false, isError: false, isFetching: false };
vi.mock("../../../src/features/stats/useStats", () => ({ useClockDrift: vi.fn(() => query) }));
beforeEach(() => { vi.clearAllMocks(); query.data = rows; query.isLoading = false; query.isPending = false; query.isPlaceholderData = false; query.isError = false; query.isFetching = false; });



it.each(["isPending", "isPlaceholderData", "isError"] as const)("shows the %s state without cached rows", async (state) => {
  query[state] = true;
  await act(() => i18n.changeLanguage("en"));
  render(<ClockDriftTab />);
  expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  if (state === "isError") expect(screen.getByText("Failed to load")).toBeInTheDocument();
  else expect(screen.queryByText("No repeaters out of sync")).not.toBeInTheDocument();
});


it("retains valid values during a healthy background refresh", () => {
  query.isFetching = true;
  render(<ClockDriftTab />);
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.getByText("+59m 59s ahead")).toHaveClass("text-warn");
  expect(screen.getByText("-1h 0m behind")).toHaveClass("text-danger");
});

it("shows compact cards instead of a wide table on a phone, worst first", async () => {
  await act(() => i18n.changeLanguage("en"));
  const media = window.matchMedia("(max-width: 767px)");
  const spy = vi.spyOn(window, "matchMedia").mockImplementation((q) => ({ ...media, media: q, matches: q === "(max-width: 767px)" }));
  try {
    const { container } = render(<ClockDriftTab />);
    expect(container.querySelector("table")).toBeNull();
    const cards = screen.getAllByRole("button", { name: /Beta|Alpha/ });
    expect(cards.map((c) => c.textContent)).toEqual([expect.stringContaining("Beta"), expect.stringContaining("Alpha")]);
    expect(cards[0]).toHaveTextContent("-1h 0m behind");
    expect(cards[0]).toHaveTextContent("YOW");
  } finally {
    spy.mockRestore();
  }
});
