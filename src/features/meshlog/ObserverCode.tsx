import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import type { MeshlogReporter } from "./types";

export function ObserverCode({ reporter, code = reporter.code, checked, onCheckedChange }: {
  reporter: MeshlogReporter; code?: string; checked?: boolean; onCheckedChange?: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const filter = onCheckedChange !== undefined;
  return <Tooltip>
    <TooltipTrigger
      render={filter ? <label /> : <span tabIndex={0} />}
      className={filter ? undefined : "meshlog-reporter"}
      style={{ color: reporter.color }}
      aria-label={filter ? undefined : reporter.name}
      aria-describedby={descriptionId}
    >
      {filter && <input type="checkbox" checked={checked} onChange={event => onCheckedChange(event.target.checked)} aria-label={reporter.name} aria-describedby={descriptionId} />}
      {reporter.name}
    </TooltipTrigger>
    <TooltipContent id={descriptionId} role="tooltip" className="meshlog-observer-tooltip" side="top">
      <p className="meshlog-observer-tooltip-name">{reporter.name}</p>
      <dl>
        {code && <><dt>{t("packetTable.hash")}</dt><dd>{code}</dd></>}
        {reporter.publicKey && <><dt>{t("observerPage.publicKey")}</dt><dd>{reporter.publicKey}</dd></>}
        {reporter.iata && <><dt>{t("region.label")}</dt><dd>{reporter.iata}</dd></>}
        {reporter.observerType && <><dt>{t("observerFilters.type")}</dt><dd>{reporter.observerType}</dd></>}
        {reporter.status && <><dt>{t("observerFilters.status")}</dt><dd>{t(`observerFilters.${reporter.status}`)}</dd></>}
      </dl>
    </TooltipContent>
  </Tooltip>;
}
