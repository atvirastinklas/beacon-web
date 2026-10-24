import { useEffect, useEffectEvent, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import type { MeshlogContact, MeshlogMessage, MeshlogReporter } from "./types";
import { ChannelBadge } from "./ChannelBadge";
import { shortNodeKey } from "./short-node-key";
import { ObserverCode } from "./ObserverCode";
import { PathCode } from "./PathCode";
import { PacketTypeBadge } from "./PacketTypeBadge";
import { packetTypeLabel } from "./packet-type";
import { PacketEndpoints } from "./PacketEndpoints";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { Timestamp } from "../../components/Timestamp";
import { formatClockDrift, formatRadio } from "../../lib/formatters";
import { NodeRoleIcon } from "./NodeRoleIcon";
import { contactNodeType } from "./contact-node-type";
import type { meshlogContactState } from "./contact-settings";


function PathCheckbox({ label, checked, available, pending = false, mixed = false, color = "var(--color-primary)", unavailableId, onCheckedChange, reason }: {
  label: string; checked: boolean; available: boolean; mixed?: boolean; color?: string;
  unavailableId: string; pending?: boolean; onCheckedChange: (checked: boolean) => void;
  reason?: string;
}) {
  const { t } = useTranslation();
  const unavailableLabel = reason ?? (pending ? t("common.loading") : t("packetRow.noPath"));
  if (!available) return <span className="sr-only" id={unavailableId}>{unavailableLabel}</span>;
  return <label className="meshlog-path-toggle" title={label} style={{ "--meshlog-path-color": color } as CSSProperties}>
    <input type="checkbox" checked={checked} ref={input => { if (input) input.indeterminate = mixed; }} onChange={event => onCheckedChange(event.target.checked)} aria-label={label} />
    <svg className="meshlog-path-mark" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
      <path className="meshlog-path-check" d="m3 7 2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path className="meshlog-path-mixed" d="M3 7h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  </label>;
}

interface MessageRowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: MeshlogMessage;
  reporters: ReadonlyMap<string, MeshlogReporter>;
  onInspect: () => void;
  channelUnverified?: boolean;
  showPath: boolean;
  canShowPath: boolean;
  onShowPathChange: (checked: boolean) => void;
  onPathPreviewChange: (preview: boolean) => void;
  pathPartiallyShown: boolean;
  pinnedReportIds: string[];
  mappableReportIds: string[];
  onReportShowPathChange: (reporterId: string, checked: boolean) => void;
  onReportPathPreviewChange: (reporterId: string, preview: boolean) => void;
}

export function MessageRow({
  message, reporters, onInspect, showPath, canShowPath, onShowPathChange, onPathPreviewChange, channelUnverified = false,
  pathPartiallyShown, pinnedReportIds, mappableReportIds, onReportShowPathChange, onReportPathPreviewChange,
  open, onOpenChange,
}: MessageRowProps) {
  const { t } = useTranslation();
  const sender = { name: message.senderName };
  const typeLabel = packetTypeLabel(message.payloadType, message.typeLabel, t);
  const pathLabel = `${t("investigation.map")} · ${sender.name} · ${message.time}`;
  const unavailableId = `meshlog-no-path-${message.id}`;
  const pathAvailable = canShowPath && !channelUnverified;
  const descriptionIds = `meshlog-message-${message.id}` + (pathAvailable ? "" : ` ${unavailableId}`);
  const showEndpoints = Boolean(message.originator || message.target) && (message.senderUnknown === true || (message.kind === "other" && !message.text));
  const replaceSender = showEndpoints && message.senderUnknown === true;
  const clearPreview = useEffectEvent(() => {
    onPathPreviewChange(false);
    message.reports.forEach(report => onReportPathPreviewChange(report.reporterId, false));
  });
  useEffect(() => () => clearPreview(), []);
  return <Collapsible open={open} className="meshlog-row meshlog-message-row" data-meshlog-packet={message.id} onOpenChange={open => {
    onOpenChange(open);
    if (open) onInspect();
    if (!open) message.reports.forEach(report => onReportPathPreviewChange(report.reporterId, false));
  }}>
    <div className="meshlog-message-main" data-path-available={pathAvailable || undefined} onPointerEnter={() => { onInspect(); onPathPreviewChange(true); }} onPointerLeave={() => onPathPreviewChange(false)}
      onFocus={() => { onInspect(); onPathPreviewChange(true); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onPathPreviewChange(false); }}>
    <Tooltip>
      <TooltipTrigger render={<CollapsibleTrigger />} disabled={!showEndpoints} className="meshlog-row-trigger" aria-label={t("map.packetLog.details", { type: typeLabel, summary: `${sender.name} · ${message.time}` })} aria-describedby={descriptionIds}>
        <span className="meshlog-meta"><span className="meshlog-disclosure" aria-hidden="true">▸</span><time>{message.time}</time><PacketTypeBadge payloadType={message.payloadType} label={typeLabel} />{channelUnverified ? <span className="meshlog-channel-unverified">{t("meshlog.channels.unverified")}{message.detailLoading && <> · <span role="status">{t("common.loading")}</span></>}</span> : message.channel && <ChannelBadge channel={message.channel} />}{!message.text && <span id={`meshlog-message-${message.id}`} className={showEndpoints ? "meshlog-message-identity" : "meshlog-name"}>
          {showEndpoints ? <>{!replaceSender && <span className="meshlog-name">{sender.name}</span>}<PacketEndpoints originator={message.originator} target={message.target} /></> : sender.name}
        </span>}</span>
        {message.text && <span id={`meshlog-message-${message.id}`}>
          {replaceSender ? <PacketEndpoints originator={message.originator} target={message.target} /> : <span className="meshlog-name">{message.kind === "channel" || message.kind === "direct" ? <><span className="meshlog-sender-bracket">{"<"}</span><span className="meshlog-sender-name">{sender.name}</span><span className="meshlog-sender-bracket">{">"}</span></> : sender.name}</span>}
          {" "}<span className="meshlog-message">{message.text}</span>
        </span>}
      </TooltipTrigger>
      {showEndpoints && <TooltipContent role="tooltip"><PacketEndpoints originator={message.originator} target={message.target} full /></TooltipContent>}
    </Tooltip>
    <PathCheckbox label={pathLabel} checked={showPath} mixed={pathPartiallyShown} available={pathAvailable} pending={message.detailLoading} reason={channelUnverified ? t("meshlog.channels.unverified") : undefined} unavailableId={unavailableId} onCheckedChange={onShowPathChange} />
    </div>
    <CollapsibleContent className="meshlog-reports">
      {(message.detailLoading || message.reports.length === 0) && <p className="meshlog-report-empty" role={message.detailLoading ? "status" : undefined}>{t(message.detailLoading ? "common.loading" : "common.dataUnavailable")}</p>}
      {message.reports.map(report => {
        const reporter: MeshlogReporter = reporters.get(report.reporterId) ?? { id: report.reporterId, name: t("traces.unknown"), color: "var(--color-text-normal)" };
        const mappable = !channelUnverified && mappableReportIds.includes(reporter.id);
        const reportPathLabel = `${t("investigation.map")} · ${reporter.name} · ${sender.name} · ${message.time}`;
        const reportUnavailableId = `${unavailableId}-${reporter.id}`;
        const direct = report.path.length === 0 && !report.pathUnavailable;
        return <div className="meshlog-report" key={report.reporterId} data-path-available={mappable || undefined} onPointerEnter={() => { onInspect(); onReportPathPreviewChange(reporter.id, true); }} onPointerLeave={() => onReportPathPreviewChange(reporter.id, false)}
          onFocus={() => onReportPathPreviewChange(reporter.id, true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onReportPathPreviewChange(reporter.id, false); }}>
          <div className="meshlog-report-content">
            <time>{report.time}</time><span className="meshlog-report-observer"><ObserverCode reporter={reporter} code={report.observerCode ?? reporter.code} />{direct && <span className="meshlog-report-path meshlog-report-direct">{t("talkers.direct")}</span>}</span>
            {!direct && <span className="meshlog-report-path">{report.path.length ? report.path.map((code, index) => <span className="meshlog-hop" key={`${index}:${code}`}>{index > 0 && <span className="meshlog-path-separator"> → </span>}<PathCode code={code} segment={report.segments?.[index]} /></span>) : t("packetRow.noPath")}</span>}
          </div>
          <PathCheckbox label={reportPathLabel} checked={pinnedReportIds.includes(reporter.id)} available={mappable} pending={message.detailLoading} reason={channelUnverified ? t("meshlog.channels.unverified") : undefined} color={reporter.color} unavailableId={reportUnavailableId} onCheckedChange={checked => onReportShowPathChange(reporter.id, checked)} />
        </div>;
      })}
    </CollapsibleContent>
  </Collapsible>;
}

export interface ContactDisplay { locationWarnings: boolean; timeWarnings?: boolean }

export function ContactRow({ contact, display, state, onInspect, onRetry, open, onOpenChange }: { contact: MeshlogContact; display: ContactDisplay; state?: ReturnType<typeof meshlogContactState>; onInspect?: () => void; onRetry?: () => void; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const { t } = useTranslation();
  const node = contact.node ?? contact.detail;
  const publicKey = contact.publicKey ?? node?.publicKey;
  const detail = contact.detail;
  const type = contactNodeType(contact);
  const firstSeen = detail?.firstSeen ?? contact.firstSeenAt;
  const ageWarning = display.timeWarnings && (state?.age === "expired" || state?.age === "veryExpired") ? state.age : undefined;
  const clockWarning = display.timeWarnings && state?.clockWarning && detail?.clockDriftSeconds != null;
  return <Collapsible open={open} className="meshlog-row" data-age={ageWarning} onOpenChange={open => { onOpenChange?.(open); if (open) onInspect?.(); }}>
    <CollapsibleTrigger className="meshlog-row-trigger" aria-label={`${t("nodeDetail.title")}: ${contact.name}`} aria-describedby={`meshlog-contact-meta-${contact.id}`}>
      <span className="meshlog-meta" id={`meshlog-contact-meta-${contact.id}`}><time>{contact.heard}</time><span className="meshlog-contact-metadata">
        {ageWarning && <span className="meshlog-age-warning">{t(ageWarning === "expired" ? "meshlog.settings.expired" : "meshlog.settings.veryExpired")}</span>}
        {clockWarning && <span className="meshlog-clock-warning">{t("nodeDetail.clockDrift")}: {formatClockDrift(detail.clockDriftSeconds!, { inSync: t("clockDrift.inSync"), ahead: t("clockDrift.ahead"), behind: t("clockDrift.behind") })}</span>}
        {!contact.position && display.locationWarnings && <span className="meshlog-location-warning">{t("nodeDetail.location")}: {t("packetEndpoints.na")}</span>}
      </span><span className="meshlog-disclosure" aria-hidden="true">▸</span></span>
      <span className="meshlog-contact-name"><NodeRoleIcon contact={contact} /><span className="meshlog-id" title={publicKey}>{shortNodeKey(publicKey, contact.hashSize) || "—"}</span> <span className="meshlog-name">{contact.name}</span></span>
    </CollapsibleTrigger>
    <CollapsibleContent className="meshlog-contact-details" aria-busy={contact.detailLoading || undefined}>
      {contact.detailError && <p role="alert">{t("common.loadFailed")} {onRetry && <button type="button" onClick={onRetry} aria-label={`${t("packetList.retry")} · ${contact.name}`}>{t("packetList.retry")}</button>}</p>}
      {detail && contact.detailLoading && <p role="status">{t("common.loading")}</p>}
      <dl>
        <dt>{t("nodes.colType")}</dt><dd>{type === "unknown" ? t("traces.unknown") : t(`nodeTypes.${type}`)}{node?.isObserver && <> · {t("nodes.observer")}</>}</dd>
        <dt>{t("routes.columns.firstSeen")}</dt><dd>{firstSeen !== undefined ? <Timestamp value={firstSeen} /> : contact.detailLoading ? <span role="status">{t("common.loading")}</span> : t("common.dataUnavailable")}</dd>
        <dt>{t("packetTable.hash")}</dt><dd>{publicKey || "—"}</dd>
        <dt>{t("nodeDetail.location")}</dt><dd>{contact.position ? `${contact.position[1].toFixed(5)}, ${contact.position[0].toFixed(5)}` : t("common.dataUnavailable")}</dd>
        {node?.radio && <><dt>{t("nodeDetail.radio")}</dt><dd>{formatRadio(node.radio) ?? node.radio}</dd></>}
        {node?.defaultScope && <><dt>{t("nodeDetail.scope")}</dt><dd>{node.defaultScope}</dd></>}
        {!!node?.iatas.length && <><dt>{t("region.label")}</dt><dd>{node.iatas.map(area => area.iata).join(", ")}</dd></>}
        {node && <><dt>{t("nodeDetail.neighbors")}</dt><dd>{node.knownNeighborCount}</dd></>}
        {detail && <>
          <dt>{t("nodeDetail.last")}</dt><dd><Timestamp value={detail.lastSeen} /></dd>
          {detail.lastAdvertAt != null && <><dt>{t("nodeDetail.advert")}</dt><dd><Timestamp value={detail.lastAdvertAt} /></dd></>}
          {detail.locationSource && <><dt>{t("nodeDetail.source")}</dt><dd>{detail.locationSource}</dd></>}
          {detail.minFirmwareVersion && <><dt>{t("nodeDetail.minFirmware")}</dt><dd>{detail.minFirmwareVersion}</dd></>}
          <dt>{t("nodeDetail.multibytePaths")}</dt><dd>{t(detail.supportsMultibytePaths ? "nodeDetail.yes" : "nodeDetail.no")}</dd>
          <dt>{t("nodeDetail.multibyteTraces")}</dt><dd>{t(detail.supportsMultibyteTraces ? "nodeDetail.yes" : "nodeDetail.no")}</dd>
          {detail.clockDriftSeconds != null && <><dt>{t("nodeDetail.clockDrift")}</dt><dd>{formatClockDrift(detail.clockDriftSeconds, { inSync: t("clockDrift.inSync"), ahead: t("clockDrift.ahead"), behind: t("clockDrift.behind") })}</dd></>}
        </>}
      </dl>
    </CollapsibleContent>
  </Collapsible>;
}
