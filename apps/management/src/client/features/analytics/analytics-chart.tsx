import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";

import type { AnalyticsMetric } from "./analytics-range";

type SeriesPoint = Readonly<{
  bucket: string;
  humanClicks: number;
  uniqueHumanClicks: number;
  suspectedBotClicks: number;
}>;

export default function AnalyticsChart({
  title,
  series,
  metric,
  granularity,
}: Readonly<{
  title: string;
  series: readonly SeriesPoint[];
  metric: AnalyticsMetric | "bots";
  granularity: "hour" | "day";
}>) {
  const dataKey = {
    human: "humanClicks",
    unique: "uniqueHumanClicks",
    bots: "suspectedBotClicks",
  }[metric] as keyof SeriesPoint;
  const metricLabel = {
    human: "Human Clicks",
    unique: "Unique Human Clicks",
    bots: "Suspected Bot Clicks",
  }[metric];
  const chartData = useMemo(() => [...series], [series]);

  return (
    <section className="rounded-xl border bg-card p-4 text-card-foreground">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{metricLabel}</span>
      </div>
      <div className="h-72 min-w-0" aria-label={`${metricLabel} chart`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: -20 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={(value) => formatBucket(String(value), granularity)}
              stroke="var(--muted-foreground)"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              allowDecimals={false}
              stroke="var(--muted-foreground)"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              labelFormatter={(value) => formatTooltipBucket(String(value), granularity)}
              formatter={(value) => [Number(value).toLocaleString(), metricLabel]}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--popover-foreground)",
              }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              name={metricLabel}
              stroke={metric === "bots" ? "var(--information)" : "var(--primary)"}
              strokeWidth={2.5}
              dot={series.length <= 31}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium">View data table</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">
                  {granularity === "hour" ? "Browser time" : "UTC date"}
                </th>
                <th className="py-2 text-right font-medium">{metricLabel}</th>
              </tr>
            </thead>
            <tbody>
              {series.map((point) => (
                <tr className="border-b last:border-0" key={point.bucket}>
                  <td className="py-2 pr-4">{formatTooltipBucket(point.bucket, granularity)}</td>
                  <td className="py-2 text-right tabular-nums">{point[dataKey]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function formatBucket(value: string, granularity: "hour" | "day") {
  return new Intl.DateTimeFormat(undefined, {
    ...(granularity === "day" ? { month: "short", day: "numeric" } : { hour: "numeric" }),
    ...(granularity === "day" ? { timeZone: "UTC" } : {}),
  }).format(new Date(value));
}

function formatTooltipBucket(value: string, granularity: "hour" | "day") {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(granularity === "hour" ? { timeStyle: "short" } : {}),
    ...(granularity === "day" ? { timeZone: "UTC" } : {}),
  }).format(new Date(value));
}
