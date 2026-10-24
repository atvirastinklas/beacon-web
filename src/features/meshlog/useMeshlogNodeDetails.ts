import { useIsFetching, useQueries, useQueryClient } from "@tanstack/react-query";
import { getNode } from "../../api/client";
import type { Node } from "../nodes/types";

/** Fetch only explicitly inspected contacts, with two concurrent requests and no polling. */
export function useMeshlogNodeDetails(ids: string[]) {
  const client = useQueryClient();
  const fetching = useIsFetching({ queryKey: ["node"] });
  const eligible = new Set(ids.filter(id => {
    const state = client.getQueryState<Node>(["node", id]);
    return (!state?.data || state.isInvalidated) && state?.status !== "error" && state?.fetchStatus !== "fetching";
  }).slice(0, Math.max(0, 2 - fetching)));
  const results = useQueries({ queries: ids.map(id => ({
    queryKey: ["node", id], queryFn: () => getNode(id), enabled: eligible.has(id),
    staleTime: 30_000, gcTime: Infinity, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  })) });
  return {
    details: new Map(results.flatMap((result, index) => result.data?.id === ids[index] ? [[ids[index]!, result.data] as const] : [])),
    loading: new Set(ids.filter((_, index) => !results[index]?.data && !results[index]?.isError)),
    errors: new Set(ids.filter((_, index) => results[index]?.isError || (results[index]?.data && results[index]?.data?.id !== ids[index]))),
  };
}
