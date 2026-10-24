import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WsStatus } from "../api/ws-manager";

export function LiveBadge({ status, lastEventTimestamp, compact = false }: {
  status: WsStatus | "resolving"; lastEventTimestamp?: number; compact?: boolean;
}) {
  const { t } = useTranslation();
  const [staleStr, setStaleStr] = useState("");
  const hasTimestamp = lastEventTimestamp !== undefined && Number.isFinite(lastEventTimestamp);
  useEffect(() => {
    if (status !== "connecting" || !hasTimestamp) return;
    function update() {
      const seconds = Math.max(0, Math.floor((Date.now() - lastEventTimestamp!) / 1000));
      setStaleStr(seconds > 60 ? t("timestamp.unit.m", { count: Math.floor(seconds / 60) }) : t("timestamp.unit.s", { count: seconds }));
    }
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [status, lastEventTimestamp, hasTimestamp, t]);

  if (status === "connected" && compact) return <span data-slot="live-badge" data-status={status} role="status" aria-label={t("connection.live")} title={t("connection.live")} className="flex h-6 w-6 items-center justify-center">
    <span className="h-2 w-2 rounded-full bg-green animate-pulse motion-reduce:animate-none" />
  </span>;

  const label = status === "connected" ? t("connection.live") : status === "resolving" ? t("map.packetLog.loadingRegion")
    : status === "connecting" ? hasTimestamp && staleStr ? t("connection.stale", { age: staleStr }) : t("map.packetLog.connecting") : t("connection.offline");
  const tone = status === "connected" ? "text-green bg-green/8 border-green/15"
    : status === "connecting" || status === "resolving" ? "text-warn bg-warn/7 border-warn/15" : "text-danger bg-danger/8 border-danger/15";
  return <div data-slot="live-badge" data-status={status} role="status" aria-label={label} className={`flex items-center gap-1.5 font-mono text-[11px] border px-2 py-0.5 rounded-sm ${tone}`}>
    {status === "connected" && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-green animate-pulse motion-reduce:animate-none" />}
    {label}
  </div>;
}
