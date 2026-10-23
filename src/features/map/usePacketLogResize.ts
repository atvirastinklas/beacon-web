import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type TouchEvent } from "react";

type Size = { width: number; height: number };
type Bounds = Size & { right: number; bottom: number };
type Drag = Size & { x: number; y: number; pointerId: number; handle: HTMLButtonElement };

/** Top-left resize for the bottom-right anchored packet log; sizes last only for this mount. */
export function usePacketLogResize() {
  const [size, setSize] = useState<Size>({ width: 440, height: 310 });
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const limits = useRef<Bounds | null>(null);
  const drag = useRef<Drag | null>(null);
  const clamp = useCallback((value: Size): Size => ({
    width: Math.max(Math.min(320, limits.current?.width ?? 320), Math.min(value.width, limits.current?.width ?? Infinity)),
    height: Math.max(Math.min(180, limits.current?.height ?? 180), Math.min(value.height, limits.current?.height ?? Infinity)),
  }), []);
  const release = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    if (active?.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
    return active;
  }, []);
  const cancel = useCallback(() => {
    const active = release();
    if (active) setSize(clamp(active));
  }, [clamp, release]);
  const panelRef = useCallback((panel: HTMLDivElement | null) => {
    const parent = panel?.parentElement;
    if (!parent) return;
    const measure = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (!width || !height) return;
      const right = Math.min(12, width / 4);
      // Retain the map controls' clearance unless the container cannot fit the minimum log.
      const bottom = Math.min(56, Math.max(0, height - 192));
      const next = { width: width - 2 * right, height: height - bottom - Math.min(12, height / 4), right, bottom };
      limits.current = next;
      setBounds(next);
      setSize(previous => clamp(previous));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(parent);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      release();
    };
  }, [clamp, release]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { ...size, x: event.clientX, y: event.clientY, pointerId: event.pointerId, handle: event.currentTarget };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    setSize(clamp({ width: active.width + active.x - event.clientX, height: active.height + active.y - event.clientY }));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (drag.current?.pointerId === event.pointerId) release();
  };
  const onPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (drag.current?.pointerId === event.pointerId) cancel();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && drag.current) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (drag.current) return;
    const step = event.shiftKey ? 50 : 10;
    setSize(previous => clamp({
      width: previous.width + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0),
      height: previous.height + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0),
    }));
  };
  return { size, bounds, panelRef, cancel, handleProps: {
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel, onKeyDown,
    onMouseDown: (event: MouseEvent) => event.stopPropagation(),
    onTouchStart: (event: TouchEvent) => event.stopPropagation(),
    onClick: (event: MouseEvent) => event.stopPropagation(),
  } };
}
