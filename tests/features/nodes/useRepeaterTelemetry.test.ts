import { afterEach, describe, expect, it, vi } from "vitest";
import { getRepeaterTelemetry } from "../../../src/features/nodes/useRepeaterTelemetry";

afterEach(() => vi.unstubAllGlobals());

describe("getRepeaterTelemetry", () => {
  it("fetches the selected public key and parses offset-aware telemetry readings", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      telemetry: [{ iso: "2026-10-14T13:24:57+03:00", battery_v: 4.15, temperature_c: 20, rssi: -118, snr: -9.75 }],
    })));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;

    expect(await getRepeaterTelemetry("4607969d", signal)).toEqual([{
      timestamp: Date.UTC(2026, 9, 14, 10, 24, 57),
      battery_v: 4.15, temperature_c: 20, rssi: -118, snr: -9.75,
    }]);
    expect(fetch).toHaveBeenCalledWith("https://telemetry.ite.lt/api/node/4607969d", { signal });
  });

  it("treats an unknown node or unavailable telemetry as an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 404 })));
    expect(await getRepeaterTelemetry("unknown")).toEqual([]);
  });

  it.each([429, 500])("rejects HTTP %i even if its body contains telemetry", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ telemetry: [] }), { status })));
    await expect(getRepeaterTelemetry("node")).rejects.toThrow();
  });

  it.each([
    { success: false, telemetry: [] },
    { telemetry: [] },
    { success: true, telemetry: null },
    null,
  ])("rejects an unsuccessful or malformed response: %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(getRepeaterTelemetry("node")).rejects.toThrow();
  });

  it("preserves zero and negative readings without fabricating missing metric values", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      telemetry: [
        { iso: "2026-10-14T13:24:57+03:00", battery_v: "4.15", temperature_c: 0, rssi: -118, snr: null },
        { iso: "2026-10-14T14:24:57+03:00", battery_v: 4.15, snr: 0 },
      ],
    }))));
    expect(await getRepeaterTelemetry("node")).toEqual([
      { timestamp: Date.UTC(2026, 9, 14, 10, 24, 57), battery_v: null, temperature_c: 0, rssi: -118, snr: null },
      { timestamp: Date.UTC(2026, 9, 14, 11, 24, 57), battery_v: 4.15, temperature_c: null, rssi: null, snr: 0 },
    ]);
  });

  it("returns only the latest ten valid readings in chronological order", async () => {
    const readings = Array.from({ length: 12 }, (_, hour) => ({
      iso: `2026-10-14T${String(hour).padStart(2, "0")}:00:00Z`, battery_v: 4,
    })).reverse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true, telemetry: [...readings, null, {}, { iso: "invalid date" }, { iso: 123 }],
    }))));

    const result = await getRepeaterTelemetry("node");
    expect(result.map((reading) => new Date(reading.timestamp).getUTCHours())).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});
