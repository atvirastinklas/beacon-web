import { useIsFetching, useQueries, useQueryClient } from "@tanstack/react-query";
import { getObserver } from "../../api/client";
import type { Observer } from "../observers/types";
import type { MeshlogReporter } from "./types";

/** Resolve missing radio keys without a directory-wide parallel request burst. */
export function useMeshlogObserverDetails(reporters: MeshlogReporter[]) {
  const client = useQueryClient();
  const fetching = useIsFetching({ queryKey: ["observer"] });
  const candidates = reporters.filter(reporter => !reporter.publicKey);
  const eligible = new Set(candidates.filter(reporter => {
    const state = client.getQueryState<Observer>(["observer", reporter.id]);
    return !state?.data && state?.status !== "error" && state?.fetchStatus !== "fetching";
  }).slice(0, Math.max(0, 2 - fetching)).map(reporter => reporter.id));
  const results = useQueries({ queries: candidates.map(reporter => ({
    queryKey: ["observer", reporter.id], queryFn: () => getObserver(reporter.id),
    enabled: eligible.has(reporter.id), staleTime: Infinity, gcTime: Infinity, retry: false,
  })) });
  return {
    details: new Map(results.flatMap((result, index) => result.data ? [[candidates[index]!.id, result.data] as const] : [])),
    loading: results.some(result => !result.data && !result.isError),
    error: results.some(result => result.isError),
  };
}
