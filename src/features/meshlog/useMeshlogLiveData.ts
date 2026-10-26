import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useInfiniteQuery, useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getChannels, getNodesPage, getObserversPage, getPackets, getScopes } from "../../api/client";
import { WsManager } from "../../api/ws-manager";
import { WS_URL } from "../../lib/constants";
import { useInfinitePages } from "../../hooks/useInfinitePages";
import { useRegion } from "../../hooks/useRegion";
import { useWsStatus } from "../../hooks/useWsStatus";
import type { NodeSummary } from "../nodes/types";
import type { ObserverSummary } from "../observers/types";
import type { ChannelSummary } from "../channels/types";
import { MeshlogLiveStore } from "./live-store";
import { createMeshlogDataBuilder, meshlogContact, meshlogTime } from "./live-data";
import type { MeshlogLiveState } from "./types";
import type { PacketDetail } from "../../types/api";
import { useMeshlogPacketDetails } from "./useMeshlogPacketDetails";
import { useMeshlogObserverDetails } from "./useMeshlogObserverDetails";
import { shortNodeKey } from "./short-node-key";
import { useMeshlogNodeDetails } from "./useMeshlogNodeDetails";

const nodeId = (node: NodeSummary) => node.id;
const observerId = (observer: ObserverSummary) => observer.id;
const channelId = (channel: ChannelSummary) => channel.channelHash;
const EVENTS = ["packetObservation", "channelMessage", "nodeUpdate", "observerStatus"];

export function useMeshlogLiveData() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { iatas, regionKey, isResolved } = useRegion();
  const iataKey = iatas?.join(",");
  const subscriptionIatas = useMemo(() => iataKey === undefined ? undefined : iataKey ? iataKey.split(",") : [], [iataKey]);
  const pending = isResolved === false;
  const regionRequests = useIsFetching({ queryKey: ["regions"] });
  const regionError = pending && regionRequests === 0 && queryClient.getQueryState(["regions"])?.status === "error";
  const session = useMemo(() => ({ key: regionKey, manager: new WsManager(WS_URL), store: new MeshlogLiveStore(), buildData: createMeshlogDataBuilder() }), [regionKey]);
  const refreshingStore = useRef<MeshlogLiveStore | null>(null);
  const snapshot = useSyncExternalStore(session.store.subscribe, session.store.getSnapshot);
  const { status } = useWsStatus(session.manager);
  const history = useInfiniteQuery({
    queryKey: ["meshlog-history", regionKey],
    queryFn: ({ pageParam }) => getPackets(iatas, { cursor: pageParam, limit: pageParam === undefined ? 30 : 50 }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: page => page.hasMore && page.nextCursor !== null ? page.nextCursor : undefined,
    enabled: !pending, staleTime: Infinity,
  });
  const summaries = useMemo(() => history.data?.pages.flatMap(page => page.items) ?? [], [history.data]);
  useEffect(() => { session.store.mergeHistory(summaries); }, [session, summaries]);
  const [visibleHashes, setVisibleHashes] = useState<string[]>([]);
  const [inspectedHashes, setInspectedHashes] = useState<string[]>([]);
  const onVisiblePacketsChange = useCallback((hashes: string[]) => setVisibleHashes(previous => previous.join(",") === hashes.join(",") ? previous : hashes), []);
  const onInspectPacket = useCallback((hash: string) => setInspectedHashes(previous => previous[0] === hash ? previous : [hash, ...previous.filter(item => item !== hash)]), []);
  const candidateHashes = [...new Set([...inspectedHashes, ...visibleHashes])].filter(hash => snapshot.packets.some(packet => packet.hash === hash && !packet.detail));
  const onDetail = useCallback((detail: PacketDetail) => session.store.hydrate(detail), [session]);
  const loadingDetails = useMeshlogPacketDetails(candidateHashes, onDetail);
  const nodes = useInfinitePages({ queryKey: ["meshlog-nodes", regionKey], queryFn: cursor => getNodesPage(iatas, { cursor }), getId: nodeId, enabled: !pending });
  const observers = useInfinitePages({ queryKey: ["meshlog-observers", regionKey], queryFn: cursor => getObserversPage(iatas, { cursor }), getId: observerId, enabled: !pending });
  const channels = useInfinitePages<ChannelSummary, number | string>({
    queryKey: ["meshlog-channels", regionKey],
    queryFn: async cursor => {
      const page = await getChannels({ iatas, cursor });
      return { ...page, nextCursor: page.nextPageCursor ?? page.nextCursor };
    }, getId: channelId, enabled: !pending,
  });
  const scopes = useQuery({
    queryKey: ["scopes", regionKey], queryFn: () => getScopes(iatas), enabled: !pending, staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (pending || subscriptionIatas?.length === 0) return;
    const accepts = (iata: string) => subscriptionIatas === undefined || subscriptionIatas.includes(iata);
    const { manager, store } = session;
    const unsubscribe = [
      manager.onPacketObservation(event => { if (accepts(event.observation.iata)) store.observe(event); }),
      manager.onChannelMessage(message => store.enrich(message)),
      manager.onNodeUpdate(node => { if (accepts(node.iata)) store.updateNode(node); }),
      manager.onObserverStatus(observer => { if (accepts(observer.iata)) store.updateObserver(observer); }),
      manager.onLagged(() => store.noteGap()),
    ];
    manager.setResolvePath(true);
    manager.connect({ iatas: subscriptionIatas, events: EVENTS });
    return () => {
      unsubscribe.forEach(remove => remove());
      manager.disconnect();
      store.dispose();
    };
  }, [session, pending, subscriptionIatas]);

  const onRetry = useCallback(() => {
    void queryClient.resetQueries({ predicate: query => ["regions", "meshlog-nodes", "meshlog-observers", "meshlog-channels", "scopes", "observer"].includes(String(query.queryKey[0])) });
  }, [queryClient]);
  const unknown = t("packetTable.unknown");
  const baseData = useMemo(() => session.buildData(snapshot, { nodes: nodes.items, observers: observers.items, channels: channels.items, iatas }, unknown),
    [session, snapshot, nodes.items, observers.items, channels.items, iatas, unknown]);
  const observerDetails = useMeshlogObserverDetails(baseData.reporters);
  const [inspectedNodes, setInspectedNodes] = useState<{ key: string; ids: string[] }>({ key: session.key, ids: [] });
  const inspectedNodeIds = inspectedNodes.key === session.key ? inspectedNodes.ids : [];
  const nodeDetails = useMeshlogNodeDetails(inspectedNodeIds);
  const onInspectContact = useCallback((id: string) => {
    const state = queryClient.getQueryState(["node", id]);
    if (state?.data && Date.now() - state.dataUpdatedAt > 30_000) {
      void queryClient.invalidateQueries({ queryKey: ["node", id], exact: true, refetchType: "none" });
    }
    setInspectedNodes(previous => ({ key: session.key, ids: [id, ...(previous.key === session.key ? previous.ids.filter(item => item !== id) : [])] }));
  }, [queryClient, session.key]);
  const onRetryContact = useCallback((id: string) => {
    void queryClient.resetQueries({ queryKey: ["node", id], exact: true });
    onInspectContact(id);
  }, [queryClient, onInspectContact]);
  const reporters = baseData.reporters.map(reporter => {
    const detail = observerDetails.details.get(reporter.id);
    const publicKey = reporter.publicKey || detail?.publicKey;
    return { ...reporter, publicKey, code: shortNodeKey(publicKey, reporter.hashSize),
      name: reporter.name === unknown ? detail?.displayName || reporter.name : reporter.name,
      iata: reporter.iata || detail?.iata, observerType: reporter.observerType || detail?.observerType,
      status: reporter.status ?? detail?.status,
    };
  });
  const reporterMap = new Map(reporters.map(reporter => [reporter.id, reporter]));
  const contacts = baseData.contacts.map(contact => {
    const detail = nodeDetails.details.get(contact.id);
    const update = snapshot.nodes.get(contact.id);
    const liveIsNewer = update && update.iatas.some(area => area.lastHeard > (detail?.lastSeen ?? Infinity));
    // Fresh detail is authoritative, except for genuinely newer live summary fields.
    // Neighbor counts are not sent by nodeUpdate and must not regress to the old directory count.
    const currentDetail = detail && liveIsNewer ? { ...detail, ...contact.node,
      knownNeighborCount: detail.knownNeighborCount, lastSeen: Math.max(detail.lastSeen, contact.heardAt ?? detail.lastSeen),
    } : detail;
    const firstSeenAt = detail && Number.isFinite(detail.firstSeen) ? detail.firstSeen : undefined;
    return { ...contact, ...(currentDetail ? meshlogContact(currentDetail, contact.hashSize, unknown) : {}), firstSeenAt, firstSeen: meshlogTime(firstSeenAt),
      detail: currentDetail,
      detailLoading: nodeDetails.loading.has(contact.id), detailError: nodeDetails.errors.has(contact.id),
    };
  });
  const data = { ...baseData, contacts, scopes: scopes.data ?? [], reporters, messages: baseData.messages.map(message => ({
    ...message, detailLoading: loadingDetails.has(message.id), reports: message.reports.map(report => ({
      ...report, observerCode: shortNodeKey(reporterMap.get(report.reporterId)?.publicKey, report.hashSize ?? reporterMap.get(report.reporterId)?.hashSize),
    })),
  })) };
  const state: MeshlogLiveState = {
    status: pending ? "resolving" : status,
    lastEventTimestamp: session.manager.getLastEventTimestamp(),
    loading: (pending && !regionError) || nodes.isPaging || observers.isPaging || channels.isPaging || scopes.isLoading || observerDetails.loading,
    error: regionError || nodes.isError || observers.isError || channels.isError || scopes.isError || observerDetails.error,
    gap: snapshot.gap, emptyRegion: iatas?.length === 0,
    regionLabel: pending ? t("map.packetLog.loadingRegion") : iatas === undefined ? t("region.allRegions") : iatas.join(", ") || t("common.noData"),
    onRetry,
    historyLoading: history.isLoading && !pending,
    historyRefreshing: history.isFetching,
    historyError: history.isError || history.isFetchNextPageError,
    hasOlder: history.hasNextPage === true,
    loadingOlder: history.isFetchingNextPage,
    loadOlder: () => { if (history.hasNextPage && !history.isFetching) void history.fetchNextPage({ cancelRefetch: false }); },
    retryHistory: () => {
      if (!history.isFetching) void (history.isFetchNextPageError ? history.fetchNextPage({ cancelRefetch: false }) : history.refetch({ cancelRefetch: false }));
    },
    refreshHistory: () => {
      const store = session.store;
      if (pending || history.isFetching || refreshingStore.current === store) return;
      refreshingStore.current = store;
      const revision = store.getGapRevision();
      void history.refetch({ cancelRefetch: false }).then(result => {
        if (result.isSuccess) store.acknowledgeGap(revision);
      }).finally(() => { if (refreshingStore.current === store) refreshingStore.current = null; });
    },
  };
  return { data, state, liveBatch: snapshot.liveBatch, sessionKey: session.key, onVisiblePacketsChange, onInspectPacket, onInspectContact, onRetryContact };
}
