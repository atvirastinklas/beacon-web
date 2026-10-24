import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import type { MeshlogPathSegment } from "./types";

export function PathCode({ code, segment }: { code: string; segment?: MeshlogPathSegment }) {
  const { t } = useTranslation();
  const descriptionId = useId();
  // Unknown/mismatched codes never acquire resolution from stray candidate data.
  const nodes = /^(?:[0-9a-f]{2}){1,3}$/i.test(code) && segment?.code === code ? segment.nodes : [];
  const state = nodes.length === 1 ? "resolved" : nodes.length > 1 ? "ambiguous" : "unresolved";
  const countLabel = `${t("tabs.Nodes")}: ${nodes.length}`;
  return <Tooltip>
    <TooltipTrigger render={<span tabIndex={0} />} className="meshlog-path-code" data-state={state}
      aria-label={`${code} · ${countLabel}`} aria-describedby={descriptionId}>
      {code}
    </TooltipTrigger>
    <TooltipContent id={descriptionId} role="tooltip" className="meshlog-path-tooltip">
      <p className="meshlog-path-tooltip-heading">{code} · {countLabel}</p>
      {nodes.length ? <ul>{nodes.map(node => <li key={node.id}>
        {node.name && <span>{node.name}</span>}
        <span className="meshlog-path-node-key">{node.publicKey}</span>
      </li>)}</ul> : <p className="meshlog-path-tooltip-empty">{t("packetTable.unknown")}</p>}
    </TooltipContent>
  </Tooltip>;
}
