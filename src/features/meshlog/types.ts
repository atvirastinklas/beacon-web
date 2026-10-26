import type { PacketPath } from "../map/packet-path";
import type { WsStatus } from "../../api/ws-manager";
import type { PathConfidence } from "../../types/enums";
import type { WsPacketObservation } from "../../types/ws";
import type { Node, NodeSummary } from "../nodes/types";

export interface MeshlogLiveBatch {
  sequence: number;
  observations: readonly WsPacketObservation["data"][];
}

export type ContactKind = "repeater" | "client" | "room" | "sensor" | "unknown";
export type MessageKind = "channel" | "advertisement" | "direct" | "other";

export interface MeshlogContact {
  node?: NodeSummary;
  detail?: Node;
  detailLoading?: boolean;
  detailError?: boolean;
  id: string;
  name: string;
  kind: ContactKind;
  heard: string;
  firstSeen: string;
  heardAt?: number;
  firstSeenAt?: number;
  publicKey?: string;
  // Width of this node's most recently observed, resolved radio path hash.
  hashSize?: 1 | 2 | 3;
  position: [number, number] | null;
  // Missing means the directory provides no per-observer attribution.
  reporterIds?: string[];
  interval?: string;
  battery?: string;
}

export interface MeshlogReporter {
  id: string;
  name: string;
  color: string;
  publicKey?: string;
  code?: string;
  hashSize?: 1 | 2 | 3;
  iata?: string;
  observerType?: string;
  status?: "online" | "offline";
}

export interface MeshlogMessage {
  id: string;
  time: string;
  heardAt?: number;
  senderId?: string;
  senderName: string;
  senderUnknown?: boolean;
  originator?: string;
  target?: string;
  kind: MessageKind;
  payloadType: number;
  scope?: string;
  typeLabel?: string;
  channelId?: string;
  channel?: string;
  text?: string;
  reportsPending?: boolean;
  detailLoading?: boolean;
  reports: {
    reporterId: string; time: string; path: string[]; pathNames?: string[]; segments?: MeshlogPathSegment[];
    observerCode?: string; hashSize?: 1 | 2 | 3; pathUnavailable?: boolean;
  }[];
}

export interface MeshlogPathSegment {
  code: string;
  confidence: PathConfidence;
  nodes: { id: string; name?: string; publicKey: string }[];
}

export interface MeshlogChannel {
  id: string;
  name: string;
  keyKnown: boolean;
}

export interface MeshlogData {
  contacts: MeshlogContact[];
  messages: MeshlogMessage[];
  reporters: MeshlogReporter[];
  channels: MeshlogChannel[];
  scopes?: string[];
  paths: PacketPath[];
}

export interface MeshlogLiveState {
  status: WsStatus | "resolving";
  lastEventTimestamp?: number;
  loading: boolean;
  error: boolean;
  gap: boolean;
  emptyRegion: boolean;
  regionLabel: string;
  onRetry: () => void;
  historyLoading: boolean;
  historyRefreshing: boolean;
  historyError: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
  retryHistory: () => void;
  refreshHistory: () => void;
}
