import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeshlogVirtualList } from "../../../src/features/meshlog/MeshlogVirtualList";

const items = Array.from({ length: 857 }, (_, index) => ({ id: `row-${index}` }));
function Harness() {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  return <section ref={setScrollElement} data-testid="scroll" style={{ height: 240, overflow: "auto" }}>
    <MeshlogVirtualList items={items} scrollElement={scrollElement} estimateSize={30} renderItem={item =>
      <button type="button" aria-expanded={expanded.includes(item.id)} onClick={() => setExpanded(previous => [...previous, item.id])}>{item.id}</button>} />
  </section>;
}

describe("Meshlog measured virtualization", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {} unobserve() {} disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.dataset.testid === "scroll" ? 240 : 30; });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(360);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const root = this.closest<HTMLElement>("[data-testid=scroll]");
      return { x: 0, y: 0, top: this.classList.contains("meshlog-virtual-list") ? -(root?.scrollTop ?? 0) : 0, left: 0, right: 360, bottom: 240, width: 360, height: 240, toJSON() {} };
    });
    HTMLElement.prototype.scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions | number) {
      if (typeof options !== "number") this.scrollTop = options.top ?? this.scrollTop;
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("bounds real measured ranges and restores controlled expansion after virtual unmount", () => {
    render(<Harness />);
    const root = screen.getByTestId("scroll");
    expect(screen.getAllByRole("button").length).toBeLessThan(30);
    fireEvent.click(screen.getByRole("button", { name: "row-0" }));
    expect(screen.getByRole("button", { name: "row-0" })).toHaveAttribute("aria-expanded", "true");
    act(() => { root.scrollTop = 12000; fireEvent.scroll(root); });
    expect(screen.queryByRole("button", { name: "row-0" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeLessThan(30);
    expect(screen.getByRole("button", { name: "row-400" })).toBeInTheDocument();
    act(() => { root.scrollTop = 0; fireEvent.scroll(root); });
    expect(screen.getByRole("button", { name: "row-0" })).toHaveAttribute("aria-expanded", "true");
  });
});
