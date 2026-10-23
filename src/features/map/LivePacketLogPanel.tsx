import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import NumberFlow from "@number-flow/react";
import { useReducedMotion } from "motion/react";
import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "../../components/ui/collapsible";
import { LogViewer, type LogLine } from "../../components/ui/log-viewer";
import { payloadTypeVariant, VARIANT_CLASSES } from "../../components/badge-utils";
import { cn } from "../../lib/cn";
import { formatAbsolute, formatHex } from "../../lib/formatters";
import { PAYLOAD_TYPE_NAMES, ROUTE_TYPE_NAMES, type PayloadTypeValue, type RouteTypeValue } from "../../types/enums";
import type { ResolvedHop } from "../../types/api";
import type { WsStatus } from "../../api/ws-manager";
import { LIVE_PACKET_LOG_CAP, type LivePacketLogEntry } from "./useLivePacketLog";
import { usePacketLogResize } from "./usePacketLogResize";

interface LivePacketLogPanelProps {
  entries: readonly LivePacketLogEntry[];
  status: WsStatus;
  regionPending?: boolean;
  onAnalyzePacket: (hash: string) => void;
}

// Don't turn ambiguous endpoint resolutions into a claimed source/destination.
function endpointName(hop: ResolvedHop | null | undefined): string | undefined {
  if (hop?.confidence !== "high" || hop.nodes.length !== 1) return undefined;
  const node = hop.nodes[0]!;
  return node.name?.trim() || formatHex(node.id);
}

function normalizedPreview(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function payloadColor(type: number) {
  return VARIANT_CLASSES[payloadTypeVariant(type)].split(" ").find(token => token.startsWith("text-"));
}

export function LivePacketLogPanel({ entries, status, regionPending = false, onAnalyzePacket }: LivePacketLogPanelProps) {
  const { t } = useTranslation();
  const contentId = useId();
  const resizeHintId = useId();
  const [open, setOpen] = useState(true);
  const { size: panelSize, bounds: resizeBounds, panelRef, cancel: cancelResize, handleProps: resizeHandleProps } = usePacketLogResize();
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Hidden by filters is still selected; eviction or an empty feed ends selection.
  if (selectedId !== null && !entries.some(entry => entry.id === selectedId)) setSelectedId(null);
  // Exclusions keep new types included, without forgetting a deselected type on eviction.
  const [excludedTypes, setExcludedTypes] = useState<number[]>([]);
  const typeStripRef = useCallback((strip: HTMLDivElement | null) => {
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      const max = strip.scrollWidth - strip.clientWidth;
      if (max <= 0 || event.ctrlKey) return;
      event.stopPropagation();
      // Horizontal/diagonal trackpad gestures keep their native default action.
      if (event.deltaX !== 0 || event.deltaY === 0) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1;
      strip.scrollLeft = Math.max(0, Math.min(max, strip.scrollLeft + event.deltaY * unit));
    };
    // React's delegated wheel listener is passive; this listener must cancel vertical scrolling.
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);
  const payloadName = (type: number, name: string) => (PAYLOAD_TYPE_NAMES[type as PayloadTypeValue] ?? name?.trim()) || t("map.packetLog.unknownType", { type });
  const title = t("map.packetLog.title", { defaultValue: "Live packets" });
  const connection = status === "connected" ? t("connection.live") : status === "connecting"
    ? t("map.packetLog.connecting", { defaultValue: "Connecting…" }) : t("connection.offline");
  const waiting = regionPending ? t("map.packetLog.loadingRegion", { defaultValue: "Loading region…" })
    : status === "connected" ? t("map.packetLog.waiting", { defaultValue: "Waiting for packets…" })
    : t("map.packetLog.waitingConnection", { defaultValue: "Waiting for the packet stream…" });
  const sightingDigits = Math.max(2, ...entries.map(entry => String(entry.seenCount).length));

  // The store stays newest-first; the viewer reads chronologically toward its tail.
  const lines: LogLine[] = [...entries].sort((a, b) => a.firstHeardAt - b.firstHeardAt || a.id - b.id)
    .map(({ id, data, seenCount, message, firstHeardAt }, index) => {
      const { packet, observation } = data;
      const source = endpointName(observation.resolvedSource);
      const destination = endpointName(observation.resolvedDestination);
      const endpoints = source && destination ? `${source} → ${destination}` : source || destination;
      const content = message?.content.trim() ? message.content : packet.summary?.trim() ? packet.summary : undefined;
      const summary = content || endpoints;
      const sender = message?.senderName.trim() || source;
      // Embedded senders are message labels, not verified node IDs. Keep route context separate.
      const routeContext = content ? source && source === sender ? destination && `→ ${destination}` : endpoints : undefined;
      const primaryIsRoute = !!endpoints && normalizedPreview(endpoints) === normalizedPreview(summary);
      const routePreview = routeContext && !primaryIsRoute && normalizedPreview(routeContext) !== normalizedPreview(summary) ? routeContext : undefined;
      // Exact whitespace-normalized comparison avoids repeating name-only previews.
      const senderPreview = sender && (content || !endpoints) && !(primaryIsRoute && source === sender) && normalizedPreview(sender) !== normalizedPreview(summary)
        && normalizedPreview(sender) !== normalizedPreview(routePreview) ? sender : undefined;
      const senderLabel = senderPreview ? `${t("packetAnalyzer.payload.sender")}: ${senderPreview}` : undefined;
      const accessibleContent = normalizedPreview(summary);
      const accessiblePreview = accessibleContent.length > 160 ? `${accessibleContent.slice(0, 160)}…` : accessibleContent;
      const accessibleSummary = [senderLabel, accessiblePreview, routePreview].filter(Boolean).join(" · ");
      const payload = payloadName(packet.payloadType, packet.payloadTypeName);
      const route = ROUTE_TYPE_NAMES[packet.routeType as RouteTypeValue] ?? packet.routeTypeName;
      const shortRoute = route.replace("TRANSPORT_", "T·");
      const absolute = formatAbsolute(firstHeardAt);
      const firstHeard = `${t("map.packetLog.firstHeard", { defaultValue: "First heard" })}: ${absolute}`;
      const color = payloadColor(packet.payloadType);
      const sightings = t("map.packetLog.sightings", { defaultValue: "{{count}} sightings in this feed", count: seenCount });
      return {
        id, time: firstHeardAt, level: "info",
        // No opaque packet hash or unverified endpoint enters the search index.
        message: [payload, route, observation.iata, firstHeard, sightings, senderPreview, summary, routePreview].filter(Boolean).join(" · "),
        render: ({ wrap, highlight }) => (
          <button type="button" aria-pressed={selectedId === id} onClick={() => { setSelectedId(id); onAnalyzePacket(data.packetHash); }}
            aria-label={summary
              ? t("map.packetLog.details", { defaultValue: "Packet details: {{type}} · {{summary}}", type: payload, summary: accessibleSummary })
              : `${t("map.packetLog.detailsWithoutPreview", { defaultValue: "Packet details: {{type}}", type: payload })}${accessibleSummary ? ` · ${accessibleSummary}` : ""}`}
            className={cn("grid min-h-6 w-full min-w-0 grid-cols-[8ch_10ch_auto_minmax(0,1fr)] items-start gap-x-2 border-s-2 px-2 py-0.5 text-start font-mono text-[11px] leading-5 cursor-pointer focus-visible:-outline-offset-2",
              selectedId === id ? "border-s-primary bg-primary/12 hover:bg-primary/16"
                : cn("hover:bg-text-normal/5", index === entries.length - 1 ? "border-s-text-normal/50" : "border-s-transparent"))}>
            <time className="tabular-nums text-text-normal" dateTime={new Date(firstHeardAt).toISOString()} title={firstHeard} aria-label={firstHeard}>{highlight(absolute.slice(11))}</time>
            <span className={cn("truncate font-medium", color)} title={payload}>{highlight(payload)}</span>
            <span data-slot="packet-metadata" className="inline-grid items-baseline gap-x-2 whitespace-nowrap text-text-normal"
              style={{ gridTemplateColumns: `8ch 3ch ${sightingDigits + 1}ch` }}>
              <span data-slot="packet-route" className="truncate text-start" title={route}>{highlight(shortRoute)}</span>
              <span className="truncate" title={observation.iata}>{highlight(observation.iata)}</span>
              <span className="inline-grid grid-cols-[1ch_minmax(2ch,1fr)]" title={sightings} aria-label={sightings}>
                <span aria-hidden>×</span><span data-slot="packet-sighting-count" className="min-w-[2ch] text-end tabular-nums">{seenCount}</span>
              </span>
            </span>
            <span data-slot="packet-message" className={cn("min-w-0 text-text-bright", wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-nowrap")}>
              {senderPreview && <span data-slot="packet-sender" title={senderLabel}>{highlight(senderPreview)}: </span>}
              {summary && <span data-slot="packet-preview" title={summary}>{highlight(wrap ? summary : normalizedPreview(summary))}</span>}
              {routePreview && <>{summary && <span aria-hidden> · </span>}<span data-slot="packet-context" className="text-text-normal" title={routePreview}>{highlight(routePreview)}</span></>}
            </span>
          </button>
        ),
      };
    });

  const types = [...new Map(entries.map(({ data }) => [data.packet.payloadType, data.packet.payloadTypeName]))]
    .sort(([a], [b]) => a - b);
  const allowedIds = new Set<LogLine["id"]>(entries.filter(entry => !excludedTypes.includes(entry.data.packet.payloadType)).map(entry => entry.id));
  const typeById = new Map<LogLine["id"], number>(entries.map(entry => [entry.id, entry.data.packet.payloadType]));
  const q = query.trim().toLowerCase();
  const matching = lines.filter(line => !q || line.message.toLowerCase().includes(q));
  const counts = new Map<number, number>();
  for (const line of matching) {
    const type = typeById.get(line.id)!;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const shownCount = matching.filter(line => allowedIds.has(line.id)).length;
  const filterControls = (
    <div className="flex h-8 shrink-0 min-w-0 items-center gap-1 border-b border-border-subtle px-1.5">
      <ToggleGroup ref={typeStripRef} multiple aria-label={t("map.packetLog.types")}
        value={types.filter(([type]) => !excludedTypes.includes(type)).map(([type]) => String(type))}
        onValueChange={values => setExcludedTypes(previous => [
          ...previous.filter(type => !types.some(([present]) => present === type)),
          ...types.filter(([type]) => !values.includes(String(type))).map(([type]) => type),
        ])}
        onFocusCapture={event => {
          const strip = event.currentTarget;
          const viewport = strip.getBoundingClientRect();
          const target = event.target.getBoundingClientRect();
          const delta = target.left < viewport.left ? target.left - viewport.left
            : target.right > viewport.right ? target.right - viewport.right : 0;
          // Reveal only within this strip, rather than scrolling the map or document.
          if (delta) strip.scrollLeft = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, strip.scrollLeft + delta));
        }}
        onTouchStart={event => event.stopPropagation()} onTouchMove={event => event.stopPropagation()}
        className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-contain touch-pan-x">
        {types.map(([type, name]) => {
          const payload = payloadName(type, name);
          const count = counts.get(type) ?? 0;
          return (
            <Toggle key={type} value={String(type)} aria-label={t("map.packetLog.typeCount", { type: payload, count })}
              className="group/type flex h-6 shrink-0 items-center gap-1 rounded-sm px-1 font-mono text-[10px] text-text-normal hover:bg-text-normal/5 data-pressed:text-text-bright cursor-pointer">
              <span aria-hidden className={cn("size-1.5 rounded-full border border-current group-data-pressed/type:bg-current", payloadColor(type))} />
              <span className="max-w-[12ch] truncate" title={payload}>{payload}</span>
              <span aria-hidden className="w-[3ch] text-end tabular-nums text-text-normal"><NumberFlow value={count} animated={!reduce} /></span>
            </Toggle>
          );
        })}
        {!types.length && <span className="px-1 font-mono text-[10px] text-text-normal">{t("map.packetLog.types")}</span>}
      </ToggleGroup>
      <span className="w-[7ch] shrink-0 text-end font-mono text-[10px] tabular-nums text-text-normal"
        aria-label={t("map.packetLog.shownCount", { count: shownCount, total: lines.length })}
        title={t("map.packetLog.shownCount", { count: shownCount, total: lines.length })}>{shownCount}/{lines.length}</span>
    </div>
  );

  return (
    <Collapsible ref={panelRef} open={open} onOpenChange={value => { cancelResize(); setOpen(value); }} role="region" aria-label={title}
      style={{ width: panelSize.width, height: open ? panelSize.height : undefined,
        right: resizeBounds?.right, bottom: resizeBounds?.bottom }}
      className="absolute bottom-14 right-3 z-30 flex max-w-[calc(100%_-_1.5rem)] flex-col rounded-md border border-border bg-bg-raised shadow-lg overflow-hidden">
      {open && <>
          <button type="button" aria-label={t("map.packetLog.resize")} aria-describedby={resizeHintId} title={t("map.packetLog.resize")}
          {...resizeHandleProps}
          className="absolute top-0.5 left-0.5 z-10 flex size-6 touch-none select-none items-center justify-center rounded-sm text-text-normal hover:bg-text-normal/10 hover:text-text-bright focus-visible:-outline-offset-2 cursor-nwse-resize">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <path d="M2 9V2h7M2 2l9 9m-4 0h4V7" />
          </svg>
        </button>
        <span id={resizeHintId} className="sr-only">{t("map.packetLog.resizeHint")}</span>
        <span role="status" aria-atomic="true" className="sr-only">{panelSize.width} × {panelSize.height} px</span>
      </>}
      <CollapsibleTrigger aria-label={title} aria-controls={contentId}
        className={cn("group flex h-8 shrink-0 w-full items-center gap-2 pe-2.5 text-start cursor-pointer hover:bg-text-normal/5 transition-colors", open ? "ps-8" : "ps-2.5")}>
        <span className="font-mono text-[11px] uppercase tracking-wider text-text-bright">{t("tabs.Packets")}</span>
        <span className="font-mono text-[10px] tabular-nums text-text-normal">{entries.length}/{LIVE_PACKET_LOG_CAP}</span>
        <span className={`ml-auto font-mono text-[10px] ${status === "connected" ? "text-green" : "text-text-normal"}`}>{connection}</span>
        <svg className="h-3 w-3 shrink-0 text-text-normal group-data-[state=closed]:-rotate-90" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </CollapsibleTrigger>
      <CollapsibleContent id={contentId} className="flex min-h-0 flex-1 flex-col border-t border-border-subtle">
        <LogViewer lines={lines} streaming={status === "connected"} compact query={query} onQueryChange={setQuery}
          filter={{ controls: filterControls, accepts: line => allowedIds.has(line.id), onClear: () => setExcludedTypes([]), emptyMessage: t("map.packetLog.noTypes") }}
          messages={{ filterPlaceholder: t("map.packetLog.filterPlaceholder"), filterLabel: t("map.packetLog.filterLabel"),
            wrap: t("map.packetLog.wrap"), unwrap: t("map.packetLog.unwrap"),
            noMatches: value => t("map.packetLog.noMatches", { query: value }), newItems: count => t("map.packetLog.newPackets", { count }) }}
          loading={regionPending && !entries.length} loadingMessage={waiting}
          emptyMessage={waiting} emptyHint={t("map.packetLog.waitingHint", { defaultValue: "Listening for packet observations in the selected region." })}
          label={t("map.packetLog.observations", { defaultValue: "Received packet observations" })}
          className="min-h-0 flex-1" height="100%" />
      </CollapsibleContent>
    </Collapsible>
  );
}
