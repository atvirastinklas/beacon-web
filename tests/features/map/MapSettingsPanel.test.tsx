import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MapSettingsPanel } from "../../../src/features/map/MapSettingsPanel";

describe("map settings", () => {
  it("locks clustering off with a persistent explanation while Live Map runs", () => {
    const change = vi.fn();
    render(<MapSettingsPanel styleId="dark" onStyleChange={() => {}} typeFilter="" onTypeChange={() => {}}
      clustered={false} clusteringDisabled onClusteredChange={change} neighborLines="off" onNeighborLinesChange={() => {}}
      borders={false} onBordersChange={() => {}} buildShareParams={() => ({})} />);
    const group = screen.getByRole("group", { name: "Clustering" });
    const on = within(group).getByRole("button", { name: "On" });
    const off = within(group).getByRole("button", { name: "Off" });
    expect(on).toBeDisabled();
    expect(off).toBeDisabled();
    expect(off).toHaveAttribute("aria-pressed", "true");
    expect(group).toHaveAccessibleDescription("Clustering is off while Live Map is running.");
    fireEvent.click(on);
    expect(change).not.toHaveBeenCalled();
  });
});
