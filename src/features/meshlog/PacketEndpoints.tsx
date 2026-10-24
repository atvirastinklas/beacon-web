import { useTranslation } from "react-i18next";
import { shortNodeKey } from "./short-node-key";

export function PacketEndpoints({ originator, target, full = false }: { originator?: string; target?: string; full?: boolean }) {
  const { t } = useTranslation();
  if (!originator && !target) return null;
  if (full) return <dl className="meshlog-endpoint-details">
    {originator && <><dt>{t("meshlog.endpoints.originator")}</dt><dd><code>{originator}</code></dd></>}
    {target && <><dt>{t("meshlog.endpoints.target")}</dt><dd><code>{target}</code></dd></>}
  </dl>;
  return <span className="meshlog-packet-endpoints">
    {originator && <span><span className="sr-only">{t("meshlog.endpoints.originator")}: {originator}</span><code aria-hidden="true">{shortNodeKey(originator)}</code></span>}
    {target && <><span aria-hidden="true">→</span><span><span className="sr-only">{t("meshlog.endpoints.target")}: {target}</span><code aria-hidden="true">{shortNodeKey(target)}</code></span></>}
  </span>;
}
