import type { PayloadTypeValue, RouteTypeValue } from "../../types/enums";
import type { PacketSummary } from "../../types/api";
import type { ChannelMessage } from "../channels/types";

// Decoded channel events enrich the list locally; the packet REST shape is unchanged.
export interface PacketListItem extends PacketSummary {
  message?: Pick<ChannelMessage, "senderName" | "content">;
}

export type SearchField = "hash" | "path" | "payload";

export interface PacketFilterState {
  payloadTypes: PayloadTypeValue[];
  routeTypes: RouteTypeValue[];
  observers: string[];
  scopes: string[]; // transport scope names, e.g. "#bc"
  search: string;
  searchField: SearchField;
}

// Filters /packets history can apply server-side; each accepts multiple comma-separated values.
export interface PacketServerFilter {
  payloadTypes?: number[];
  routeTypes?: number[];
  scopes?: string[];
}

export const EMPTY_FILTERS: PacketFilterState = {
  payloadTypes: [],
  routeTypes: [],
  observers: [],
  scopes: [],
  search: "",
  searchField: "hash",
};
