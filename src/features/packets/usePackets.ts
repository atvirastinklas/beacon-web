import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { getPackets } from "../../api/client";
import { isRateLimited } from "../../api/rate-limit";
import { useRegion } from "../../hooks/useRegion";
import type { WsPacketObservation, WsLagged } from "../../types/ws";
import type { PacketSummary } from "../../types/api";
import type { PacketListItem, PacketServerFilter } from "./types";
import type { ChannelMessage } from "../channels/types";
import { LIVE_BUFFER_CAP } from "../../lib/constants";

// merge and deduplicate live + paginated packets

function flattenPages(data: { pages: Array<{ items: PacketSummary[] }> } | undefined): PacketSummary[] {
  if (!data) return [];
  return data.pages.flatMap((p) => p.items);
}

function dedup(packets: PacketSummary[]): PacketSummary[] {
  const seen = new Set<string>();
  return packets.filter((p) => {
    if (seen.has(p.packetHash)) return false;
    seen.add(p.packetHash);
    return true;
  });
}

interface LiveSnapshot {
  buffer: readonly PacketSummary[];
  acknowledgedCount: number;
  observersByHash: ReadonlyMap<string, ReadonlySet<string>>;
  messagesByHash: ReadonlyMap<string, NonNullable<PacketListItem["message"]>>;
}

// RAF batching avoids re-rendering on every WS message -- can be 50+/sec during floods

class LivePacketStore {
  private buffer: PacketSummary[] = [];
  private hashIndex = new Map<string, number>();
  private observersByHash = new Map<string, Set<string>>();
  private acknowledgedCount = 0;
  private messagesByHash = new Map<string, NonNullable<PacketListItem["message"]>>();
  private snapshot: LiveSnapshot = { buffer: [], acknowledgedCount: 0, observersByHash: new Map(), messagesByHash: new Map() };
  private listeners = new Set<() => void>();
  private rafId: number | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LiveSnapshot => {
    return this.snapshot;
  };

  private scheduleNotify(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.snapshot = { buffer: this.buffer, acknowledgedCount: this.acknowledgedCount, observersByHash: this.observersByHash, messagesByHash: this.messagesByHash };
      for (const l of this.listeners) l();
    });
  }

  pushOrUpdate(summary: PacketSummary): void {
    if (summary.latestObserver) {
      const observers = this.observersByHash.get(summary.packetHash);
      if (observers) {
        observers.add(summary.latestObserver.id);
      } else {
        this.observersByHash.set(summary.packetHash, new Set([summary.latestObserver.id]));
      }
    }

    const existing = this.hashIndex.get(summary.packetHash);
    if (existing !== undefined) {
      // A WS message only knows its own heardAt, so widen the window rather than replacing it —
      // otherwise the expanded row's spread reads 0 for every re-heard packet.
      const prev = this.buffer[existing]!;
      this.buffer = [...this.buffer];
      this.buffer[existing] = {
        ...summary,
        firstHeardAt: Math.min(prev.firstHeardAt, summary.firstHeardAt),
        lastHeardAt: Math.max(prev.lastHeardAt, summary.lastHeardAt),
      };
    } else {
      this.buffer = [summary, ...this.buffer];
      this.rebuildIndex();
      if (this.buffer.length > LIVE_BUFFER_CAP) {
        // TODO: this splice mutates in-place after the spread copy above -- fine for now but sloppy
        const removed = this.buffer.splice(LIVE_BUFFER_CAP);
        for (const p of removed) {
          this.hashIndex.delete(p.packetHash);
          this.observersByHash.delete(p.packetHash);
        }
      }
    }
    this.scheduleNotify();
  }

  enrich(data: ChannelMessage): void {
    const hash = data.packetHash.toLowerCase();
    const previous = this.messagesByHash.get(hash);
    if (previous?.senderName === data.senderName && previous.content === data.content) return;
    // Events may arrive before their observation or match a history row. Keep a bounded,
    // immutable cache, without inserting packets or changing counts/order.
    this.messagesByHash = new Map(this.messagesByHash);
    this.messagesByHash.delete(hash);
    this.messagesByHash.set(hash, { senderName: data.senderName, content: data.content });
    if (this.messagesByHash.size > LIVE_BUFFER_CAP) {
      this.messagesByHash.delete(this.messagesByHash.keys().next().value!);
    }
    this.scheduleNotify();
  }

  private rebuildIndex(): void {
    this.hashIndex.clear();
    for (let i = 0; i < this.buffer.length; i++) {
      this.hashIndex.set(this.buffer[i]!.packetHash, i);
    }
  }

  acknowledge(): void {
    this.acknowledgedCount = this.buffer.length;
    this.snapshot = { buffer: this.buffer, acknowledgedCount: this.acknowledgedCount, observersByHash: this.observersByHash, messagesByHash: this.messagesByHash };
    for (const l of this.listeners) l();
  }

  reset(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.buffer = [];
    this.hashIndex.clear();
    this.observersByHash.clear();
    this.messagesByHash = new Map();
    this.acknowledgedCount = 0;
    this.snapshot = { buffer: [], acknowledgedCount: 0, observersByHash: new Map(), messagesByHash: this.messagesByHash };
  }
}

// combines live WS stream with paginated history

export function usePackets(frozen: boolean = false, serverFilter: PacketServerFilter | null = null) {
  const { iatas, regionKey, isResolved } = useRegion();
  const pending = isResolved === false;
  const queryClient = useQueryClient();
  const [store] = useState(() => new LivePacketStore());
  const [laggedCount, setLaggedCount] = useState(0);

  const [prevRegionKey, setPrevRegionKey] = useState(regionKey);
  const regionChanged = prevRegionKey !== regionKey;
  if (regionChanged) {
    setPrevRegionKey(regionKey);
    store.reset();
    setLaggedCount(0);
  }

  const { buffer: liveBuffer, acknowledgedCount, observersByHash, messagesByHash } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
  );

  // While scrolled away from the top, render a latched buffer so live prepends don't shift the
  // view; the held packets reveal when the user returns to the top. Latched by holding the last
  // value (set-state-during-render, this file's pattern — cf. prevRegionKey above). The
  // regionChanged guard drops the latch so a region switch never shows the previous region.
  const [displayBuffer, setDisplayBuffer] = useState(liveBuffer);
  if ((!frozen || regionChanged) && displayBuffer !== liveBuffer) {
    setDisplayBuffer(liveBuffer);
  }

  const handlePacketObservation = useCallback(
    (data: WsPacketObservation["data"]) => {
      // the previous region's subscription can still deliver after the buffer reset
      if (iatas && !iatas.includes(data.observation.iata)) return;
      const summary: PacketSummary = {
        packetHash: data.packetHash,
        payloadType: data.packet.payloadType,
        payloadTypeName: data.packet.payloadTypeName,
        routeType: data.packet.routeType,
        routeTypeName: data.packet.routeTypeName,
        firstHeardAt: data.observation.heardAt,
        lastHeardAt: data.observation.heardAt,
        observationCount: data.packet.observationCount,
        scope: data.packet.scope,
        summary: data.packet.summary,
        latestObserver: {
          id: data.observation.observerId,
          displayName: data.observation.observerName,
          iata: data.observation.iata,
          pathLength: data.observation.pathLength,
          pathBytes: data.observation.pathBytes,
          // WS nulls these when the payload type carries no endpoint; the REST shape uses undefined
          resolvedSource: data.observation.resolvedSource ?? undefined,
          resolvedDestination: data.observation.resolvedDestination ?? undefined,
        },
      };

      store.pushOrUpdate(summary);
    },
    [store, iatas],
  );

  const handleChannelMessage = useCallback((data: ChannelMessage) => store.enrich(data), [store]);

  // Reset (drop to one fresh first page) instead of invalidate: an invalidate replays every cached
  // page sequentially — up to 20 requests per lag notice during a flood. The 2-element key matches
  // filtered variants by prefix, so those reset too.
  const handleLagged = useCallback(
    (data: WsLagged) => {
      setLaggedCount((prev) => prev + data.droppedCount);
      // while the API is throttling us the refetch would only 429; the next lag notice or remount heals it
      if (!isRateLimited()) queryClient.resetQueries({ queryKey: ["packets", regionKey] });
    },
    [queryClient, regionKey],
  );

  // The WS handler is down whenever this tab is unmounted, so cached history may hide a gap right
  // where the live buffer begins. Refresh the first page on mount to close it (prefix match:
  // filtered variants included).
  useEffect(() => {
    queryClient.resetQueries({ queryKey: ["packets", regionKey] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only; region changes refetch via the key
  }, []);

  const dismissLagged = useCallback(() => setLaggedCount(0), []);

  const {
    data: history,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    // The unfiltered key must stay 2-element so its cached entry survives filter toggling; the
    // lagged/mount resets above match both shapes by prefix.
    queryKey: serverFilter ? ["packets", regionKey, serverFilter] : ["packets", regionKey],
    // first load and every scroll page are the default 50; getPackets fills in the limit
    queryFn: ({ pageParam }) => getPackets(iatas, { cursor: pageParam, ...serverFilter }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialPageParam: undefined as number | undefined,
    staleTime: Infinity,
    enabled: !pending,
  });

  const allPackets = useMemo<PacketListItem[]>(
    () => dedup([...displayBuffer, ...flattenPages(history)]).map(packet => {
      const message = messagesByHash.get(packet.packetHash.toLowerCase());
      return message ? { ...packet, message } : packet;
    }),
    [displayBuffer, history, messagesByHash],
  );

  const observerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of allPackets) {
      if (p.latestObserver && !map.has(p.latestObserver.id)) {
        map.set(p.latestObserver.id, p.latestObserver.displayName ?? p.latestObserver.id.slice(0, 8));
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allPackets]);

  const newPacketCount = liveBuffer.length - acknowledgedCount;

  const acknowledgeNewPackets = useCallback(() => {
    store.acknowledge();
  }, [store]);

  return {
    allPackets,
    observerOptions,
    newPacketCount,
    acknowledgeNewPackets,
    fetchNextPage,
    hasNextPage: hasNextPage ?? false,
    isFetching,
    isFetchingNextPage,
    isLoading: isLoading || pending,
    isError,
    observersByHash,
    handlePacketObservation,
    handleChannelMessage,
    handleLagged,
    laggedCount,
    dismissLagged,
  };
}
