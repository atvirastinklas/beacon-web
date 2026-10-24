import { ALL_REGIONS, deserializeSelection, isAllRegions, parseSelection, type RegionSelection } from "../hooks/region-selection";

/** Shared URL → saved → legacy selection precedence for Beacon and its standalone live view. */
export function computeInitialSelection(params: URLSearchParams): RegionSelection {
  const fromUrl = parseSelection(params);
  if (!isAllRegions(fromUrl)) return fromUrl;
  const stored = deserializeSelection(localStorage.getItem("beacon-region-selection"));
  if (!isAllRegions(stored)) return stored;
  const legacy = localStorage.getItem("beacon-region");
  if (legacy && legacy !== "*") return { regions: [], iatas: [legacy.toUpperCase()] };
  return ALL_REGIONS;
}
