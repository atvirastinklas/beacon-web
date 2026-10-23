import { act } from "@testing-library/react";
import { vi } from "vitest";

/** Deliver browser resize notifications with explicitly supplied DOM geometry. */
export function mockResizeObserver() {
  const observers = new Set<Observer>();
  class Observer implements ResizeObserver {
    targets = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) { observers.add(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  }
  vi.stubGlobal("ResizeObserver", Observer);
  return (target: Element) => act(() => {
    for (const observer of [...observers]) {
      if (observer.targets.has(target)) observer.callback([], observer);
    }
  });
}
