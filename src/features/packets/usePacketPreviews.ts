import { useEffect, useState } from "react";
import { useIsFetching, useQueries, useQueryClient } from "@tanstack/react-query";
import { getPacketDetail } from "../../api/client";
import { useRateLimit } from "../../hooks/useRateLimit";
import type { PacketDetail } from "../../types/api";
import { PayloadType } from "../../types/enums";
import type { PacketListItem } from "./types";
import { decodedMessage } from "./decoded-message";

type Message = NonNullable<PacketListItem["message"]>;

// Only viewport candidates are passed here. Share details with the analyzer instead of
// scanning channel history, and never start a page-wide burst of detail requests.
export function usePacketPreviews(packets: PacketListItem[]): ReadonlyMap<string, Message> {
  const client = useQueryClient();
  const fetching = useIsFetching({ queryKey: ["packet-detail"] });
  const limitedUntil = useRateLimit();
  const [backoffUntil, setBackoffUntil] = useState(limitedUntil ?? 0);
  const [now, setNow] = useState(Date.now);
  const candidates = packets.filter(packet => packet.payloadType === PayloadType.GROUP_TEXT && !packet.message?.content.trim());
  const states = candidates.map(packet => {
    const hash = packet.packetHash;
    const state = client.getQueryState<PacketDetail>(["packet-detail", hash]);
    const message = decodedMessage(state?.data, hash);
    const error = state?.error as { status?: number; retryAfterMs?: number } | null | undefined;
    const retryAt = state?.status === "error"
      ? state.errorUpdatedAt + Math.max(error?.status === 404 ? 300_000 : 30_000, error?.retryAfterMs ?? 0)
      : state?.data ? state.dataUpdatedAt + 60_000 : 0;
    const rateLimitUntil = state?.status === "error" && error?.status === 429
      ? state.errorUpdatedAt + (error.retryAfterMs ?? 10_000) : 0;
    return { hash, message, retryAt, rateLimitUntil, fetching: state?.fetchStatus === "fetching" };
  });
  // Include query errors: a concurrent success can clear the global flag before React renders.
  const pausedUntil = Math.max(backoffUntil, limitedUntil ?? 0, ...states.map(state => state.rateLimitUntil));
  if (pausedUntil > backoffUntil) setBackoffUntil(pausedUntil);
  const slots = pausedUntil > now ? 0 : Math.max(0, 2 - fetching);
  const eligible = new Set(states
    .filter(state => !state.message && state.retryAt <= now && !state.fetching)
    .slice(0, slots).map(state => state.hash));
  const nextWake = Math.min(pausedUntil > now ? pausedUntil : Infinity,
    ...states.filter(state => !state.message && state.retryAt > now).map(state => state.retryAt));
  const results = useQueries({
    queries: candidates.map(packet => {
      const hash = packet.packetHash;
      return {
        queryKey: ["packet-detail", hash],
        queryFn: ({ signal }: { signal: AbortSignal }) => getPacketDetail(hash, AbortSignal.any([signal, AbortSignal.timeout(10_000)])),
        enabled: eligible.has(hash),
        staleTime: 60_000,
        retry: false,
        // Errors and negative-cache timestamps drive scheduling even when data stays undefined.
        notifyOnChangeProps: "all" as const,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      };
    }),
  });

  useEffect(() => {
    if (!Number.isFinite(nextWake)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, nextWake - Date.now()));
    return () => clearTimeout(timer);
  }, [nextWake]);

  const messages = new Map<string, Message>();
  results.forEach((result, index) => {
    const hash = candidates[index]!.packetHash;
    const message = decodedMessage(result.data, hash);
    if (message) messages.set(hash, message);
  });
  return messages;
}
