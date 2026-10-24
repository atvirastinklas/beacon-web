import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../hooks/useTheme";
import { nodeTypeColor } from "../map/node-icons";
import { contactNodeType } from "./contact-node-type";
import type { MeshlogContact } from "./types";

const assets = import.meta.glob("../map/markers/glitch/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const images = new Map<string, string>();

export function NodeRoleIcon({ contact }: { contact: MeshlogContact }) {
  const { t } = useTranslation();
  const { paletteRev } = useTheme();
  const type = contactNodeType(contact);
  const observer = !!contact.node?.isObserver;
  const src = useMemo(() => {
    const key = `${paletteRev}:${type}:${observer}`;
    if (images.has(key)) return images.get(key);
    const svg = assets[`../map/markers/glitch/${type}${observer ? "-observer" : ""}.svg`];
    if (!svg) return undefined;
    const recolored = svg.replace(/var\(--node-color,\s*#[0-9a-fA-F]{3,8}\)/g, nodeTypeColor(type)).replace(/var\(--observer-color,\s*#[0-9a-fA-F]{3,8}\)/g, "#c79bff");
    const image = `data:image/svg+xml,${encodeURIComponent(recolored)}`;
    images.set(key, image);
    return image;
  }, [type, observer, paletteRev]);
  return <span role="img" aria-label={type === "unknown" ? t("traces.unknown") : t(`nodeTypes.${type}`)} className="meshlog-role-icon" data-node-type={type} data-observer={observer || undefined}>
    {src ? <img src={src} alt="" /> : <span className="meshlog-role-unknown" />}
  </span>;
}
