import type { WsPacketObservation } from "../../../src/types/ws";
import type { Node, NodeSummary } from "../../../src/features/nodes/types";
import type { ChannelMessage } from "../../../src/features/channels/types";
import type { PacketDetail, PacketSummary } from "../../../src/types/api";
import type { Observer } from "../../../src/features/observers/types";

export const observerPublicKeys: Record<string, string> = {
  "observer-a": "a1b2c3d4".repeat(8), "observer-b": "b2c3d4e5".repeat(8),
};
export function liveObserver(id = "observer-a"): Observer {
  return { id, publicKey: observerPublicKeys[id] || "c3d4e5f6".repeat(8), displayName: id === "observer-a" ? "Live RX A" : "Live RX B",
    iata: "RIX", observerType: "repeater", status: "online", firstSeen: Date.UTC(2026, 9, 1), lastSeen: Date.UTC(2026, 9, 24),
    observationCount: 1, brokers: [],
  };
}

export const heardAt = Date.UTC(2026, 9, 24, 10, 23, 52);
export const liveNode: NodeSummary = {
  id: "source-node", publicKey: "0123456789abcdef", name: "Live Walker", nodeType: 1,
  nodeTypeName: "Companion", lat: 56.943, lng: 24.087,
  iatas: [{ iata: "RIX", lastHeard: heardAt }], knownNeighborCount: 0,
};

export function liveNodeDetail(node: NodeSummary = liveNode): Node {
  return { ...node, radio: "868,250,11", defaultScope: "#north", knownNeighborCount: 7,
    locationSource: "advert", firstSeen: heardAt - 86_400_000, lastSeen: heardAt,
    lastAdvertAt: heardAt - 60_000, supportsMultibytePaths: true, supportsMultibyteTraces: false,
    minFirmwareVersion: "1.12.0", metadata: null,
  };
}
export const liveMessage: ChannelMessage = {
  id: 1, packetHash: "packet-a", channelHash: "channel-a", senderName: "Live Walker", content: "Hello from live mode", sentAt: heardAt,
};
export function liveObservation(observerId = "observer-a", hash = "packet-a", time = heardAt): WsPacketObservation["data"] {
  return {
    packetHash: hash,
    packet: { payloadType: 5, payloadTypeName: "GRP_TXT", routeType: 1, routeTypeName: "FLOOD", isFirstObservation: true, observationCount: 1 },
    observation: {
      observerId, observerName: observerId === "observer-a" ? "Live RX A" : "Live RX B", iata: "RIX", heardAt: time,
      rssi: -80, snr: 9, sourceBroker: "test", pathLength: { raw: "01", hashSize: 1, hopCount: 1 },
      resolvedSource: { confidence: "high", nodes: [{ id: "source-node", publicKey: liveNode.publicKey, name: liveNode.name!, latitude: liveNode.lat!, longitude: liveNode.lng! }] },
      resolvedPath: [{ confidence: "high", hashBytes: "aa", nodes: [{ id: "relay", publicKey: "aabbccddeeff0011", name: "Live Relay", latitude: 56.951, longitude: 24.105 }] }],
      resolvedDestination: { confidence: "high", nodes: [{ id: "destination", publicKey: "destination-key", name: "Live Destination", latitude: 56.955, longitude: 24.112 }] },
    },
  };
}

export function historySummary(hash = "packet-a", time = heardAt): PacketSummary {
  return { packetHash: hash, payloadType: 5, payloadTypeName: "GRP_TXT", routeType: 1, routeTypeName: "FLOOD",
    firstHeardAt: time, lastHeardAt: time, observationCount: 1,
    latestObserver: { id: "observer-a", displayName: "Live RX A", iata: "RIX" },
  };
}

export function historyDetail(hash = "packet-a", observerIds = ["observer-a"]): PacketDetail {
  const event = liveObservation();
  return {
    packetHash: hash, header: { raw: "15", payloadVersion: 0, ...event.packet },
    rawPayload: "00", decrypted: true, channelHash: liveMessage.channelHash,
    parsedPayload: { type: "GROUP_TEXT", decrypted: { sender: liveMessage.senderName, content: liveMessage.content } },
    firstHeardAt: heardAt, lastHeardAt: heardAt + 10, firstToLastMs: 10, observationCount: observerIds.length,
    observations: observerIds.map((id, index) => {
      const report = liveObservation(id, hash, heardAt + index).observation;
      return { ...report, id: index + 1, pathLength: report.pathLength!, resolvedPath: report.resolvedPath ?? [],
        resolvedSource: report.resolvedSource ?? undefined, resolvedDestination: report.resolvedDestination ?? undefined };
    }),
  };
}
