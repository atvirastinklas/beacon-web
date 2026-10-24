import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/** The pane remains the scroll owner, including its filters and explicit history action. */
export function MeshlogVirtualList<T extends { id: string }>({ items, scrollElement, estimateSize, renderItem, onVisibleKeysChange }: {
  items: T[]; scrollElement: HTMLElement | null; estimateSize: number;
  renderItem: (item: T) => ReactNode; onVisibleKeysChange?: (keys: string[]) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // jsdom has no layout/ResizeObserver. Keep its fallback bounded too; browsers
  // always use measured ranges, including when a mounted mobile tab is hidden.
  const measurable = typeof ResizeObserver !== "undefined";
  const virtualizer = useVirtualizer({
    count: items.length, getScrollElement: () => scrollElement,
    getItemKey: index => items[index]!.id, estimateSize: () => estimateSize,
    overscan: 5, scrollMargin, enabled: measurable,
  });
  useLayoutEffect(() => {
    const root = scrollElement, list = host.current;
    if (!root || !list || !measurable) return;
    const measure = () => {
      const margin = list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      setScrollMargin(previous => Math.abs(previous - margin) < .5 ? previous : margin);
    };
    const observer = new ResizeObserver(measure);
    const observeControls = () => {
      observer.disconnect();
      observer.observe(root);
      // Filter controls above the list can change height independently of the pane.
      for (const child of root.children) if (child !== list.parentElement) observer.observe(child);
      measure();
    };
    observeControls();
    const mutations = new MutationObserver(observeControls);
    mutations.observe(root, { childList: true });
    return () => { observer.disconnect(); mutations.disconnect(); };
  }, [measurable, scrollElement]);
  const rows = virtualizer.getVirtualItems();
  const mountedKeys = (measurable ? rows.map(row => items[row.index]!.id) : items.slice(0, 40).map(item => item.id)).join("\n");
  useEffect(() => {
    if (!onVisibleKeysChange) return;
    const root = scrollElement, list = host.current;
    if (!root || !list) return;
    const elements = [...list.querySelectorAll<HTMLElement>("[data-meshlog-packet]")];
    if (typeof IntersectionObserver === "undefined") {
      onVisibleKeysChange(elements.slice(0, 12).map(row => row.dataset.meshlogPacket!));
      return () => onVisibleKeysChange([]);
    }
    const visible = new Set<Element>();
    let lastPublished = "";
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target);
      }
      // Only actual viewport intersections hydrate, never the overscan range.
      const keys = elements.filter(element => visible.has(element)).map(element => element.dataset.meshlogPacket!);
      const signature = keys.join("\n");
      if (signature !== lastPublished) { lastPublished = signature; onVisibleKeysChange(keys); }
    }, { root, threshold: 0 });
    elements.forEach(element => observer.observe(element));
    return () => { observer.disconnect(); onVisibleKeysChange([]); };
  }, [mountedKeys, onVisibleKeysChange, scrollElement]);
  return <div ref={host} className="meshlog-virtual-list" style={measurable ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined}>
    {measurable ? rows.map(row => <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start - scrollMargin}px)` }}>
      {renderItem(items[row.index]!)}
    </div>) : items.slice(0, 40).map(item => <div key={item.id}>{renderItem(item)}</div>)}
  </div>;
}
