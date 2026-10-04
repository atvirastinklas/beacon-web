import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { WsManager } from "../../api/ws-manager";
import type { WsPacketObservation } from "../../types/ws";
import type { ChannelMessage } from "../channels/types";

export const LIVE_PACKET_LOG_CAP = 100;
export const LIVE_PACKET_LOG_GROUP_MS = 30_000;

export interface LivePacketLogEntry {
  id: number;
  data: WsPacketObservation["data"];
  seenCount: number;
  firstHeardAt: number; // epoch time of this row's first accepted observation; repeats never change it
  firstReceivedAt: number; // monotonic arrival time; anchors the fixed grouping window
  lastReceivedAt: number;
  message?: { content: string; senderName: string };
}

// Like a compact packet feed, group repeated sightings of one hash within a fixed arrival window.
// seenCount counts callbacks in this feed, not the server's cumulative packet.observationCount.
// Batch notifications once per animation frame so a busy feed doesn't repaint the panel per event.
class LivePacketLogStore {
  private entries: readonly LivePacketLogEntry[] = [];
  private pending: readonly LivePacketLogEntry[] = [];
  private sequence = 0;
  private frame: number | null = null;
  private listeners = new Set<() => void>();
  private messages = new Map<string, { receivedAt: number; message: NonNullable<LivePacketLogEntry["message"]> }>();

  getSnapshot = () => this.entries;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  push(data: WsPacketObservation["data"]) {
    const now = performance.now();
    this.pruneMessages(now);
    const hash = data.packetHash.toLowerCase();
    const index = this.pending.findIndex(entry => entry.data.packetHash.toLowerCase() === hash
      && now - entry.firstReceivedAt < LIVE_PACKET_LOG_GROUP_MS);
    const previous = this.pending[index];
    const entry: LivePacketLogEntry = previous
      ? { ...previous, data, seenCount: previous.seenCount + 1, lastReceivedAt: now }
      : { id: ++this.sequence, data, seenCount: 1, firstHeardAt: data.observation.heardAt, firstReceivedAt: now, lastReceivedAt: now };
    const message = this.messages.get(hash)?.message;
    if (message) entry.message = message;
    this.pending = [entry, ...this.pending.filter((_, i) => i !== index)]
      .sort((a, b) => b.firstHeardAt - a.firstHeardAt || b.id - a.id)
      .slice(0, LIVE_PACKET_LOG_CAP);
    this.publishPending();
  }

  // The channel stream supplies decoded text but no IATA. Only an accepted observation can
  // introduce a visible row; matching an immutable packet hash enriches that row, never activity.
  enrich(data: ChannelMessage) {
    const now = performance.now();
    this.pruneMessages(now);
    const hash = data.packetHash.toLowerCase();
    const message = { content: data.content, senderName: data.senderName };
    this.messages.delete(hash);
    this.messages.set(hash, { receivedAt: now, message });
    if (this.messages.size > LIVE_PACKET_LOG_CAP) this.messages.delete(this.messages.keys().next().value!);
    let changed = false;
    this.pending = this.pending.map(entry => {
      if (entry.data.packetHash.toLowerCase() !== hash ||
          (entry.message?.content === message.content && entry.message?.senderName === message.senderName)) return entry;
      changed = true;
      return { ...entry, message };
    });
    if (changed) this.publishPending();
  }

  private pruneMessages(now: number) {
    for (const [hash, cached] of this.messages) {
      if (now - cached.receivedAt >= LIVE_PACKET_LOG_GROUP_MS) this.messages.delete(hash);
    }
  }

  private publishPending() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.entries = this.pending;
      for (const listener of this.listeners) listener();
    });
  }

  cancelPending() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending = this.entries;
    this.messages.clear();
  }
}

export function useLivePacketLog(
  wsManager: WsManager,
  enabled: boolean,
  regionKey: string,
  selectedIatas: string[] | undefined,
): readonly LivePacketLogEntry[] {
  // Each live/region session owns a fresh store. No previous region's rows flash during a switch,
  // and equivalent IATA arrays don't reset the log merely because their references changed.
  const iataKey = selectedIatas?.join(",");
  const session = useMemo(() => ({
    manager: wsManager,
    enabled,
    regionKey,
    iatas: iataKey === undefined ? null : new Set(iataKey ? iataKey.split(",") : []),
    store: new LivePacketLogStore(),
  }), [wsManager, enabled, regionKey, iataKey]);
  const entries = useSyncExternalStore(session.store.subscribe, session.store.getSnapshot);

  useEffect(() => {
    if (!session.enabled) return;
    let active = true;
    const unsubscribe = session.manager.onPacketObservation(data => {
      // A previous region's subscription may still deliver while the server switches filters.
      if (!active || (session.iatas && !session.iatas.has(data.observation.iata))) return;
      session.store.push(data);
    });
    const unsubscribeMessages = session.manager.onChannelMessage(data => {
      if (active) session.store.enrich(data);
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeMessages();
      session.store.cancelPending();
    };
  }, [session]);

  return entries;
}
