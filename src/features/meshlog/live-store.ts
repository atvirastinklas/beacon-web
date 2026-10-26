import type { WsNodeUpdate, WsObserverStatus, WsPacketObservation } from "../../types/ws";
import type { ChannelMessage } from "../channels/types";
import { LIVE_PACKET_LOG_CAP } from "../map/useLivePacketLog";
import type { PacketDetail, PacketSummary } from "../../types/api";
import type { MeshlogLiveBatch } from "./types";
import { PACKET_FLOW_MAX } from "../map/types";

type PacketEvent = WsPacketObservation["data"];
export interface LiveMeshlogPacket {
  hash: string;
  packet: Pick<PacketSummary, "payloadType" | "payloadTypeName" | "routeType" | "routeTypeName" | "scope" | "summary">;
  firstHeardAt: number;
  lastHeardAt: number;
  reports: ReadonlyMap<string, PacketEvent["observation"]>;
  message?: ChannelMessage;
  summary?: PacketSummary;
  detail?: PacketDetail;
}

export interface LiveMeshlogSnapshot {
  liveBatch: MeshlogLiveBatch;
  packets: readonly LiveMeshlogPacket[];
  nodes: ReadonlyMap<string, WsNodeUpdate["data"]>;
  observers: ReadonlyMap<string, WsObserverStatus["data"]>;
  gap: boolean;
}

/** Retained session history with RAF-batched updates; transient live batches and unmatched messages are bounded. */
export class MeshlogLiveStore {
  private pending: LiveMeshlogSnapshot = { packets: [], nodes: new Map(), observers: new Map(), gap: false, liveBatch: { sequence: 0, observations: [] } };
  private snapshot = this.pending;
  private messages = new Map<string, ChannelMessage>();
  private listeners = new Set<() => void>();
  private frame: number | null = null;
  private pendingObservations: PacketEvent[] = [];
  private gapRevision = 0;

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  observe(data: PacketEvent) {
    this.pendingObservations.push(data);
    if (this.pendingObservations.length > PACKET_FLOW_MAX) this.pendingObservations.shift();
    const hash = data.packetHash.toLowerCase();
    const prior = this.pending.packets.find(packet => packet.hash === hash);
    const reports = new Map(prior?.reports);
    const previousReport = reports.get(data.observation.observerId);
    if (!previousReport || data.observation.heardAt >= previousReport.heardAt) reports.set(data.observation.observerId, data.observation);
    const packet: LiveMeshlogPacket = {
      hash, packet: { ...data.packet, scope: data.packet.scope || prior?.packet.scope },
      firstHeardAt: Math.min(prior?.firstHeardAt ?? data.observation.heardAt, data.observation.heardAt),
      lastHeardAt: Math.max(prior?.lastHeardAt ?? data.observation.heardAt, data.observation.heardAt),
      reports, message: this.messages.get(hash) ?? prior?.message,
      summary: prior?.summary, detail: prior?.detail,
    };
    this.pending = { ...this.pending, packets: [packet, ...this.pending.packets.filter(item => item.hash !== hash)]
      .sort((a, b) => b.firstHeardAt - a.firstHeardAt || a.hash.localeCompare(b.hash)) };
    this.publish();
  }

  mergeHistory(summaries: PacketSummary[]) {
    const packets = new Map(this.pending.packets.map(packet => [packet.hash, packet]));
    let changed = false;
    for (const summary of summaries) {
      const hash = summary.packetHash.toLowerCase();
      const prior = packets.get(hash);
      if (prior?.summary === summary) continue;
      packets.set(hash, {
        ...prior, hash, packet: prior?.packet ?? summary, summary,
        firstHeardAt: Math.min(prior?.firstHeardAt ?? summary.firstHeardAt, summary.firstHeardAt),
        lastHeardAt: Math.max(prior?.lastHeardAt ?? summary.lastHeardAt, summary.lastHeardAt),
        reports: prior?.reports ?? new Map(), message: prior?.message ?? this.messages.get(hash),
      });
      changed = true;
    }
    if (!changed) return;
    this.pending = { ...this.pending, packets: [...packets.values()].sort((a, b) => b.firstHeardAt - a.firstHeardAt || a.hash.localeCompare(b.hash)) };
    this.publish();
  }

  hydrate(detail: PacketDetail) {
    const hash = detail.packetHash.toLowerCase();
    const prior = this.pending.packets.find(packet => packet.hash === hash);
    if (!prior || prior.detail === detail) return;
    const packet = { ...prior, detail,
      firstHeardAt: Math.min(prior.firstHeardAt, detail.firstHeardAt),
      lastHeardAt: Math.max(prior.lastHeardAt, detail.lastHeardAt),
    };
    this.pending = { ...this.pending, packets: this.pending.packets.map(item => item.hash === hash ? packet : item)
      .sort((a, b) => b.firstHeardAt - a.firstHeardAt || a.hash.localeCompare(b.hash)) };
    this.publish();
  }

  enrich(message: ChannelMessage) {
    const hash = message.packetHash.toLowerCase();
    this.messages.delete(hash);
    this.messages.set(hash, message);
    if (this.messages.size > LIVE_PACKET_LOG_CAP) this.messages.delete(this.messages.keys().next().value!);
    // Channel events carry no geography. They enrich accepted hashes, never introduce packets.
    if (!this.pending.packets.some(packet => packet.hash === hash)) return;
    this.pending = { ...this.pending, packets: this.pending.packets.map(packet => packet.hash === hash ? { ...packet, message } : packet) };
    this.publish();
  }

  updateNode(data: WsNodeUpdate["data"]) {
    const nodes = new Map(this.pending.nodes);
    const prior = nodes.get(data.nodeId);
    nodes.set(data.nodeId, { ...prior, ...data,
      lat: data.lat === undefined ? prior?.lat : data.lat,
      lng: data.lng === undefined ? prior?.lng : data.lng,
      possiblyForeign: data.possiblyForeign === undefined ? prior?.possiblyForeign : data.possiblyForeign,
    });
    this.pending = { ...this.pending, nodes };
    this.publish();
  }

  updateObserver(data: WsObserverStatus["data"]) {
    const observers = new Map(this.pending.observers);
    observers.set(data.observerId, data);
    this.pending = { ...this.pending, observers };
    this.publish();
  }

  noteGap() {
    this.gapRevision++;
    this.pending = { ...this.pending, gap: true };
    this.publish();
  }

  getGapRevision() { return this.gapRevision; }

  acknowledgeGap(revision: number) {
    // A refresh acknowledges only interruptions known when it started.
    if (revision !== this.gapRevision || !this.pending.gap) return;
    this.pending = { ...this.pending, gap: false };
    this.publish();
  }

  private publish() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.pendingObservations.length) {
        this.pending = { ...this.pending, liveBatch: { sequence: this.snapshot.liveBatch.sequence + 1, observations: this.pendingObservations } };
        this.pendingObservations = [];
      }
      this.snapshot = this.pending;
      for (const listener of this.listeners) listener();
    });
  }

  dispose() {
    this.gapRevision++;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending = this.snapshot;
    this.pendingObservations = [];
    this.messages.clear();
  }
}
