import type { TFunction } from "i18next";
import { PAYLOAD_TYPE_NAMES, type PayloadTypeValue } from "../../types/enums";
import type { MeshlogMessage } from "./types";

export function packetTypeLabel(payloadType: number, serverLabel: string | undefined, t: TFunction): string {
  return PAYLOAD_TYPE_NAMES[payloadType as PayloadTypeValue] ?? (serverLabel || t("map.packetLog.unknownType", { type: payloadType }));
}

export function packetTypeOptions(messages: Pick<MeshlogMessage, "payloadType" | "typeLabel">[], t: TFunction) {
  const known = Object.entries(PAYLOAD_TYPE_NAMES).map(([id, name]) => ({ id, name }));
  const knownIds = new Set(known.map(option => Number(option.id)));
  const observed = new Map<number, string | undefined>();
  for (const message of messages) {
    if (knownIds.has(message.payloadType)) continue;
    if (!observed.has(message.payloadType) || !observed.get(message.payloadType)) observed.set(message.payloadType, message.typeLabel);
  }
  return [...known, ...[...observed].sort(([a], [b]) => a - b).map(([payloadType, label]) => ({
    id: String(payloadType), name: packetTypeLabel(payloadType, label, t),
  }))].map(option => ({ ...option, searchText: `${option.id} 0x${Number(option.id).toString(16)}` }));
}
