import { expect, it } from "vitest";
import { reportPathCodes } from "../../../src/features/meshlog/path-codes";

it.each([
  [1, "A1B2", ["a1", "b2"]],
  [2, "A1B2C3D4", ["a1b2", "c3d4"]],
  [3, "A1B2C3D4E5F6", ["a1b2c3", "d4e5f6"]],
] as const)("splits raw %i-byte hop hashes without replacing them with resolved names", (hashSize, pathBytes, codes) => {
  const result = reportPathCodes({ pathLength: { raw: "02", hashSize, hopCount: 2 }, pathBytes,
    resolvedPath: [{ confidence: "high", nodes: [{ id: "internal-uuid", name: "Named relay", publicKey: "a1b2c3d4e5f6" }] }],
  });
  expect(result.path).toEqual(codes);
  expect(result.pathNames[0]).toBe("Named relay");
  expect(result.pathUnavailable).toBe(false);
});

it("preserves actual hop codes even when their nodes or locations cannot be resolved", () => {
  expect(reportPathCodes({ pathLength: { raw: "01", hashSize: 1, hopCount: 1 }, pathBytes: "ab", resolvedPath: [{ confidence: "none", nodes: [] }] }))
    .toMatchObject({ path: ["ab"], pathUnavailable: false });
});

it("uses explicit hop hashes or a known-width public key, never a node UUID", () => {
  const hop = { confidence: "high" as const, nodes: [{ id: "internal-uuid", name: "Named relay", publicKey: "aabbccddeeff" }] };
  expect(reportPathCodes({ pathLength: { raw: "01", hashSize: 2, hopCount: 1 }, resolvedPath: [hop] }).path).toEqual(["aabb"]);
  expect(reportPathCodes({ resolvedPath: [{ ...hop, hashBytes: "aabbcc" }] }).path).toEqual(["aabbcc"]);
  expect(reportPathCodes({ resolvedPath: [hop] }).path).toEqual(["?"]);
});

it("distinguishes a known direct route from unavailable or malformed bytes", () => {
  expect(reportPathCodes({ pathLength: { raw: "00", hashSize: 1, hopCount: 0 } })).toMatchObject({ path: [], pathUnavailable: false });
  expect(reportPathCodes({ pathLength: { raw: "01", hashSize: 2, hopCount: 1 }, pathBytes: "abc" })).toMatchObject({ path: [], pathUnavailable: true });
});

it("never treats TRACE signal samples as radio hashes", () => {
  const trace = { pathLength: { raw: "01", hashSize: 1, hopCount: 1 }, pathBytes: "ff" };
  expect(reportPathCodes(trace, undefined, true)).toMatchObject({ path: [], pathUnavailable: true });
  expect(reportPathCodes(trace, [{ confidence: "none", nodes: [], hashBytes: "aabb" }], true).path).toEqual(["aabb"]);
});

it("keeps each hop's actual candidate count separate from its raw code and map availability", () => {
  const result = reportPathCodes({
    pathLength: { raw: "03", hashSize: 2, hopCount: 3 }, pathBytes: "aabbccddeeff",
    resolvedPath: [
      { confidence: "high", nodes: [{ id: "one", name: "One relay", publicKey: "aabb0011" }] },
      { confidence: "ambiguous", nodes: [{ id: "two", name: "First candidate", publicKey: "ccdd0011" }, { id: "three", name: "Second candidate", publicKey: "ccdd2233" }] },
      { confidence: "none", nodes: [] },
    ],
  });
  expect(result.path).toEqual(["aabb", "ccdd", "eeff"]);
  expect(result.segments.map(segment => segment.nodes.length)).toEqual([1, 2, 0]);
  expect(result.segments.map(segment => segment.confidence)).toEqual(["high", "ambiguous", "none"]);
  expect(result.segments[1]!.nodes.map(node => node.name)).toEqual(["First candidate", "Second candidate"]);
  expect(result.pathUnavailable).toBe(false);
});
