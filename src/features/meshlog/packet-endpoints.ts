import type { PacketDetail, ResolvedHop } from "../../types/api";
import { PayloadType } from "../../types/enums";

type EndpointReport = { resolvedSource?: ResolvedHop | null; resolvedDestination?: ResolvedHop | null };

function radioHex(value: unknown): string | undefined {
  return typeof value === "string" && /^(?:[0-9a-f]{2})+$/i.test(value) ? value.toLowerCase() : undefined;
}

function uniqueKey(hop: ResolvedHop | null | undefined): string | undefined {
  return hop?.confidence === "high" && hop.nodes.length === 1 ? radioHex(hop.nodes[0]!.publicKey) : undefined;
}

/** Prefer explicit wire identifiers; never substitute relay or internal node IDs. */
export function meshlogPacketEndpoints(payloadType: number, detail: PacketDetail | undefined, reports: readonly EndpointReport[]) {
  const parsed = detail?.parsedPayload;
  const payload: Record<string, unknown> = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const anonymousTarget = payloadType === PayloadType.ANON_REQ && typeof payload.destination === "number"
    && Number.isInteger(payload.destination) && payload.destination >= 0 && payload.destination <= 255
    ? payload.destination.toString(16).padStart(2, "0") : undefined;
  return {
    originator: radioHex(payload.sourceHash) ?? radioHex(detail?.originPubkey)
      ?? (payloadType === PayloadType.ADVERT ? radioHex(payload.publicKey) : undefined)
      ?? (payloadType !== PayloadType.ANON_REQ ? radioHex(payload.senderPublicKey) : undefined)
      ?? reports.map(report => uniqueKey(report.resolvedSource)).find(key => key !== undefined),
    target: radioHex(payload.destinationHash) ?? anonymousTarget
      ?? reports.map(report => uniqueKey(report.resolvedDestination)).find(key => key !== undefined),
  };
}
