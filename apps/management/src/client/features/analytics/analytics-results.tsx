import { Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import type { z } from "zod";

import { instanceAnalyticsResponseSchema } from "../../api-schemas";
import { StatusChip } from "../links/link-presentation";
import type { AnalyticsMetric, AnalyticsSearch } from "./analytics-range";

const AnalyticsChart = lazy(() => import("./analytics-chart"));
type InstanceAnalytics = z.output<typeof instanceAnalyticsResponseSchema>;
type Breakdown = InstanceAnalytics["breakdowns"]["referrer"];

export function AnalyticsResults({
  data,
  metric,
  showBots,
  granularity,
  search,
  showTopLinks,
}: Readonly<{
  data: InstanceAnalytics;
  metric: AnalyticsMetric;
  showBots: boolean;
  granularity: "hour" | "day";
  search: AnalyticsSearch;
  showTopLinks: boolean;
}>) {
  const noHumans = data.summary.humanClicks === 0;
  const chartTitle =
    metric === "human" ? "How did Human Clicks change?" : "How did Unique Human Clicks change?";
  return (
    <>
      <section
        className="grid grid-cols-2 gap-x-6 gap-y-4 border-y py-5 sm:grid-cols-3"
        aria-label="Analytics summary"
      >
        <MetricValue label="Human Clicks" value={data.summary.humanClicks} />
        <MetricValue
          label="Unique Human Clicks"
          value={data.summary.uniqueHumanClicks}
          approximate
        />
        {showBots && (
          <MetricValue label="Suspected Bot Clicks" value={data.summary.suspectedBotClicks} />
        )}
      </section>
      {noHumans ? (
        <section className="rounded-xl border bg-card p-8 text-center">
          <h2 className="font-semibold">No Human Clicks in this UTC range</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {data.summary.suspectedBotClicks > 0 && !showBots
              ? data.summary.suspectedBotClicks.toLocaleString() +
                " suspected bot Clicks are excluded."
              : "Click Events will appear after an Active Link redirects a GET request."}
          </p>
        </section>
      ) : (
        <Suspense fallback={<AnalyticsSkeleton />}>
          <AnalyticsChart
            title={chartTitle}
            series={data.series}
            metric={metric}
            granularity={granularity}
          />
        </Suspense>
      )}
      {showBots && data.summary.suspectedBotClicks > 0 && (
        <Suspense fallback={<AnalyticsSkeleton />}>
          <AnalyticsChart
            title="When were suspected bots observed?"
            series={data.series}
            metric="bots"
            granularity={granularity}
          />
        </Suspense>
      )}
      {showTopLinks && <TopLinks data={data.topLinks} search={search} />}
      <div className="grid gap-6 lg:grid-cols-3">
        <BreakdownPanel title="Where did Human Clicks come from?" data={data.breakdowns.referrer} />
        <BreakdownPanel title="Which countries sent Human Clicks?" data={data.breakdowns.country} />
        <BreakdownPanel title="Which devices were used?" data={data.breakdowns.device} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Unique Human Clicks are approximate 30-minute, Link-scoped counts. Bot classification is
        approximate and never blocks a redirect. Recent Click Events may still be processing.
      </p>
    </>
  );
}

function MetricValue({
  label,
  value,
  approximate = false,
}: Readonly<{ label: string; value: number; approximate?: boolean }>) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        {approximate && (
          <span className="rounded-full bg-information-soft px-2 py-0.5 text-information">
            Approximate
          </span>
        )}
      </div>
      <strong className="mt-1 block text-2xl tabular-nums">{value.toLocaleString()}</strong>
    </div>
  );
}

function TopLinks({
  data,
  search,
}: Readonly<{ data: InstanceAnalytics["topLinks"]; search: AnalyticsSearch }>) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="font-semibold">Which Links received the most Human Clicks?</h2>
      {data.items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No ranked Links in this UTC range.</p>
      ) : (
        <ol className="mt-4 divide-y">
          {data.items.map((link, index) => (
            <li
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-3"
              key={link.id}
            >
              <span className="text-sm tabular-nums text-muted-foreground">{index + 1}</span>
              <div className="min-w-0">
                <Link
                  className="font-medium text-foreground hover:text-primary"
                  to="/links/$linkId"
                  params={{ linkId: link.id }}
                  search={{ state: [], ...search }}
                  aria-label={"Open analytics for " + link.title}
                >
                  {link.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="truncate text-xs text-muted-foreground">/{link.alias}</code>
                  <StatusChip state={link.state} />
                </div>
              </div>
              <strong className="tabular-nums">{link.humanClicks.toLocaleString()}</strong>
            </li>
          ))}
        </ol>
      )}
      {data.truncated && (
        <p className="mt-3 text-xs text-muted-foreground">Additional Links are not shown.</p>
      )}
    </section>
  );
}

function BreakdownPanel({ title, data }: Readonly<{ title: string; data: Breakdown }>) {
  const maximum = Math.max(...data.items.map((item) => item.humanClicks), 1);
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {data.items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No values in this UTC range.</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {data.items.map((item) => (
            <div className="grid gap-1" key={item.value}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{displayDimension(item.value)}</span>
                <span className="tabular-nums">{item.humanClicks.toLocaleString()}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: String((item.humanClicks / maximum) * 100) + "%" }}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {item.uniqueHumanClicks.toLocaleString()} Unique Human Clicks · approximate
              </span>
            </div>
          ))}
        </div>
      )}
      {data.truncated && (
        <p className="mt-3 text-xs text-muted-foreground">Additional values are not shown.</p>
      )}
    </section>
  );
}

function displayDimension(value: string) {
  if (value === "direct") return "Direct";
  if (value === "unknown") return "Unknown";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function AnalyticsSkeleton() {
  return (
    <div className="h-80 animate-pulse rounded-xl border bg-muted" aria-label="Loading Analytics" />
  );
}
