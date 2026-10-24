import { useTranslation } from "react-i18next";
import { LanguagePicker } from "../../components/LanguagePicker";
import { LiveBadge } from "../../components/LiveBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import type { MeshlogLiveState } from "./types";

export function PacketHeader({ liveState }: { liveState: MeshlogLiveState }) {
  const { t } = useTranslation();
  return <>
    <header className="meshlog-packet-header">
      <div className="meshlog-brand" data-error={liveState.error || undefined}>
        <div className="meshlog-identity">
          <Tooltip>
            <TooltipTrigger render={<a href="/" />} className="meshlog-header-back" aria-label={t("meshlog.backToBeacon")}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="m10 3-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </TooltipTrigger>
            <TooltipContent side="bottom" role="tooltip">{t("meshlog.backToBeacon")}</TooltipContent>
          </Tooltip>
          <h1>MeshLog</h1>
        </div>
        <LiveBadge status={liveState.status} lastEventTimestamp={liveState.lastEventTimestamp} />
        <div className="meshlog-header-actions">
          {liveState.error && <Tooltip>
            <TooltipTrigger render={<button type="button" disabled={liveState.loading} />} className="meshlog-header-retry" aria-label={t("packetList.retry")}
              disabled={liveState.loading} aria-busy={liveState.loading} onClick={liveState.onRetry}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={liveState.loading ? "animate-spin motion-reduce:animate-none" : undefined}>
                <path d="M13 6a5 5 0 1 0 .1 3M13 2v4H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </TooltipTrigger>
            <TooltipContent role="tooltip">{liveState.loading ? t("common.loading") : t("packetList.retry")}</TooltipContent>
          </Tooltip>}
          <div className="meshlog-language"><LanguagePicker /></div>
        </div>
      </div>
    </header>
    {(liveState.error || liveState.gap) && <div className="meshlog-live-state">
      {liveState.error && <p role="alert">{t("common.loadFailed")}</p>}
      {liveState.gap && <p role="alert">{t("tabs.Packets")} · {t("common.dataUnavailable")}</p>}
    </div>}
  </>;
}
