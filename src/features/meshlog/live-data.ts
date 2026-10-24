import type { NodeSummary } from "../nodes/types";
import type { ObserverSummary } from "../observers/types";
import type { ChannelSummary } from "../channels/types";
import { PayloadType } from "../../types/enums";
import { hasMapLocation } from "../map/location";
import { buildPacketPaths, PATH_COLORS } from "../map/packet-path";
import type { LiveMeshlogPacket, LiveMeshlogSnapshot } from "./live-store";
import type { ContactKind, MeshlogContact, MeshlogData, MeshlogMessage, MeshlogReporter } from "./types";
import type { Observation } from "../../types/api";
import type { WsPacketObservation } from "../../types/ws";
import { decodedMessage } from "../packets/decoded-message";
import { shortNodeKey } from "./short-node-key";
import { radioHashSize, reportPathCodes } from "./path-codes";
import { meshlogPacketEndpoints } from "./packet-endpoints";

export const meshlogTime = (time?: number) => typeof time === "number" && Number.isFinite(time) ? new Date(time).toISOString().slice(11, 19) : "—";

function contactKind(name: string): ContactKind {
  switch (name.toLowerCase()) {
    case "repeater": return "repeater";
    case "companion": case "client": return "client";
    case "room_server": case "room": return "room";
    case "sensor": return "sensor";
    default: return "unknown";
  }
}

export function meshlogContact(node: NodeSummary, hashSize?: 1 | 2 | 3, unknownName = "—"): MeshlogContact {
  const heardAt = node.iatas.length ? Math.max(...node.iatas.map(area => area.lastHeard)) : undefined;
  return {
    id: node.id, node, publicKey: node.publicKey, hashSize,
    name: node.name || shortNodeKey(node.publicKey, hashSize) || unknownName, kind: contactKind(node.nodeTypeName),
    heard: meshlogTime(heardAt), heardAt, firstSeen: "—",
    position: hasMapLocation(node) ? [node.lng!, node.lat!] : null,
  };
}

function observerColor(id: string) {
  let hash = 5381;
  for (const character of id) hash = ((hash << 5) + hash + character.charCodeAt(0)) >>> 0;
  return PATH_COLORS[hash % PATH_COLORS.length]!;
}

function packetObservations(packet: LiveMeshlogPacket, iatas?: string[]) {
  const accepted = (iata: string) => iatas === undefined || iatas.includes(iata);
  const observations: (Observation | WsPacketObservation["data"]["observation"])[] = (packet.detail?.observations ?? []).filter(report => accepted(report.iata));
  for (const report of packet.reports.values()) {
    if (!accepted(report.iata)) continue;
    const index = observations.findIndex(item => item.observerId === report.observerId && item.heardAt === report.heardAt);
    if (index < 0) observations.push(report);
    else {
      const prior = observations[index]!;
      observations[index] = { ...report,
        resolvedPath: report.resolvedPath ?? prior.resolvedPath,
        resolvedSource: report.resolvedSource ?? prior.resolvedSource,
        resolvedDestination: report.resolvedDestination ?? prior.resolvedDestination,
      };
    }
  }
  return observations.sort((a, b) => a.heardAt - b.heardAt);
}

interface MeshlogMetadata {
  nodes: NodeSummary[]; observers: ObserverSummary[]; channels: ChannelSummary[]; iatas?: string[];
}

interface PacketDerivation {
  region: string | undefined;
  unknownName: string;
  observations: ReturnType<typeof packetObservations>;
  paths: MeshlogData["paths"];
  reportCodes: Map<PacketDerivation["observations"][number], ReturnType<typeof reportPathCodes>>;
}

/** Session-owned weak keys release obsolete packet revisions without discarding retained history. */
export function createMeshlogDataBuilder() {
  const packets = new WeakMap<LiveMeshlogPacket, PacketDerivation>();
  return (snapshot: LiveMeshlogSnapshot, metadata: MeshlogMetadata, unknownName: string) =>
    buildLiveMeshlogData(snapshot, metadata, unknownName, packets);
}

function derivePacket(packet: LiveMeshlogPacket, iatas: string[] | undefined, unknownName: string): Omit<PacketDerivation, "region"> {
  const observations = packetObservations(packet, iatas);
  const pointNames = new Map<string, string>();
  for (const report of observations) {
    for (const endpoint of [report.resolvedSource, report.resolvedDestination]) for (const node of endpoint?.nodes ?? []) {
      pointNames.set(node.id, node.name || shortNodeKey(node.publicKey) || unknownName);
    }
    for (const hop of report.resolvedPath ?? []) for (const node of hop.nodes) {
      pointNames.set(node.id, node.name || shortNodeKey(node.publicKey, hop.hashBytes ? hop.hashBytes.length / 2 : report.pathLength?.hashSize) || unknownName);
    }
  }
  const packetPaths = buildPacketPaths({ header: { payloadType: packet.packet.payloadType }, resolvedRoute: packet.detail?.resolvedRoute, observations: observations.map(report => ({
    observerId: report.observerId, observerName: report.observerName,
    resolvedPath: report.resolvedPath?.length ? report.resolvedPath : report.pathLength?.hopCount === 0 ? [] : [{ confidence: "none", nodes: [] }],
    resolvedSource: report.resolvedSource ?? undefined,
    resolvedDestination: report.resolvedDestination ?? undefined,
  })) });
  return {
    unknownName, observations,
    paths: packetPaths.filter(path => path.points.some((point, index) => index > 0 && !point.breakBefore)).map(path => ({ ...path,
      key: `${packet.hash}:${path.key}`, color: observerColor(path.key),
      points: path.points.map(point => ({ ...point, name: point.name || pointNames.get(point.id) || unknownName })),
    })),
    reportCodes: new Map(observations.map(report => [report, reportPathCodes(report, packet.detail?.resolvedRoute, packet.packet.payloadType === PayloadType.TRACE)])),
  };
}

export function buildLiveMeshlogData(snapshot: LiveMeshlogSnapshot, metadata: MeshlogMetadata, unknownName: string,
  cache = new WeakMap<LiveMeshlogPacket, PacketDerivation>()): MeshlogData {
  const nodes = new Map(metadata.nodes.map(node => [node.id, node]));
  for (const update of snapshot.nodes.values()) {
    const prior = nodes.get(update.nodeId);
    nodes.set(update.nodeId, {
      ...prior, id: update.nodeId, name: update.name || prior?.name || null,
      publicKey: update.publicKey, nodeType: update.nodeType, nodeTypeName: update.nodeTypeName,
       lat: update.lat === undefined ? prior?.lat ?? null : update.lat,
       lng: update.lng === undefined ? prior?.lng ?? null : update.lng,
       radio: update.radio === undefined ? prior?.radio : update.radio,
       defaultScope: update.defaultScope === undefined ? prior?.defaultScope : update.defaultScope,
       possiblyForeign: update.possiblyForeign === undefined ? prior?.possiblyForeign : update.possiblyForeign ?? undefined,
      iatas: update.iatas, isObserver: update.isObserver, knownNeighborCount: prior?.knownNeighborCount ?? 0,
    });
  }
  const observerKeys = new Map([...nodes.values()].flatMap(node => node.observerId && node.publicKey ? [[node.observerId, node.publicKey] as const] : []));
  snapshot.packets.forEach(packet => packet.reports.forEach(report => {
    if (report.observerPublicKey) observerKeys.set(report.observerId, report.observerPublicKey);
  }));
  const reporters = new Map<string, MeshlogReporter>();
  const addReporter = (id: string, name?: string, info?: Partial<MeshlogReporter>) => reporters.set(id, {
    ...reporters.get(id), ...info, id, name: name || reporters.get(id)?.name || unknownName,
    publicKey: observerKeys.get(id), color: observerColor(id),
  });
  metadata.observers.forEach(observer => addReporter(observer.id, observer.displayName, { iata: observer.iata, observerType: observer.observerType, status: observer.status }));
  snapshot.observers.forEach(observer => addReporter(observer.observerId, observer.displayName, {
    iata: observer.iata, observerType: observer.observerType, status: observer.online ? "online" : "offline",
  }));
  const region = metadata.iatas === undefined ? undefined : JSON.stringify(metadata.iatas);
  const derivations = new Map(snapshot.packets.map(packet => {
    let derived = cache.get(packet);
    if (!derived || derived.region !== region || derived.unknownName !== unknownName) {
      derived = { region, ...derivePacket(packet, metadata.iatas, unknownName) };
      cache.set(packet, derived);
    }
    return [packet.hash, derived] as const;
  }));
  const packetReports = new Map([...derivations].map(([hash, derived]) => [hash, derived.observations]));
  const observerWidths = new Map<string, { size: 1 | 2 | 3; heardAt: number }>();
  snapshot.packets.forEach(packet => {
    if (packet.packet.payloadType === PayloadType.TRACE) return;
    packetReports.get(packet.hash)!.forEach(report => {
      const size = radioHashSize(report.pathLength?.hashSize);
      if (size && (observerWidths.get(report.observerId)?.heardAt ?? -Infinity) <= report.heardAt) observerWidths.set(report.observerId, { size, heardAt: report.heardAt });
    });
    const latest = packet.summary?.latestObserver;
    const size = radioHashSize(latest?.pathLength?.hashSize);
    if (latest && size && !observerWidths.has(latest.id)) observerWidths.set(latest.id, { size, heardAt: packet.lastHeardAt });
  });
  const hashSizes = new Map<string, { size: 1 | 2 | 3; heardAt: number }>();
  for (const observations of packetReports.values()) for (const report of observations) for (const hop of report.resolvedPath ?? []) {
    if (hop.confidence !== "high" || hop.nodes.length !== 1) continue;
    const node = hop.nodes[0]!;
    const width = hop.hashBytes ? hop.hashBytes.length / 2 : report.pathLength?.hashSize;
    if (width !== 1 && width !== 2 && width !== 3) continue;
    if (hop.hashBytes && !node.publicKey.toLowerCase().startsWith(hop.hashBytes.toLowerCase())) continue;
    if ((hashSizes.get(node.id)?.heardAt ?? -Infinity) <= report.heardAt) hashSizes.set(node.id, { size: width, heardAt: report.heardAt });
  }
  snapshot.packets.forEach(packet => {
    packetReports.get(packet.hash)!.forEach(report => {
      if (!reporters.has(report.observerId)) addReporter(report.observerId, report.observerName, { iata: report.iata });
    });
    const latest = packet.summary?.latestObserver;
    if (latest && (metadata.iatas === undefined || metadata.iatas.includes(latest.iata)) && !reporters.has(latest.id)) addReporter(latest.id, latest.displayName, { iata: latest.iata });
  });
  reporters.forEach(reporter => {
    reporter.hashSize = observerWidths.get(reporter.id)?.size;
    reporter.code = shortNodeKey(reporter.publicKey, reporter.hashSize);
  });
  const channels = new Map(metadata.channels.map(channel => [channel.channelHash.toLowerCase(), {
    id: channel.channelHash.toLowerCase(), name: channel.name || channel.channelHash, keyKnown: channel.keyKnown,
  }]));
  const paths: MeshlogData["paths"] = [];
  const messages: MeshlogMessage[] = snapshot.packets.map(packet => {
    const observations = packetReports.get(packet.hash)!;
    const source = observations.map(report => report.resolvedSource).find(hop => hop?.confidence === "high" && hop.nodes.length === 1)?.nodes[0];
    const kind = packet.packet.payloadType === PayloadType.ADVERT ? "advertisement"
      : packet.packet.payloadType === PayloadType.GROUP_TEXT || packet.packet.payloadType === PayloadType.GROUP_DATA ? "channel"
      : packet.packet.payloadType === PayloadType.TEXT ? "direct" : "other";
    const message = packet.message ?? decodedMessage(packet.detail, packet.hash);
    const channelId = kind === "channel" ? (packet.message?.channelHash ?? packet.detail?.channelHash)?.toLowerCase() : undefined;
    if (channelId && !channels.has(channelId)) channels.set(channelId, { id: channelId, name: channelId, keyKnown: false });
    const derived = derivations.get(packet.hash)!;
    for (const path of derived.paths) {
      const observerId = path.key.slice(packet.hash.length + 1);
      const label = packet.packet.payloadType === PayloadType.TRACE ? path.label : reporters.get(observerId)?.name ?? path.label;
      paths.push(label === path.label ? path : { ...path, label });
    }
    const latestReports = new Map(observations.map(report => [report.observerId, report]));
    const reports = [...latestReports.values()].map(report => ({
      reporterId: report.observerId, time: meshlogTime(report.heardAt),
      hashSize: packet.packet.payloadType === PayloadType.TRACE ? undefined : radioHashSize(report.pathLength?.hashSize),
      observerCode: shortNodeKey(reporters.get(report.observerId)?.publicKey, packet.packet.payloadType === PayloadType.TRACE ? undefined : report.pathLength?.hashSize),
      ...derived.reportCodes.get(report)!,
    }));
    if (!reports.length && packet.summary?.latestObserver && (metadata.iatas === undefined || metadata.iatas.includes(packet.summary.latestObserver.iata))) reports.push({
      reporterId: packet.summary.latestObserver.id, time: "—", path: [], pathNames: [], segments: [], pathUnavailable: true,
      hashSize: radioHashSize(packet.summary.latestObserver.pathLength?.hashSize),
      observerCode: shortNodeKey(reporters.get(packet.summary.latestObserver.id)?.publicKey, packet.summary.latestObserver.pathLength?.hashSize),
    });
    const senderName = message?.senderName || source?.name || (kind === "advertisement" ? packet.packet.summary : undefined);
    return {
      id: packet.hash, time: meshlogTime(packet.firstHeardAt), heardAt: packet.firstHeardAt,
      senderId: source?.id, senderName: senderName || unknownName, senderUnknown: !senderName,
      ...meshlogPacketEndpoints(packet.packet.payloadType, packet.detail, observations),
      kind, payloadType: packet.packet.payloadType, typeLabel: kind === "other" ? packet.packet.payloadTypeName : undefined,
      scope: packet.packet.scope || packet.summary?.scope || packet.detail?.scope || packet.message?.scope || undefined,
      channelId, channel: channelId ? channels.get(channelId)?.name : undefined,
      text: message?.content, reportsPending: !packet.detail && packet.reports.size === 0,
      reports,
    };
  });
  return {
    contacts: [...nodes.values()].map(node => meshlogContact(node, hashSizes.get(node.id)?.size, unknownName)),
    messages, reporters: [...reporters.values()], channels: [...channels.values()], paths,
  };
}
