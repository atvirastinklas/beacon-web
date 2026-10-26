import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MeshlogData, MeshlogLiveState, ContactKind, MeshlogLiveBatch, MeshlogMessage } from "./types";
import { contactKindKeys } from "./labels";
import { MeshlogMap } from "./MeshlogMap";
import { ContactRow, MessageRow } from "./Rows";
import { ContactSettings } from "./ContactSettings";
import { DEFAULT_CONTACT_SETTINGS, meshlogContactState } from "./contact-settings";
import { useTick } from "../../hooks/useTick";
import { SettingsPopover } from "./SettingsPopover";
import { Workspace } from "./Workspace";
import { ChannelSelector } from "./ChannelSelector";
import { PacketFilterSelector } from "./PacketFilterSelector";
import { PacketHeader } from "./PacketHeader";
import { packetTypeOptions } from "./packet-type";
import { PacketTypeBadge } from "./PacketTypeBadge";
import { TooltipProvider } from "../../components/ui/tooltip";
import { MeshlogVirtualList } from "./MeshlogVirtualList";
import "./meshlog.css";

const contactKinds: ContactKind[] = ["repeater", "client", "room", "sensor", "unknown"];
const sortLabels = { lastHeard: "routes.columns.lastSeen", hash: "packetTable.hash", name: "nodes.colName", firstSeen: "routes.columns.firstSeen" };
type SortKey = keyof typeof sortLabels;

export function MeshlogPage({ data, liveState, onVisiblePacketsChange, onInspectPacket, liveBatch, onInspectContact, onRetryContact }: {
  data: MeshlogData; liveState: MeshlogLiveState;
  onVisiblePacketsChange: (hashes: string[]) => void; onInspectPacket: (hash: string) => void;
  liveBatch?: MeshlogLiveBatch; onInspectContact?: (id: string) => void; onRetryContact?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const now = useTick(60_000);
  const { contacts, messages, reporters, channels } = data;
  const reporterMap = new Map(reporters.map(reporter => [reporter.id, reporter]));
  const [packetPane, setPacketPane] = useState<HTMLElement | null>(null);
  const [contactPane, setContactPane] = useState<HTMLElement | null>(null);
  const [expandedPackets, setExpandedPackets] = useState<string[]>([]);
  const [expandedContacts, setExpandedContacts] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [nodeTypeSelection, setNodeTypes] = useState<ContactKind[] | null>(null);
  const types = nodeTypeSelection ?? contactKinds;
  const [payloadTypeSelection, setPayloadTypes] = useState<string[] | null>(null);
  // null is the default-all policy; explicit selections are snapshots, so new
  // directory entries join all, but never silently join a subset or none.
  const [channelSelection, setEnabledChannels] = useState<string[] | null>(null);
  const [scopeSelection, setScopeSelection] = useState<string[] | null>(null);
  const [sourceSelection, setSources] = useState<string[] | null>(null);
  const enabledChannels = channelSelection ?? channels.map(channel => channel.id);
  const sources = sourceSelection ?? reporters.map(reporter => reporter.id);
  const scopeNames = [...new Set([...(data.scopes ?? []), ...messages.flatMap(message => message.scope ? [message.scope] : [])])].filter(scope => scope !== "").sort();
  const [pinnedPathKeys, setPinnedPathKeys] = useState<string[]>([]);
  const [hoveredPath, setHoveredPath] = useState<{ messageId: string; reporterId?: string } | null>(null);
  const [settings, setSettings] = useState(DEFAULT_CONTACT_SETTINGS);
  const [sort, setSort] = useState<{ key: SortKey; direction: number }>({ key: "lastHeard", direction: -1 });
  const search = query.trim().toLowerCase();
  const matchingContacts = contacts.filter(contact => (!contact.reporterIds || contact.reporterIds.some(id => sourceSelection === null || sources.includes(id))) && types.includes(contact.kind) && (!search || contact.name.toLowerCase().includes(search) || contact.publicKey?.toLowerCase().startsWith(search))).sort((a, b) => {
    if (sort.key === "firstSeen" || sort.key === "lastHeard") {
      const av = sort.key === "firstSeen" ? a.firstSeenAt : a.heardAt;
      const bv = sort.key === "firstSeen" ? b.firstSeenAt : b.heardAt;
      if (av === undefined || bv === undefined) return av === bv ? a.id.localeCompare(b.id) : av === undefined ? 1 : -1;
      return (av - bv) * sort.direction || a.id.localeCompare(b.id);
    }
    if (sort.key === "hash" && (!a.publicKey || !b.publicKey)) return !a.publicKey === !b.publicKey ? a.name.localeCompare(b.name) : !a.publicKey ? 1 : -1;
    const comparison = sort.key === "name" ? a.name.localeCompare(b.name) : a.publicKey!.localeCompare(b.publicKey!);
    return comparison * sort.direction;
  });
  const contactStates = new Map(matchingContacts.map(contact => [contact.id, meshlogContactState(contact, settings, now)]));
  const visibleContacts = matchingContacts.filter(contact => !contactStates.get(contact.id)!.hidden);
  // Age hiding is a directory display preference, never a packet/flow filter.
  const matchingContactIds = new Set(matchingContacts.map(contact => contact.id));
  const contactIds = new Set(contacts.map(contact => contact.id));
  const matchesChannel = (message: MeshlogMessage) => channelSelection === null || message.kind !== "channel" || (message.channelId !== undefined && enabledChannels.includes(message.channelId));
  const canInspectUnknownChannel = (message: MeshlogMessage) => channelSelection !== null && channelSelection.length > 0 && message.kind === "channel" && message.channelId === undefined;
  const visibleMessages = messages.filter(message => (message.senderId && contactIds.has(message.senderId)
    ? matchingContactIds.has(message.senderId)
    : types.includes("unknown") && (!search || message.senderName.toLowerCase().includes(search)))
    && (payloadTypeSelection === null || payloadTypeSelection.includes(String(message.payloadType)))
    && (matchesChannel(message) || canInspectUnknownChannel(message))
    && (scopeSelection === null || scopeSelection.includes(message.scope ?? "")))
    .map(message => ({ ...message, reports: message.reports.filter(report => sourceSelection === null || sources.includes(report.reporterId)) })).filter(message => sourceSelection === null || message.reports.length > 0);
  // Visible unresolved history can be hydrated, but must not claim a selected-channel match.
  const confirmedMessages = visibleMessages.filter(matchesChannel);
  const confirmedMessageIds = new Set(confirmedMessages.map(message => message.id));
  const visibleReportKeys = new Set(confirmedMessages.flatMap(message => message.reports.map(report => `${message.id}:${report.reporterId}`)));
  const flowReportKeys = new Set(confirmedMessages.flatMap(message => message.reports.map(report => `${message.id.toLowerCase()}:${report.reporterId}`)));
  const flowResetKey = JSON.stringify([query, types, payloadTypeSelection, channelSelection, scopeSelection, sourceSelection]);
  const visiblePaths = data.paths.filter(path => visibleReportKeys.has(path.key));
  const mappablePathKeys = new Set(visiblePaths.map(path => path.key));
  if (hoveredPath !== null && !confirmedMessages.some(message => message.id === hoveredPath.messageId &&
    (!hoveredPath.reporterId || message.reports.some(report => report.reporterId === hoveredPath.reporterId)))) setHoveredPath(null);
  const sourceFiltered = sourceSelection !== null;
  const contactFiltered = search !== "" || types.length !== contactKinds.length;
  const messageFiltered = payloadTypeSelection !== null || channelSelection !== null || scopeSelection !== null;
  const hoveredPathKeys = new Set(confirmedMessages.filter(message => message.id === hoveredPath?.messageId)
    .flatMap(message => message.reports.filter(report => !hoveredPath?.reporterId || report.reporterId === hoveredPath.reporterId)
      .map(report => `${message.id}:${report.reporterId}`)));
  const paths = visiblePaths.filter(path => pinnedPathKeys.includes(path.key) || hoveredPathKeys.has(path.key));
  const pinnedPaths = visiblePaths.filter(path => pinnedPathKeys.includes(path.key));
  const changePinnedPaths = (keys: string[], checked: boolean) => setPinnedPathKeys(previous => checked
    ? [...new Set([...previous, ...keys])] : previous.filter(key => !keys.includes(key)));
  const changePathPreview = (messageId: string, reporterId: string | undefined, preview: boolean) => setHoveredPath(previous => preview
    ? { messageId, reporterId } : previous?.messageId === messageId && previous.reporterId === reporterId ? null : previous);
  return <TooltipProvider delay={200}><Workspace header={<PacketHeader liveState={liveState} />}>
    <section ref={setPacketPane} className="meshlog-sidebar" id="meshlog-messages" aria-label={t("tabs.Packets")}>
      <div className="meshlog-controls meshlog-packet-filters">
        <PacketFilterSelector label={t("filters.observers")} searchLabel={t("meshlog.filters.searchObservers")}
          options={[...reporters].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(reporter => ({ id: reporter.id, name: reporter.name,
            searchText: [reporter.publicKey, reporter.code, reporter.iata].filter(Boolean).join(" "),
            detail: [reporter.publicKey ?? reporter.code, reporter.iata].filter(Boolean).join(" "),
          }))} selection={sourceSelection} onSelectionChange={setSources} />
        <PacketFilterSelector label={t("map.packetLog.types")} searchLabel={t("meshlog.filters.searchTypes")}
          options={packetTypeOptions(messages, t)} selection={payloadTypeSelection} onSelectionChange={setPayloadTypes}
          renderLabel={option => <PacketTypeBadge payloadType={Number(option.id)} label={option.name} />} />
        <ChannelSelector channels={channels} selection={channelSelection} onSelectionChange={setEnabledChannels} />
        <PacketFilterSelector label={t("nodeFilters.scope")} searchLabel={t("scopes.search")}
          options={[...scopeNames.map(scope => ({ id: scope, name: scope })), { id: "", name: t("packetAnalyzer.noKnownScope") }]}
          selection={scopeSelection} onSelectionChange={setScopeSelection} />
      </div>
      {messageFiltered && <div className="meshlog-filter-warning"><span>{t("filters.packetFilters")}</span><button type="button" aria-label={`${t("common.clear")} · ${t("filters.packetFilters")}`} onClick={() => { setPayloadTypes(null); setEnabledChannels(null); setScopeSelection(null); }}>{t("common.clear")}</button></div>}
      {sourceFiltered && <div className="meshlog-filter-warning"><span>{t("observerFilters.label")}</span><button type="button" aria-label={`${t("common.clear")} · ${t("observerFilters.label")}`} onClick={() => setSources(null)}>{t("common.clear")}</button></div>}
      {contactFiltered && <div className="meshlog-filter-note">{t("nodeFilters.label")}</div>}
      <div className="meshlog-list" aria-busy={liveState.historyLoading}><MeshlogVirtualList items={visibleMessages} scrollElement={packetPane} estimateSize={30} onVisibleKeysChange={onVisiblePacketsChange} renderItem={message => {
        const confirmed = confirmedMessageIds.has(message.id);
        const mappableReportIds = message.reports.filter(report => mappablePathKeys.has(`${message.id}:${report.reporterId}`)).map(report => report.reporterId);
        const pinnedReportIds = mappableReportIds.filter(id => pinnedPathKeys.includes(`${message.id}:${id}`));
        return <MessageRow key={message.id} message={message} reporters={reporterMap} onInspect={() => onInspectPacket(message.id)} channelUnverified={!confirmed}
          open={expandedPackets.includes(message.id)} onOpenChange={open => setExpandedPackets(previous => open ? [...previous, message.id] : previous.filter(id => id !== message.id))}
          showPath={mappableReportIds.length > 0 && pinnedReportIds.length === mappableReportIds.length} canShowPath={mappableReportIds.length > 0}
          pathPartiallyShown={pinnedReportIds.length > 0 && pinnedReportIds.length < mappableReportIds.length}
          pinnedReportIds={pinnedReportIds} mappableReportIds={mappableReportIds}
          onShowPathChange={checked => changePinnedPaths(mappableReportIds.map(id => `${message.id}:${id}`), checked)}
          onPathPreviewChange={preview => { if (confirmed) changePathPreview(message.id, undefined, preview); }}
          onReportShowPathChange={(id, checked) => changePinnedPaths([`${message.id}:${id}`], checked)}
          onReportPathPreviewChange={(id, preview) => { if (confirmed) changePathPreview(message.id, id, preview); }}
        />;
      }} />{visibleMessages.length === 0 && !liveState.historyLoading && !liveState.historyError && <p className="meshlog-empty">{messages.length === 0 ? liveState.emptyRegion ? t("common.noData") : liveState.status === "connected" ? <>{t("map.packetLog.waiting")}<br />{t("map.packetLog.waitingHint")}</> : t("map.packetLog.waitingConnection") : t("common.noMatches")}</p>}</div>
      <div className="meshlog-history-controls">
        {liveState.historyLoading && <p role="status">{t("packetList.loadingPackets")}</p>}
        {liveState.historyError && <p role="alert">{t("tabs.Packets")} · {t("common.loadFailed")} <button type="button" disabled={liveState.historyRefreshing} onClick={liveState.retryHistory} aria-label={`${t("packetList.retry")} · ${t("tabs.Packets")}`}>{t("packetList.retry")}</button></p>}
        {liveState.hasOlder && !liveState.historyLoading && <button type="button" disabled={liveState.loadingOlder || liveState.historyRefreshing} onClick={liveState.loadOlder} aria-busy={liveState.loadingOlder}>{t("packetList.loadOlder")}</button>}
        {liveState.loadingOlder && <p role="status">{t("packetList.loadingPackets")}</p>}
      </div>
    </section>
    <section className="meshlog-map" id="meshlog-map-panel" aria-label={t("tabs.Map")}><MeshlogMap contacts={visibleContacts} framingContacts={contacts} paths={paths} pinnedPaths={pinnedPaths} onClearPaths={() => { setPinnedPathKeys([]); setHoveredPath(null); }} regionLabel={liveState.regionLabel} liveBatch={liveBatch} visibleReportKeys={flowReportKeys} flowResetKey={flowResetKey} /></section>
    <section ref={setContactPane} className="meshlog-sidebar" id="meshlog-contacts" aria-label={t("tabs.Nodes")}>
      <div className="meshlog-controls"><div className="meshlog-section-header"><h2>{t("tabs.Nodes")}</h2><SettingsPopover title={t("tabs.Nodes")}>
        <ContactSettings value={settings} onChange={setSettings} />
      </SettingsPopover></div></div>
      <div className="meshlog-controls">
        <div className="meshlog-sort">{(Object.keys(sortLabels) as SortKey[]).map(key => <button type="button" key={key} aria-pressed={sort.key === key} onClick={() => setSort(previous => ({ key, direction: previous.key === key ? -previous.direction : key === "lastHeard" ? -1 : 1 }))}>{t(sortLabels[key])}<span className="meshlog-sort-arrow" aria-hidden="true">{sort.key === key ? sort.direction === 1 ? " ↑" : " ↓" : ""}</span></button>)}</div>
        <div className="meshlog-packet-filters"><PacketFilterSelector label={t("map.nodeTypeLabel")} searchLabel={t("meshlog.filters.searchTypes")}
          options={contactKinds.filter(kind => kind !== "unknown" || contacts.some(contact => contact.kind === kind)).map(kind => ({ id: kind, name: t(contactKindKeys[kind]) }))}
          selection={nodeTypeSelection} onSelectionChange={setNodeTypes} /></div>
        <label className="meshlog-search" htmlFor="meshlog-search">{t("routes.search")}<input id="meshlog-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("search.placeholder", { field: `${t("nodes.colName")} / ${t("packetTable.hash")}` })} /></label>
      </div>
      <div className="meshlog-info-strip">{liveState.regionLabel || t("connection.live")}</div>
      {contactFiltered && <div className="meshlog-filter-warning"><span>{t("nodeFilters.label")}</span><button type="button" aria-label={`${t("common.clear")} · ${t("nodeFilters.label")}`} onClick={() => { setQuery(""); setNodeTypes(null); }}>{t("common.clear")}</button></div>}
      {sourceFiltered && <div className="meshlog-filter-note">{t("observerFilters.label")}</div>}
      <div className="meshlog-list"><MeshlogVirtualList items={visibleContacts} scrollElement={contactPane} estimateSize={56} renderItem={contact => <ContactRow key={contact.id} contact={contact} display={settings} state={contactStates.get(contact.id)}
        open={expandedContacts.includes(contact.id)} onOpenChange={open => setExpandedContacts(previous => open ? [...previous, contact.id] : previous.filter(id => id !== contact.id))}
        onInspect={onInspectContact ? () => onInspectContact(contact.id) : undefined} onRetry={onRetryContact ? () => onRetryContact(contact.id) : undefined} />} />{visibleContacts.length === 0 && <p className="meshlog-empty">{t("common.noMatches")}</p>}</div>
      <p className="meshlog-result-count" role="status">{t("tabs.Nodes")}: {visibleContacts.length} · {t("tabs.Packets")}: {visibleMessages.length}</p>
    </section>
  </Workspace></TooltipProvider>;
}
