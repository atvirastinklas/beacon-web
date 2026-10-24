import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { RegionProvider } from "../../hooks/useRegion";
import { computeInitialSelection } from "../../lib/initial-region-selection";
import { MeshlogPage } from "./MeshlogPage";
import { useMeshlogLiveData } from "./useMeshlogLiveData";

function LiveSession() {
  const { data, state, liveBatch, sessionKey, onVisiblePacketsChange, onInspectPacket, onInspectContact, onRetryContact } = useMeshlogLiveData();
  return <MeshlogPage key={sessionKey} data={data} liveState={state} liveBatch={liveBatch} onVisiblePacketsChange={onVisiblePacketsChange} onInspectPacket={onInspectPacket} onInspectContact={onInspectContact} onRetryContact={onRetryContact} />;
}

export function MeshlogRoute() {
  const [params] = useSearchParams();
  const [selection] = useState(() => computeInitialSelection(params));
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: {
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, gcTime: 0,
  } } }));
  return <QueryClientProvider client={client}><RegionProvider defaultSelection={selection}>
    <LiveSession />
  </RegionProvider></QueryClientProvider>;
}
