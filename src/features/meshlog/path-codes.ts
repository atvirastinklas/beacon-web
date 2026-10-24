import type { PathLength, ResolvedHop } from "../../types/api";
import { shortNodeKey } from "./short-node-key";
import type { MeshlogPathSegment } from "./types";

export function radioHashSize(size?: number): 1 | 2 | 3 | undefined {
  return size === 1 || size === 2 || size === 3 ? size : undefined;
}

/** Raw radio hashes take precedence over names and resolution confidence. */
export function reportPathCodes(report: { pathLength?: PathLength; pathBytes?: string; resolvedPath?: ResolvedHop[] | null }, traceRoute?: ResolvedHop[], isTrace = false) {
  const hops = isTrace ? traceRoute ?? [] : report.resolvedPath ?? [];
  const size = isTrace ? undefined : radioHashSize(report.pathLength?.hashSize);
  const width = size && size * 2;
  const bytes = report.pathBytes?.toLowerCase();
  if (!isTrace && report.pathLength?.hopCount === 0) return { path: [], pathNames: [], segments: [], pathUnavailable: false };
  let path: string[];
  if (!isTrace && width && bytes && /^[0-9a-f]+$/.test(bytes) && bytes.length === report.pathLength!.hopCount * width) {
    path = bytes.match(new RegExp(`.{${width}}`, "g"))!;
  } else {
    path = hops.map(hop => {
      if (hop.hashBytes) return /^(?:[0-9a-f]{2}|[0-9a-f]{4}|[0-9a-f]{6})$/i.test(hop.hashBytes) && (!width || hop.hashBytes.length === width)
        ? hop.hashBytes.toLowerCase() : "?";
      const node = hop.confidence === "high" && hop.nodes.length === 1 ? hop.nodes[0] : undefined;
      return size && node && /^[0-9a-f]+$/i.test(node.publicKey) ? shortNodeKey(node.publicKey, size)! : "?";
    });
  }
  const segments: MeshlogPathSegment[] = path.map((code, index) => ({
    code, confidence: hops[index]?.confidence ?? "none",
    nodes: (hops[index]?.nodes ?? []).map(node => ({ id: node.id, name: node.name, publicKey: node.publicKey })),
  }));
  return {
    path,
    segments,
    pathNames: path.map((code, index) => {
      const hop = hops[index];
      return hop?.confidence === "high" && hop.nodes.length === 1 ? hop.nodes[0]!.name || code : code;
    }),
    pathUnavailable: path.length === 0,
  };
}
