import { useEffect, useState } from "react";
import { useIsFetching, useQueries, useQueryClient } from "@tanstack/react-query";
import { getPacketDetail } from "../../api/client";
import { useRateLimit } from "../../hooks/useRateLimit";
import type { PacketDetail } from "../../types/api";

/** The packet-preview request policy, applied to complete details for visible/inspected history. */
export function useMeshlogPacketDetails(hashes: string[], onDetail: (detail: PacketDetail) => void) {
  const client = useQueryClient();
  const fetching = useIsFetching({ queryKey: ["packet-detail"] });
  const limitedUntil = useRateLimit();
  const [backoffUntil, setBackoffUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const states = hashes.map(hash => {
    const state = client.getQueryState<PacketDetail>(["packet-detail", hash]);
    const error = state?.error as { status?: number; retryAfterMs?: number } | null;
    return {
      hash, fetching: state?.fetchStatus === "fetching",
      retryAt: state?.errorUpdatedAt ? state.errorUpdatedAt + (error?.status === 404 ? 60_000 : 10_000) : 0,
      rateLimitUntil: error?.status === 429 ? (state?.errorUpdatedAt ?? 0) + (error.retryAfterMs ?? 10_000) : 0,
    };
  });
  const pausedUntil = Math.max(backoffUntil, limitedUntil ?? 0, ...states.map(state => state.rateLimitUntil));
  if (pausedUntil > backoffUntil) setBackoffUntil(pausedUntil);
  const slots = pausedUntil > now ? 0 : Math.max(0, 2 - fetching);
  const eligible = new Set(states.filter(state => !state.fetching && state.retryAt <= now).slice(0, slots).map(state => state.hash));
  const nextWake = Math.min(pausedUntil > now ? pausedUntil : Infinity, ...states.filter(state => state.retryAt > now).map(state => state.retryAt));
  const results = useQueries({ queries: hashes.map(hash => ({
    queryKey: ["packet-detail", hash],
    queryFn: ({ signal }: { signal: AbortSignal }) => getPacketDetail(hash, AbortSignal.any([signal, AbortSignal.timeout(10_000)])),
    enabled: eligible.has(hash), staleTime: 60_000, gcTime: Infinity, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  })) });
  useEffect(() => {
    for (const result of results) if (result.data) onDetail(result.data);
  }, [results, onDetail]);
  useEffect(() => {
    if (!Number.isFinite(nextWake)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, nextWake - Date.now()));
    return () => clearTimeout(timer);
  }, [nextWake]);
  return new Set(hashes.filter((_, index) => results[index]?.isFetching));
}
