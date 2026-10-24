import { expect, it } from "vitest";
import { meshlogPacketEndpoints } from "../../../src/features/meshlog/packet-endpoints";
import { PayloadType } from "../../../src/types/enums";
import { historyDetail } from "./live-fixtures";

it("keeps the actual raw originator and target hashes rather than resolved IDs or key prefixes", () => {
  const detail = { ...historyDetail(), parsedPayload: { type: "TEXT_MESSAGE", sourceHash: "A1", destinationHash: "B2" } };
  expect(meshlogPacketEndpoints(PayloadType.TEXT, detail, detail.observations)).toEqual({ originator: "a1", target: "b2" });
});

it("keeps full real public keys when only an origin key and uniquely resolved target are available", () => {
  const detail = { ...historyDetail(), originPubkey: "11".repeat(32), parsedPayload: undefined };
  const reports = [{
    resolvedSource: { confidence: "high" as const, nodes: [{ id: "internal-source", publicKey: "22".repeat(32) }] },
    resolvedDestination: { confidence: "high" as const, nodes: [{ id: "internal-target", publicKey: "33".repeat(32) }] },
  }];
  expect(meshlogPacketEndpoints(PayloadType.REQUEST, detail, reports)).toEqual({ originator: "11".repeat(32), target: "33".repeat(32) });
  expect(meshlogPacketEndpoints(PayloadType.REQUEST, undefined, reports)).toEqual({ originator: "22".repeat(32), target: "33".repeat(32) });
});

it.each([0, 255])("reads the explicit one-byte anonymous target %i without claiming its ephemeral key as an originator", destination => {
  const detail = { ...historyDetail(), parsedPayload: { type: "ANON_REQUEST", destination, ephemeralPubKey: "aa".repeat(32), senderPublicKey: "bb".repeat(32) } };
  expect(meshlogPacketEndpoints(PayloadType.ANON_REQ, detail, [])).toEqual({ originator: undefined, target: destination === 0 ? "00" : "ff" });
});

it.each([-1, 256, 1.5, Number.NaN])("rejects malformed anonymous destination %s", destination => {
  const detail = { ...historyDetail(), parsedPayload: { type: "ANON_REQUEST", destination } };
  expect(meshlogPacketEndpoints(PayloadType.ANON_REQ, detail, []).target).toBeUndefined();
});

it("does not reinterpret a generic destination number, payload bytes or relay hashes as endpoints", () => {
  const detail = { ...historyDetail(), rawPayload: "aabbccdd", parsedPayload: { type: "TRACE", destination: 42, pathHashes: ["aa", "bb"] } };
  expect(meshlogPacketEndpoints(PayloadType.TRACE, detail, [])).toEqual({ originator: undefined, target: undefined });
});

it("does not pick an ambiguous candidate or an internal UUID", () => {
  const detail = { ...historyDetail(), originPubkey: "internal-node-uuid", parsedPayload: { sourceHash: "abc", destinationHash: "internal-target-uuid" } };
  expect(meshlogPacketEndpoints(PayloadType.REQUEST, detail, [{
    resolvedSource: { confidence: "ambiguous", nodes: [{ id: "one", publicKey: "aabb" }, { id: "two", publicKey: "aacc" }] },
    resolvedDestination: { confidence: "high", nodes: [{ id: "internal-target", publicKey: "not-a-radio-key" }] },
  }])).toEqual({ originator: undefined, target: undefined });
});

it("uses an advertised public key only for an advert, and explicit sender keys only outside anonymous requests", () => {
  const detail = { ...historyDetail(), parsedPayload: { publicKey: "aabbccdd" } };
  expect(meshlogPacketEndpoints(PayloadType.ADVERT, detail, []).originator).toBe("aabbccdd");
  expect(meshlogPacketEndpoints(PayloadType.GROUP_TEXT, detail, []).originator).toBeUndefined();
  const senderDetail = { ...historyDetail(), parsedPayload: { senderPublicKey: "ccddee00" } };
  expect(meshlogPacketEndpoints(PayloadType.REQUEST, senderDetail, []).originator).toBe("ccddee00");
});
