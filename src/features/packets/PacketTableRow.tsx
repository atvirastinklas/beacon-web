import { useTranslation } from "react-i18next";
import { formatHex } from "../../lib/formatters";
import { Timestamp } from "../../components/Timestamp";
import { Badge } from "../../components/Badge";
import { ScopeTag } from "../../components/ScopeTag";
import { payloadTypeVariant } from "../../components/badge-utils";
import { PAYLOAD_TYPE_NAMES, type PayloadTypeValue } from "../../types/enums";
import type { PacketListItem } from "./types";
import { GRID_TEMPLATE } from "./packet-grid";
import { PacketEndpoints } from "./PacketEndpoints";

interface PacketTableRowProps {
  packet: PacketListItem;
  expanded: boolean;
  isFresh?: boolean;
  onToggle: () => void;
}

// The wide column prefers decoded messages, falling back to the packet's endpoints.
export function PacketTableRow({ packet, expanded, isFresh, onToggle }: PacketTableRowProps) {
  const { t } = useTranslation();
  // ?? not ||, so a legitimate 0-hop direct packet still shows its count
  const pathLength = packet.latestObserver?.pathLength;
  const routeName = packet.routeTypeName || t("packetTable.unknown");
  const na = <span className="text-text-dim">{t("packetEndpoints.na")}</span>;
  const message = packet.message?.content.trim() ? packet.message : undefined;
  const source = packet.latestObserver?.resolvedSource;
  const sourceNode = source?.confidence === "high" && source.nodes.length === 1 ? source.nodes[0] : undefined;
  const sender = message?.senderName.trim() || (sourceNode && (sourceNode.name?.trim() || formatHex(sourceNode.id)));

  return (
    <div
      className={`border-b ${
        expanded
          ? "border-primary bg-primary/10"
          : isFresh
            ? "packet-fresh border-border-subtle"
            : "border-border-subtle hover:bg-bg-raised/50"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="grid h-9 w-full items-center gap-x-3 px-3 py-1 text-left text-[11px] cursor-pointer"
        style={{ gridTemplateColumns: GRID_TEMPLATE }}
      >
        <span className={`text-text-dim transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden>
          ›
        </span>
        <span className="font-mono text-xs font-semibold text-primary tracking-wider">
          {formatHex(packet.packetHash)}
        </span>
        <span>
          <Badge variant={payloadTypeVariant(packet.payloadType)}>
            {PAYLOAD_TYPE_NAMES[packet.payloadType as PayloadTypeValue] ?? packet.payloadTypeName}
          </Badge>
        </span>
        <span className="flex min-w-0 flex-col items-start gap-0.5" title={packet.scope ? `${routeName} · ${packet.scope}` : routeName}>
          <span className="max-w-full truncate font-mono text-[10px] leading-3 text-text-muted uppercase tracking-wider">{routeName}</span>
          {packet.scope && <ScopeTag className="max-w-full truncate leading-3">{packet.scope}</ScopeTag>}
        </span>
        <span className="font-mono text-text-muted">×{packet.observationCount}</span>
        <span className="font-mono text-text-muted">{pathLength?.hopCount ?? na}</span>
        <span className="font-mono text-text-muted">{pathLength?.hashSize ?? na}</span>
        <span className="min-w-0 overflow-hidden">
          {message ? (
            <span className="flex min-w-0 items-baseline gap-1.5 font-mono">
              {sender && <span className="max-w-[35%] shrink-0 truncate font-semibold text-text-normal" title={sender}>{sender}:</span>}
              <span className="min-w-0 truncate text-text-muted" title={message.content}>{message.content}</span>
            </span>
          ) : <PacketEndpoints packet={packet} />}
        </span>
        <span className="font-mono font-bold text-primary tracking-wider">
          {packet.latestObserver?.iata ?? <span className="font-normal">{na}</span>}
        </span>
        <span className="text-right text-text-muted">
          <Timestamp value={packet.lastHeardAt} />
        </span>
      </button>
    </div>
  );
}
