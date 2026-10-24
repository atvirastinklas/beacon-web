import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "../../hooks/useMediaQuery";

type Side = "left" | "right";
type Sizes = Record<Side, number>;
const round = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function Workspace({ children, header }: { children: [ReactNode, ReactNode, ReactNode]; header?: ReactNode }) {
  const { t } = useTranslation();
  const mobile = useMediaQuery("(max-width: 900px)");
  const container = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState("packets");
  const [sizes, setSizes] = useState<Sizes>({ left: 33, right: 20 });
  const [mapShare, setMapShare] = useState(45);
  const [width, setWidth] = useState(() => Math.max(901, window.innerWidth) - 16);
  const [height, setHeight] = useState(() => Math.max(1, window.innerHeight - 104));
  const [dragging, setDragging] = useState<Side | "mobile" | null>(null);
  const drag = useRef<{ side: Side | "mobile"; coordinate: number; sizes: Sizes; mapShare: number; extent: number; min: number; max: number; pointerId: number; handle: HTMLDivElement } | null>(null);
  const mobileBounds = (extent: number) => ({ min: Math.min(120, extent * .4) / extent * 100, max: 100 - Math.min(160, extent * .5) / extent * 100 });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const available = Math.max(901, element.getBoundingClientRect().width || window.innerWidth) - 16;
      const vertical = Math.max(1, (element.getBoundingClientRect().height || window.innerHeight) - (headerRef.current?.offsetHeight || 44) - (tabsRef.current?.offsetHeight || 36) - 24);
      setWidth(available); setHeight(vertical);
      const bounds = mobileBounds(vertical);
      setMapShare(previous => clamp(previous, bounds.min, bounds.max));
      setSizes(previous => {
        const left = clamp(previous.left, 230 / available * 100, 100 - (260 + 170) / available * 100);
        const right = clamp(previous.right, 170 / available * 100, 100 - left - 260 / available * 100);
        return left === previous.left && right === previous.right ? previous : { left, right };
      });
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    if (headerRef.current) observer?.observe(headerRef.current);
    if (tabsRef.current) observer?.observe(tabsRef.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [mobile]);
  const bounds = (side: Side | "mobile") => side === "mobile" ? mobileBounds(height)
    : { min: (side === "left" ? 230 : 170) / width * 100, max: 100 - sizes[side === "left" ? "right" : "left"] - 260 / width * 100 };
  const stopDrag = (cancelled: boolean) => {
    const active = drag.current; drag.current = null;
    if (cancelled && active) { setSizes(active.sizes); setMapShare(active.mapShare); }
    if (active?.handle.hasPointerCapture?.(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
    setDragging(null);
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>, side: Side | "mobile") => {
    if (event.button !== 0 || event.isPrimary === false || drag.current) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { side, coordinate: side === "mobile" ? event.clientY : event.clientX, sizes, mapShare, extent: side === "mobile" ? height : width, ...bounds(side), pointerId: event.pointerId, handle: event.currentTarget };
    setDragging(side);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const coordinate = active.side === "mobile" ? event.clientY : event.clientX;
    const delta = (coordinate - active.coordinate) / active.extent * 100 * (active.side === "right" ? -1 : 1);
    if (active.side === "mobile") setMapShare(clamp(active.mapShare + delta, active.min, active.max));
    else setSizes({ ...active.sizes, [active.side]: clamp(active.sizes[active.side] + delta, active.min, active.max) });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, side: Side | "mobile") => {
    if (event.key === "Escape" && drag.current) { event.preventDefault(); stopDrag(true); return; }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const { min, max } = bounds(side);
    const step = event.shiftKey ? 5 : 2;
    let value = side === "mobile" ? mapShare : sizes[side];
    if (event.key === "Home") value = min;
    else if (event.key === "End") value = max;
    else if (side === "mobile" && event.key === "ArrowDown") value += step;
    else if (side === "mobile" && event.key === "ArrowUp") value -= step;
    else if (side !== "mobile" && event.key === "ArrowRight") value += side === "left" ? step : -step;
    else if (side !== "mobile" && event.key === "ArrowLeft") value += side === "left" ? -step : step;
    else return;
    event.preventDefault();
    if (side === "mobile") setMapShare(clamp(value, min, max));
    else setSizes(previous => ({ ...previous, [side]: clamp(value, min, max) }));
  };
  const divider = (side: Side | "mobile") => {
    const { min, max } = bounds(side);
    const value = side === "mobile" ? mapShare : sizes[side];
    return <div role="separator" tabIndex={0} hidden={side === "mobile" ? !mobile : mobile} className={`meshlog-divider meshlog-divider-${side}`} aria-orientation={side === "mobile" ? "horizontal" : "vertical"}
      aria-label={side === "mobile" ? t("meshlog.workspace.resize") : side === "left" ? `${t("tabs.Packets")} / ${t("tabs.Map")}` : `${t("tabs.Map")} / ${t("tabs.Nodes")}`}
      aria-controls={side === "mobile" ? "meshlog-map-panel meshlog-messages meshlog-contacts" : `meshlog-${side === "left" ? "messages" : "contacts"}`}
      aria-valuenow={round(value)} aria-valuemin={round(min)} aria-valuemax={round(max)} aria-valuetext={`${round(value)}%`}
      onKeyDown={event => onKeyDown(event, side)} onPointerDown={event => startDrag(event, side)} onPointerMove={moveDrag}
      onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) stopDrag(false); }}
      onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) stopDrag(true); }}
      onLostPointerCapture={() => { if (drag.current) stopDrag(true); }} />;
  };
  const desktopPanel = mobile ? {} : { hidden: false, inert: false, role: undefined, tabIndex: undefined, "aria-labelledby": undefined };
  return <Tabs.Root render={<main />} value={panel} onValueChange={value => setPanel(String(value))} className="meshlog-page" data-mobile={mobile || undefined} data-resizing={dragging ?? undefined} ref={container}
    style={{ gridTemplateColumns: mobile ? "minmax(0, 1fr)" : `minmax(0, ${sizes.left}fr) 8px minmax(0, ${100 - sizes.left - sizes.right}fr) 8px minmax(0, ${sizes.right}fr)`, gridTemplateRows: mobile ? `auto minmax(0, ${mapShare}fr) 24px auto minmax(0, ${100 - mapShare}fr)` : "auto minmax(0, 1fr)" }}>
    <div ref={headerRef} className="meshlog-workspace-header">{header}</div>
    <Tabs.Panel value="packets" keepMounted className="meshlog-workspace-packets" {...desktopPanel}>{children[0]}</Tabs.Panel>
    {divider("left")}
    <div className="meshlog-workspace-map">{children[1]}</div>
    {divider("right")}
    <Tabs.Panel value="contacts" keepMounted className="meshlog-workspace-contacts" {...desktopPanel}>{children[2]}</Tabs.Panel>
    {divider("mobile")}
    <Tabs.List ref={tabsRef} hidden={!mobile} activateOnFocus className="meshlog-mobile-tabs" aria-label={t("meshlog.workspace.panels")}>
      <Tabs.Tab value="packets">{t("tabs.Packets")}</Tabs.Tab><Tabs.Tab value="contacts">{t("meshlog.workspace.contacts")}</Tabs.Tab>
    </Tabs.List>
  </Tabs.Root>;
}
