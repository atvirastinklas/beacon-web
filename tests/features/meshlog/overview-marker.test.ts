import { afterEach, describe, expect, it, vi } from "vitest";
import { rasterizeOverviewMarker } from "../../../src/features/meshlog/overview-marker";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("atomic Meshlog overview marker", () => {
  it.each([1, 2, 3])("draws the complete black/white/color marker on one image at DPR %s without shrinking its logical radii", dpr => {
    vi.stubGlobal("devicePixelRatio", dpr);
    const fills: string[] = [];
    const image = { width: 24 * dpr * 2, height: 24 * dpr * 2 } as ImageData;
    const context = {
      fillStyle: "", beginPath: vi.fn(), arc: vi.fn(),
      fill() { fills.push(this.fillStyle); }, getImageData: vi.fn(() => image),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const icon = rasterizeOverviewMarker("#a78bfa");
    const scale = dpr * 2;
    expect(icon).toEqual({ data: image, pixelRatio: scale });
    expect(fills).toEqual(["#000000", "#ffffff", "#a78bfa"]);
    expect(context.arc.mock.calls).toEqual([8.5, 7, 5.5].map(radius => [12 * scale, 12 * scale, radius * scale, 0, Math.PI * 2]));
    expect(context.getImageData).toHaveBeenCalledExactlyOnceWith(0, 0, 24 * scale, 24 * scale);
  });
});
