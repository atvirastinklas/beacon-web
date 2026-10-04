import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { WsManager } from "../../api/ws-manager";
import type { WsPacketObservation } from "../../types/ws";

export const LIVE_PACKET_LOG_CAP = 100;
export const LIVE_PACKET_LOG_GROUP_MS = 30_000;

export interface LivePacketLogEntry {
  id: number;
  data: WsPacketObservation["data"];
  seenCount: number;
  firstReceivedAt: number; // monotonic arrival time; anchors the fixed grouping window
  lastReceivedAt: number;
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

  getSnapshot = () => this.entries;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  push(data: WsPacketObservation["data"]) {
    const now = performance.now();
    const index = this.pending.findIndex(entry => entry.data.packetHash === data.packetHash
      && now - entry.firstReceivedAt < LIVE_PACKET_LOG_GROUP_MS);
    const previous = this.pending[index];
    const entry: LivePacketLogEntry = previous
      ? { ...previous, data, seenCount: previous.seenCount + 1, lastReceivedAt: now }
      : { id: ++this.sequence, data, seenCount: 1, firstReceivedAt: now, lastReceivedAt: now };
    this.pending = [entry, ...this.pending.filter((_, i) => i !== index)].slice(0, LIVE_PACKET_LOG_CAP);
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
    return () => {
      active = false;
      unsubscribe();
      session.store.cancelPending();
    };
  }, [session]);

  return entries;
}
