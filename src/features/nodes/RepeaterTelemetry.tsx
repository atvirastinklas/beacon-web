import { useId } from "react";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../../components/ui/chart";
import { Timestamp } from "../../components/Timestamp";
import { useRepeaterTelemetry } from "./useRepeaterTelemetry";

const METRICS = [
  { key: "battery_v", label: "battery", unit: "V" },
  { key: "temperature_c", label: "temperature", unit: "°C" },
  { key: "rssi", label: "rssi", unit: "dBm" },
  { key: "snr", label: "snr", unit: "dB" },
] as const;

export default function RepeaterTelemetry({ publicKey }: { publicKey: string }) {
  const { t, i18n } = useTranslation();
  const { data, isPending, isError, isFetching, refetch } = useRepeaterTelemetry(publicKey);
  const instructionsId = useId();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const numbers = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const dates = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  });
  const ticks = new Intl.DateTimeFormat(locale, {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const error = isError && (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs">
      <span role="alert" className="text-text-normal">{t("repeaterTelemetry.error")}</span>
      <button
        type="button"
        onClick={() => void refetch()}
        disabled={isFetching}
        className="min-h-9 rounded px-2 text-primary hover:bg-primary/10 disabled:cursor-wait disabled:opacity-60"
      >
        {t("repeaterTelemetry.retry")}
      </button>
    </div>
  );

  if (!data?.length) {
    if (isError) return error;
    return (
      <div role="status" className="font-mono text-xs text-text-normal">
        {t(isPending ? "common.loadingDots" : "repeaterTelemetry.empty")}
      </div>
    );
  }

  const latest = data[data.length - 1]!;

  return (
    <div className="min-w-0">
      {error}
      <div className="mb-3 flex flex-wrap gap-x-1 font-mono text-xs text-text-normal">
        <span className="text-text-dim">{t("repeaterTelemetry.latestReading")}</span>
        <Timestamp value={latest.timestamp} mode="absolute" className="text-text-normal" />
      </div>
      <p id={instructionsId} className="sr-only">{t("repeaterTelemetry.chartInstructions")}</p>
      <div className="flex flex-col gap-3">
        {METRICS.map(({ key, label, unit }) => {
          const name = t(`repeaterTelemetry.${label}`);
          const formatValue = (value: number) => `${numbers.format(value)} ${unit}`;
          const latestValue = latest[key];
          return (
            <figure key={key} className="min-w-0">
              <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-xs">
                <span className="font-medium text-text-dim">{name} <span className="font-normal text-text-dim">({unit})</span></span>
                <span className="text-text-normal tabular-nums">{latestValue == null ? "—" : formatValue(latestValue)}</span>
              </figcaption>
              {data.some((reading) => reading[key] != null) ? (
                <ChartContainer config={{ [key]: { label: name, color: "var(--color-primary)" } }} className="h-[112px] w-full">
                  <LineChart
                    accessibilityLayer
                    aria-label={t("repeaterTelemetry.chartLabel", { metric: name, unit })}
                    aria-describedby={instructionsId}
                    data={data}
                    margin={{ top: 6, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid vertical={false} stroke="var(--color-border-subtle)" />
                    <XAxis
                      dataKey="timestamp"
                      type="number"
                      scale="time"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(value: number) => ticks.format(value)}
                      tickCount={3}
                      minTickGap={24}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10 }}
                      height={24}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tickFormatter={formatValue}
                      tickCount={3}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10 }}
                      width={68}
                    />
                    <ChartTooltip
                      cursor={false}
                      isAnimationActive={false}
                      content={<ChartTooltipContent
                        labelFormatter={(value) => typeof value === "number" ? dates.format(value) : value}
                        formatter={(value) => typeof value === "number" ? formatValue(value) : "—"}
                      />}
                    />
                    <Line
                      dataKey={key}
                      name={name}
                      type="linear"
                      stroke={`var(--color-${key})`}
                      strokeWidth={2}
                      dot={{ r: 3, fill: `var(--color-${key})`, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ChartContainer>
              ) : (
                <div className="flex h-[112px] items-center justify-center font-mono text-xs text-text-normal">
                  {t("repeaterTelemetry.noMetricReadings")}
                </div>
              )}
            </figure>
          );
        })}
      </div>
    </div>
  );
}
