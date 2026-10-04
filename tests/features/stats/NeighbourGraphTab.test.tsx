import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NeighbourGraphTab } from "../../../src/features/stats/NeighbourGraphTab";
import type { NodeSummary } from "../../../src/features/nodes/types";

const region = { iatas: ["YVR"] as string[] | undefined, regionKey: "YVR" };
const nodes = { nodes: [] as NodeSummary[], loadedCount: 0, isPaging: false, isError: false };
vi.mock("../../../src/hooks/useRegion", () => ({ useRegion: () => region }));
vi.mock("../../../src/features/map/useMapNodesData", () => ({ useMapNodesData: () => nodes }));
vi.mock("../../../src/features/stats/NeighbourGraph", () => ({ NeighbourGraph: () => null }));
vi.mock("../../../src/api/client", () => ({ getNodeNeighbors: vi.fn() }));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><NeighbourGraphTab /></QueryClientProvider>);
}

beforeEach(() => {
  region.iatas = ["YVR"]; region.regionKey = "YVR";
  Object.assign(nodes, { nodes: [], loadedCount: 0, isPaging: false, isError: false });
});

it("asks for a region before loading when All is selected", () => {
  region.iatas = undefined;
  region.regionKey = "*";
  mount();
  expect(screen.getByText("Pick a region")).toBeInTheDocument();
});
