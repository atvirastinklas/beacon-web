import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NodeDetailPanel } from "../../../src/features/nodes/NodeDetailPanel";

import { getNode, getNodeObservations, getNodeNeighbors } from "../../../src/api/client";
import type { Node, NodeNeighbor } from "../../../src/features/nodes/types";

vi.mock("../../../src/api/client", () => ({
  getNode: vi.fn(),
  getNodeObservations: vi.fn(),
  getNodeNeighbors: vi.fn(),
}));

const mockGetNode = vi.mocked(getNode);
const mockGetNodeObservations = vi.mocked(getNodeObservations);
const mockGetNodeNeighbors = vi.mocked(getNodeNeighbors);

const node: Node = {
  id: "node-self",
  publicKey: "aabbccddeeff",
  nodeType: 2,
  nodeTypeName: "REPEATER",
  name: "Self Node",
  lat: null,
  lng: null,
  iatas: [],
  locationSource: null,
  lastAdvertAt: null,
  supportsMultibytePaths: false,
  supportsMultibyteTraces: false,
  minFirmwareVersion: null,
  firstSeen: 1,
  lastSeen: 2,
  metadata: null,
};

function neighbor(id: string, name: string): NodeNeighbor {
  return { id, name, nodeType: 2, nodeTypeName: "REPEATER", iata: "YVR", observationCount: 5, firstSeen: 1, lastSeen: 2 };
}

function renderPanel(onViewNode = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const result = render(<NodeDetailPanel nodeId="node-self" onClose={vi.fn()} onViewObserver={vi.fn()} onViewNode={onViewNode} />, { wrapper });
  return { ...result, onViewNode };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, telemetry: [] }), { status: 200 })));
  mockGetNode.mockReset();
  mockGetNodeObservations.mockReset();
  mockGetNodeNeighbors.mockReset();
  mockGetNode.mockResolvedValue(node);
  mockGetNodeObservations.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
  mockGetNodeNeighbors.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllGlobals());

describe("NodeDetailPanel repeater telemetry", () => {
  it("links the selected repeater's telemetry between timestamps and neighbors", async () => {
    renderPanel();

    const link = await screen.findByRole("link", { name: "Telemetry" });
    expect(link).toHaveAttribute("href", "https://telemetry.ite.lt/api/#aabbccddeeff");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(link).toHaveAccessibleName("Telemetry");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Timestamps").compareDocumentPosition(link) & document.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(screen.getByText("Neighbors")) & document.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not show or fetch repeater telemetry for a client node", async () => {
    mockGetNode.mockResolvedValue({ ...node, nodeType: 1, nodeTypeName: "client" });

    renderPanel();

    await screen.findByText("Self Node");
    expect(screen.queryByRole("link", { name: "Telemetry" })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("switches the public-key link and readings without bleeding the previous repeater's data", async () => {
    let resolveSecond!: (response: Response) => void;
    const response = (battery_v: number) => new Response(JSON.stringify({ success: true, telemetry: [
      { iso: "2026-10-14T13:24:57+03:00", battery_v, temperature_c: 20, rssi: -118, snr: -9.75 },
    ] }));
    const telemetryFetch = vi.fn()
      .mockResolvedValueOnce(response(4.15))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSecond = resolve; }));
    vi.stubGlobal("fetch", telemetryFetch);
    mockGetNode.mockImplementation(async (id) => id === "node-self"
      ? node
      : { ...node, id, name: "Other repeater", nodeTypeName: "repeater", publicKey: "112233445566" });
    const { rerender } = renderPanel();
    expect(await screen.findByText("4.15 V", { selector: "figcaption span" })).toBeInTheDocument();

    rerender(<NodeDetailPanel nodeId="node-other" onClose={vi.fn()} onViewObserver={vi.fn()} />);

    await screen.findByText("Other repeater");
    expect(screen.getByRole("link", { name: "Telemetry" })).toHaveAttribute("href", "https://telemetry.ite.lt/api/#112233445566");
    expect(screen.queryByText("4.15 V", { selector: "figcaption span" })).not.toBeInTheDocument();
    expect(screen.queryByRole("application")).not.toBeInTheDocument();
    await waitFor(() => expect(telemetryFetch).toHaveBeenLastCalledWith(
      "https://telemetry.ite.lt/api/node/112233445566", expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    await act(async () => resolveSecond(response(3.8)));
    expect(await screen.findByText("3.8 V", { selector: "figcaption span" })).toBeInTheDocument();
  });
});

describe("NodeDetailPanel neighbors", () => {
  it("shows the server's possibly-foreign indication", async () => {
    mockGetNode.mockResolvedValue({ ...node, possiblyForeign: true });
    renderPanel();
    expect(await screen.findByText("Possibly foreign")).toBeInTheDocument();
  });

  it.each([false, undefined])("does not label unflagged nodes as foreign (%s)", async (possiblyForeign) => {
    mockGetNode.mockResolvedValue({ ...node, possiblyForeign });
    renderPanel();
    await screen.findByText("Self Node");
    expect(screen.queryByText("Possibly foreign")).not.toBeInTheDocument();
  });
  it("lists each neighbor's name in a Neighbors section", async () => {
    mockGetNodeNeighbors.mockResolvedValue([neighbor("n-1", "Neighbor A"), neighbor("n-2", "Neighbor B")]);

    renderPanel();

    expect(await screen.findByText("Neighbors")).toBeInTheDocument();
    expect(await screen.findByText("Neighbor A")).toBeInTheDocument();
    expect(screen.getByText("Neighbor B")).toBeInTheDocument();
    expect(mockGetNodeNeighbors).toHaveBeenCalledWith("node-self");
  });

  it("navigates to a neighbor when its row is clicked", async () => {
    mockGetNodeNeighbors.mockResolvedValue([neighbor("n-1", "Neighbor A")]);

    const { onViewNode } = renderPanel();

    fireEvent.click(await screen.findByText("Neighbor A"));
    expect(onViewNode).toHaveBeenCalledWith("n-1");
  });

  it("shows an empty state when there are no neighbors", async () => {
    mockGetNodeNeighbors.mockResolvedValue([]);

    renderPanel();

    expect(await screen.findByText("No known neighbors")).toBeInTheDocument();
  });
});

describe("NodeDetailPanel location", () => {
  it("hides Lat/Lng but keeps the source for a 0/0 advert reset", async () => {
    mockGetNode.mockResolvedValue({ ...node, lat: 0, lng: 0, locationSource: "advert" });

    renderPanel();

    expect(await screen.findByText("Source")).toBeInTheDocument();
    expect(screen.queryByText("Lat")).not.toBeInTheDocument();
    expect(screen.queryByText("Lng")).not.toBeInTheDocument();
  });
});

describe("NodeDetailPanel clock drift", () => {
  it("shows a repeater's clock drift in amber when the server flags it out of sync", async () => {
    mockGetNode.mockResolvedValue({ ...node, lastAdvertAt: 2, clockDriftSeconds: 432, clockOutOfSync: true, clockCheckedAt: 2 });

    renderPanel();

    const drift = await screen.findByText("+7m 12s ahead");
    expect(drift.className).toContain("text-warn");
  });

  it("shows an in-sync drift in green", async () => {
    mockGetNode.mockResolvedValue({ ...node, lastAdvertAt: 2, clockDriftSeconds: 20, clockOutOfSync: false, clockCheckedAt: 2 });

    renderPanel();

    const drift = await screen.findByText("+20s ahead");
    expect(drift.className).toContain("text-green");
  });

  it("omits clock drift entirely when the node reports none", async () => {
    renderPanel();

    await screen.findByText("Timestamps");
    expect(screen.queryByText(/Clock drift/i)).not.toBeInTheDocument();
  });
});

describe("NodeDetailPanel View on map", () => {
  function renderWithMap(onViewOnMap?: (lat: number, lng: number) => void) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <NodeDetailPanel nodeId="node-self" onClose={vi.fn()} onViewObserver={vi.fn()} onViewOnMap={onViewOnMap} />
      </QueryClientProvider>,
    );
  }

  it("sends the node's coordinates", async () => {
    mockGetNode.mockResolvedValue({ ...node, lat: 45.42153, lng: -75.69719 });
    const onViewOnMap = vi.fn();
    renderWithMap(onViewOnMap);
    fireEvent.click(await screen.findByRole("button", { name: "View on map" }));
    expect(onViewOnMap).toHaveBeenCalledWith(45.42153, -75.69719);
  });

  it("is not offered for a node without a location", async () => {
    renderWithMap(vi.fn());
    await screen.findByText("Self Node");
    expect(screen.queryByRole("button", { name: "View on map" })).not.toBeInTheDocument();
  });

  it("is not offered when the caller has no map to open", async () => {
    mockGetNode.mockResolvedValue({ ...node, lat: 45.42153, lng: -75.69719 });
    renderWithMap();
    await screen.findByText("Self Node");
    expect(screen.queryByRole("button", { name: "View on map" })).not.toBeInTheDocument();
  });


  it("is not offered for an explicit 0/0 advert reset", async () => {
    mockGetNode.mockResolvedValue({ ...node, lat: 0, lng: 0 });
    renderWithMap(vi.fn());
    await screen.findByText("Self Node");
    expect(screen.queryByRole("button", { name: "View on map" })).not.toBeInTheDocument();
  });

  it("is still offered when only one axis is zero", async () => {
    mockGetNode.mockResolvedValue({ ...node, lat: 0, lng: 10 });
    const onViewOnMap = vi.fn();
    renderWithMap(onViewOnMap);
    fireEvent.click(await screen.findByRole("button", { name: "View on map" }));
    expect(onViewOnMap).toHaveBeenCalledWith(0, 10);
  });
});

describe("NodeDetailPanel recent packets", () => {
  it("labels the expiring packet list as recent packets", async () => {
    renderPanel();
    expect(await screen.findByText("Recent packets")).toBeInTheDocument();
    expect(await screen.findByText("No recent packets")).toBeInTheDocument();
    expect(screen.queryByText("Observations")).not.toBeInTheDocument();
  });
});
