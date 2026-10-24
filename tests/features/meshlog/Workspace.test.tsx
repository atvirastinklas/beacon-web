import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "../../../src/features/meshlog/Workspace";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("responsive Meshlog workspace", () => {
  it("keeps the map mounted above a tabbed, adjustable mobile panel and preserves both panels", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(max-width: 900px)", media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList));
    render(<Workspace header={<button>Shared header</button>}>
      <section><label>Packet search<input defaultValue="retained" /></label></section>
      <section data-testid="persistent-map">Map</section>
      <section><button>Contact details</button></section>
    </Workspace>);
    const map = screen.getByTestId("persistent-map");
    expect(screen.getByRole("button", { name: "Shared header" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Packets" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Contacts" }));
    expect(screen.getByRole("button", { name: "Contact details" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Shared header" })).toBeVisible();
    expect(screen.getByTestId("persistent-map")).toBe(map);
    fireEvent.click(screen.getByRole("tab", { name: "Packets" }));
    expect(screen.getByRole("textbox", { name: "Packet search" })).toHaveValue("retained");
    const divider = screen.getByRole("separator", { name: "Map / panel" });
    act(() => divider.focus());
    expect(divider).toHaveAttribute("aria-orientation", "horizontal");
    const before = Number(divider.getAttribute("aria-valuenow"));
    fireEvent.keyDown(divider, { key: "ArrowDown" });
    expect(Number(divider.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
    fireEvent.keyDown(divider, { key: "Home" });
    expect(divider.getAttribute("aria-valuenow")).toBe(divider.getAttribute("aria-valuemin"));
    fireEvent.keyDown(divider, { key: "End" });
    expect(divider.getAttribute("aria-valuenow")).toBe(divider.getAttribute("aria-valuemax"));
    const beforeDrag = divider.getAttribute("aria-valuenow");
    const pointer = (type: string, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientY: y });
      Object.defineProperty(event, "pointerId", { value: 7 }); Object.defineProperty(event, "pointerType", { value: "touch" });
      fireEvent(divider, event);
    };
    pointer("pointerdown", 200); pointer("pointermove", -10000);
    expect(divider.getAttribute("aria-valuenow")).toBe(divider.getAttribute("aria-valuemin"));
    pointer("pointercancel", -10000);
    expect(divider.getAttribute("aria-valuenow")).toBe(beforeDrag);
    expect(screen.getByTestId("persistent-map")).toBe(map);
  });

  it("keeps both desktop panes accessible without mobile tabs", () => {
    render(<Workspace header={<span>Header</span>}><section>Packets pane</section><section>Map</section><section>Contacts pane</section></Workspace>);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText("Packets pane")).toBeVisible();
    expect(screen.getByText("Contacts pane")).toBeVisible();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("reflows the same mounted map and panels across the desktop boundary", () => {
    let mobile = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      get matches() { return query === "(max-width: 900px)" && mobile; }, media: query,
      addEventListener: (_event: string, fn: () => void) => listeners.add(fn), removeEventListener: (_event: string, fn: () => void) => listeners.delete(fn),
    }) as unknown as MediaQueryList));
    render(<Workspace header={<button>Shared header</button>}><section>Packet content</section><section data-testid="map">Map</section><section>Contact content</section></Workspace>);
    const map = screen.getByTestId("map");
    const resize = (value: boolean) => act(() => { mobile = value; listeners.forEach(fn => fn()); });
    resize(true);
    fireEvent.click(screen.getByRole("tab", { name: "Contacts" }));
    expect(screen.getByText("Contact content")).toBeVisible();
    resize(false);
    expect(screen.getByText("Packet content")).toBeVisible(); expect(screen.getByText("Contact content")).toBeVisible();
    resize(true);
    expect(screen.getByRole("tab", { name: "Contacts" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("map")).toBe(map);
    expect(screen.getAllByRole("button", { name: "Shared header" })).toHaveLength(1);
  });
});
