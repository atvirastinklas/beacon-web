import type { RasterIcon } from "../map/node-icons";

export const overviewMarkerId = (type: string) => `meshlog-overview-dot-${type}`;

/** One multicolor image per palette type, so foreground fills never cover all
 * neighboring rings in a later layer. Radii are logical pixels, independent of DPR. */
export function rasterizeOverviewMarker(color: string): RasterIcon {
  const pixelRatio = Math.min(6, 2 * Math.ceil(window.devicePixelRatio || 1));
  const size = 24 * pixelRatio;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  for (const [radius, fill] of [[8.5, "#000000"], [7, "#ffffff"], [5.5, color]] as const) {
    context.beginPath();
    context.arc(size / 2, size / 2, radius * pixelRatio, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
  }
  return { data: context.getImageData(0, 0, size, size), pixelRatio };
}
