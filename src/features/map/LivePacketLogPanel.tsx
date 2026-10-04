import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "../../components/ui/collapsible";
import { payloadTypeVariant, VARIANT_CLASSES } from "../../components/badge-utils";
import { formatAbsolute, formatHex } from "../../lib/formatters";
import { PAYLOAD_TYPE_NAMES, ROUTE_TYPE_NAMES, type PayloadTypeValue, type RouteTypeValue } from "../../types/enums";
import type { ResolvedHop } from "../../types/api";
import type { WsStatus } from "../../api/ws-manager";
import { LIVE_PACKET_LOG_CAP, type LivePacketLogEntry } from "./useLivePacketLog";

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

export function LivePacketLogPanel({ entries, status, regionPending = false, onAnalyzePacket }: LivePacketLogPanelProps) {
  const { t } = useTranslation();
  const contentId = useId();
  const title = t("map.packetLog.title", { defaultValue: "Live packets" });
  const connection = status === "connected" ? t("connection.live") : status === "connecting"
    ? t("map.packetLog.connecting", { defaultValue: "Connecting…" }) : t("connection.offline");
  const waiting = regionPending ? t("map.packetLog.loadingRegion", { defaultValue: "Loading region…" })
    : status === "connected" ? t("map.packetLog.waiting", { defaultValue: "Waiting for packets…" })
    : t("map.packetLog.waitingConnection", { defaultValue: "Waiting for the packet stream…" });

  return (
    <Collapsible defaultOpen role="region" aria-label={title}
      className="absolute bottom-14 right-3 z-30 w-[360px] max-w-[calc(100%_-_1.5rem)] rounded-md border border-border bg-bg-raised shadow-lg overflow-hidden">
      <CollapsibleTrigger aria-label={title} aria-controls={contentId}
        className="group flex w-full items-center gap-2 px-3 py-2.5 text-left cursor-pointer hover:bg-text-normal/5 transition-colors">
        <span className="font-mono text-[11px] uppercase tracking-wider text-text-bright">{title}</span>
        <span className="font-mono text-[10px] tabular-nums text-text-normal">{entries.length}/{LIVE_PACKET_LOG_CAP}</span>
        <span className={`ml-auto font-mono text-[10px] ${status === "connected" ? "text-green" : "text-text-normal"}`}>{connection}</span>
        <svg className="h-3 w-3 shrink-0 text-text-normal group-data-[state=closed]:-rotate-90" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </CollapsibleTrigger>
      <CollapsibleContent id={contentId} className="border-t border-border-subtle">
        {/* Fixed expanded height keeps the collapse target stable as observations arrive. */}
        <div className="h-[min(40vh,300px)] overflow-y-auto overscroll-contain" role="group" tabIndex={entries.length ? 0 : undefined}
          aria-label={t("map.packetLog.observations", { defaultValue: "Received packet observations" })}>
          {entries.length === 0 ? (
            <div className="flex h-full flex-col justify-center gap-2 px-5 py-4 text-center">
              <p className="text-[12px] text-text-bright">{waiting}</p>
              <p className="text-[11px] leading-relaxed text-text-normal">{t("map.packetLog.waitingHint", { defaultValue: "Listening for packet observations in the selected region." })}</p>
            </div>
          ) : (
            <ol className="divide-y divide-border-subtle">
              {entries.map(({ id, data, seenCount }, index) => {
                const { packet, observation } = data;
                const source = endpointName(observation.resolvedSource);
                const destination = endpointName(observation.resolvedDestination);
                const endpoints = source && destination ? `${source} → ${destination}` : source || destination;
                const summary = endpoints || packet.summary || formatHex(data.packetHash);
                const payload = (PAYLOAD_TYPE_NAMES[packet.payloadType as PayloadTypeValue] ?? packet.payloadTypeName) || t("packetRow.unknown");
                const route = ROUTE_TYPE_NAMES[packet.routeType as RouteTypeValue] ?? packet.routeTypeName;
                const shortRoute = route.replace("TRANSPORT_", "T·");
                const absolute = formatAbsolute(observation.heardAt);
                const variant = VARIANT_CLASSES[payloadTypeVariant(packet.payloadType)];
                const sightings = t("map.packetLog.sightings", { defaultValue: "{{count}} sightings in this feed", count: seenCount });
                const hopCount = observation.pathLength?.hopCount;
                const hops = hopCount === undefined ? t("map.packetLog.unknownHops", { defaultValue: "Hop count unavailable" })
                  : t("map.packetLog.hops", { defaultValue: "{{count}} hops", count: hopCount });
                return (
                  <li key={id}>
                      <button type="button" onClick={() => onAnalyzePacket(data.packetHash)}
                        aria-label={t("map.packetLog.details", { defaultValue: "Packet details: {{type}} · {{summary}}", type: payload, summary })}
                        className={`block w-full min-w-0 border-l-2 px-2 py-1.5 text-left cursor-pointer hover:bg-text-normal/8 ${index === 0 ? `${variant} border-l-current` : "border-l-transparent"}`}>
                        <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] leading-4">
                          <span className={`max-w-20 truncate rounded-sm border px-1 font-semibold ${variant}`} title={payload}>{payload}</span>
                          <span className="max-w-16 truncate rounded-sm border border-border px-1 text-text-normal" title={route}>{shortRoute}</span>
                          <span className="shrink-0 text-text-normal" title={hops} aria-label={hops}>{hopCount ?? "—"}h</span>
                          <span className="shrink-0 rounded-sm bg-text-normal/8 px-1 text-text-bright tabular-nums" title={sightings} aria-label={sightings}>×{seenCount}</span>
                          <span className="min-w-0 max-w-10 truncate text-text-normal" title={observation.iata}>{observation.iata}</span>
                          <time className="ml-auto shrink-0 text-text-normal tabular-nums" dateTime={new Date(observation.heardAt).toISOString()} title={absolute}>{absolute.slice(11)}</time>
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] leading-4 text-text-bright" title={summary}>{summary}</span>
                      </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <p className="border-t border-border-subtle px-3 py-2 text-[10px] text-text-normal">{t("map.packetLog.grouping", { defaultValue: "Newest sightings first · repeats grouped for 30s" })}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}
