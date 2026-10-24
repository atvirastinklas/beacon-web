import type { PacketDetail } from "../../types/api";
import { PayloadType } from "../../types/enums";
import type { PacketListItem } from "./types";

export function decodedMessage(detail: PacketDetail | undefined, hash: string): NonNullable<PacketListItem["message"]> | undefined {
  if (!detail || detail.packetHash.toLowerCase() !== hash.toLowerCase() || detail.header.payloadType !== PayloadType.GROUP_TEXT) return;
  const payload = detail.parsedPayload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.type !== "GROUP_TEXT") return;
  const decrypted = payload.decrypted;
  if (!decrypted || typeof decrypted !== "object" || Array.isArray(decrypted)) return;
  if (!("sender" in decrypted) || !("content" in decrypted) || typeof decrypted.sender !== "string" || typeof decrypted.content !== "string") return;
  return { senderName: decrypted.sender, content: decrypted.content };
}
