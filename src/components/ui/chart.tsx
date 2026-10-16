import * as React from "react";
import { ResponsiveContainer, Tooltip } from "recharts";
import type { TooltipContentProps, TooltipValueType } from "recharts";

// Adapted from shadcn/ui's Recharts 3 chart: only container and tooltip APIs are needed here.
export type ChartConfig = Record<string, { label: React.ReactNode; color: string }>;

const ChartContext = React.createContext<ChartConfig | null>(null);

function ChartContainer({
  id,
  className,
  children,
  config,
  style,
  initialDimension = { width: 320, height: 112 },
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof ResponsiveContainer>["children"];
  initialDimension?: { width: number; height: number };
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${(id ?? uniqueId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const colors = Object.fromEntries(Object.entries(config).map(([key, item]) => [`--color-${key}`, item.color]));

  return (
    <ChartContext.Provider value={config}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={`flex min-w-0 justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-text-normal ${className ?? ""}`}
        style={{ ...colors, ...style } as React.CSSProperties}
        {...props}
      >
        <ResponsiveContainer initialDimension={initialDimension}>
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = Tooltip;

function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  className,
}: Partial<TooltipContentProps<TooltipValueType, string | number>> & React.ComponentProps<"div">) {
  const config = React.useContext(ChartContext);
  if (!config) throw new Error("ChartTooltipContent must be used within a ChartContainer");
  if (!active || !payload?.length) return null;

  return (
    <div role="status" className={`grid min-w-40 gap-1.5 rounded border border-border bg-bg-raised px-2.5 py-2 font-mono text-xs text-text-bright shadow-lg ${className ?? ""}`}>
      <div className="font-medium">{labelFormatter ? labelFormatter(label, payload) : label}</div>
      {payload.filter((item) => item.type !== "none").map((item, index) => {
        const key = String(item.dataKey ?? item.name ?? "value");
        return (
          <div key={key} className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: config[key]?.color ?? item.color }} />
            <span className="text-text-normal">{config[key]?.label ?? item.name}</span>
            <span className="ml-auto font-medium tabular-nums">
              {formatter && item.value != null && item.name != null
                ? formatter(item.value, item.name, item, index, payload)
                : String(item.value ?? "—")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent };
