import type { ContactKind, MessageKind } from "./types";

export const contactKindKeys: Record<ContactKind, string> = {
  repeater: "nodeTypes.repeater", client: "nodeTypes.companion", room: "nodeTypes.room_server", sensor: "nodeTypes.sensor",
  unknown: "traces.unknown",
};
export const messageKindKeys: Record<MessageKind, string> = {
  channel: "packetAnalyzer.payload.channel", advertisement: "nodeDetail.advert", direct: "talkers.direct",
  other: "traces.unknown",
};
