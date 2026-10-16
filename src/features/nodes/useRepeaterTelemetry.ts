import { useQuery } from "@tanstack/react-query";

export interface RepeaterTelemetryReading {
  timestamp: number;
  battery_v: number | null;
  temperature_c: number | null;
  rssi: number | null;
  snr: number | null;
}

function metric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function getRepeaterTelemetry(publicKey: string, signal?: AbortSignal): Promise<RepeaterTelemetryReading[]> {
  const response = await fetch(`https://telemetry.ite.lt/api/node/${encodeURIComponent(publicKey)}`, { signal });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Telemetry request failed (${response.status})`);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("success" in body) || body.success !== true ||
      !("telemetry" in body) || !Array.isArray(body.telemetry)) {
    throw new Error("Invalid telemetry response");
  }
  return body.telemetry.flatMap((row: unknown): RepeaterTelemetryReading[] => {
    if (typeof row !== "object" || row === null || !("iso" in row) || typeof row.iso !== "string") return [];
    const timestamp = Date.parse(row.iso);
    if (!Number.isFinite(timestamp)) return [];
    return [{
      timestamp,
      battery_v: metric("battery_v" in row ? row.battery_v : null),
      temperature_c: metric("temperature_c" in row ? row.temperature_c : null),
      rssi: metric("rssi" in row ? row.rssi : null),
      snr: metric("snr" in row ? row.snr : null),
    }];
  }).sort((a, b) => a.timestamp - b.timestamp).slice(-10);
}

export function useRepeaterTelemetry(publicKey: string) {
  return useQuery({
    queryKey: ["repeater-telemetry", publicKey],
    queryFn: ({ signal }) => getRepeaterTelemetry(publicKey, signal),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
