import { afterEach, describe, expect, it, vi } from "vitest";
import { liveNodeIconId, MAP_ICON_IDS, nodeTypeColor, rasterizeNodeIcon } from "../../../src/features/map/node-icons";

afterEach(() => { document.documentElement.removeAttribute("style"); vi.restoreAllMocks(); });

describe("live dot colors", () => {
  it("uses exactly the glyph palette colors for every type and unknown fallback", async () => {
    const vars = { companion: ["--palette-primary", "#123456"], repeater: ["--palette-secondary", "#abcdef"], room_server: ["--palette-green", "#22aa55"], sensor: ["--palette-warn", "#ffbb11"], unknown: ["--palette-text-muted", "#777777"] };
    const context = { beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), getImageData: vi.fn(() => ({ width: 32, height: 32, data: new Uint8ClampedArray(4096) })), fillStyle: "", strokeStyle: "", lineWidth: 0 };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    for (const [type, [variable, color]] of Object.entries(vars)) {
      document.documentElement.style.setProperty(variable, color);
      expect(nodeTypeColor(type)).toBe(color);
      expect(MAP_ICON_IDS).toContain(liveNodeIconId(type));
      const image = await rasterizeNodeIcon(liveNodeIconId(type), true);
      expect(image).not.toBeNull();
      expect(context.fillStyle).toBe(color);
      expect(context.arc).toHaveBeenLastCalledWith(5 * image!.pixelRatio, 5 * image!.pixelRatio, 4 * image!.pixelRatio, 0, Math.PI * 2);
      expect(context.strokeStyle).toBe("rgba(255,255,255,0.8)");
    }
    await rasterizeNodeIcon(liveNodeIconId("repeater"), false);
    expect(context.fillStyle).toBe(nodeTypeColor("repeater"));
    expect(context.strokeStyle).toBe("rgba(0,0,0,0.75)");
    document.documentElement.style.setProperty("--palette-secondary", "#ff00ff");
    await rasterizeNodeIcon(liveNodeIconId("repeater"), false);
    expect(context.fillStyle).toBe("#ff00ff");
    expect(await rasterizeNodeIcon(liveNodeIconId("unrecognized"), true)).toBeNull();
  });
});
