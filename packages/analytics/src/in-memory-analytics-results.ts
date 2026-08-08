import type {
  AnalyticsBreakdown,
  AnalyticsBreakdownItem,
  AnalyticsQueryResult,
  AnalyticsScope,
  AnalyticsSummary,
} from "./analytics";
import type { ClickEvent } from "./click-analytics";
import { analyticsDimensionValue, DAY_MS, HOUR_MS, uniqueVisitorKey } from "./event-policy";
import type { ValidatedAnalyticsQuery } from "./persistence";

type MutableMetrics = {
  humanClicks: number;
  uniqueHumanClicks: number;
  suspectedBotClicks: number;
  uniqueKeys: Set<string>;
};

const emptySummary = (): AnalyticsSummary => ({
  humanClicks: 0,
  uniqueHumanClicks: 0,
  suspectedBotClicks: 0,
});

export function buildInMemoryResult(
  allEvents: readonly ClickEvent[],
  query: ValidatedAnalyticsQuery,
): AnalyticsQueryResult {
  const start = query.start.getTime();
  const end = query.end.getTime();
  const filtered = allEvents.filter((event) => {
    const occurredAt = new Date(event.occurredAt).getTime();
    return occurredAt >= start && occurredAt < end && matchesScope(event, query.scope);
  });
  const summaryMetrics = aggregate(filtered, query.scope);
  const bucketSize = query.granularity === "hour" ? HOUR_MS : DAY_MS;
  const series = [];
  for (let bucket = start; bucket < end; bucket += bucketSize) {
    const bucketEvents = filtered.filter((event) => {
      const occurredAt = new Date(event.occurredAt).getTime();
      return occurredAt >= bucket && occurredAt < bucket + bucketSize;
    });
    series.push({
      bucket: new Date(bucket).toISOString(),
      ...toSummary(aggregate(bucketEvents, query.scope)),
    });
  }
  return {
    kind: "ok",
    summary: toSummary(summaryMetrics),
    series,
    breakdowns: {
      referrer: buildBreakdown(filtered, query.scope, query.limit, (event) =>
        analyticsDimensionValue(event, "referrer"),
      ),
      country: buildBreakdown(filtered, query.scope, query.limit, (event) =>
        analyticsDimensionValue(event, "country"),
      ),
      device: buildBreakdown(filtered, query.scope, query.limit, (event) =>
        analyticsDimensionValue(event, "device"),
      ),
      bot: buildBotBreakdown(filtered, query.scope, query.limit),
    },
    topLinks: buildTopLinks(allEvents, query),
  };
}

function matchesScope(event: ClickEvent, scope: AnalyticsScope): boolean {
  if (scope.kind === "instance") return true;
  if (scope.kind === "link") return event.linkId === scope.linkId;
  return event.linkId === scope.linkId && event.destinationVersionId === scope.destinationVersionId;
}

function aggregate(events: readonly ClickEvent[], scope: AnalyticsScope): MutableMetrics {
  const metrics: MutableMetrics = { ...emptySummary(), uniqueKeys: new Set() };
  for (const event of events) {
    if (analyticsDimensionValue(event, "total") === null) {
      metrics.suspectedBotClicks += 1;
      continue;
    }
    metrics.humanClicks += 1;
    const scopeId =
      scope.kind === "destination-version" ? event.destinationVersionId : event.linkId;
    metrics.uniqueKeys.add(uniqueVisitorKey(event, scopeId));
  }
  metrics.uniqueHumanClicks = metrics.uniqueKeys.size;
  return metrics;
}

function toSummary(metrics: MutableMetrics): AnalyticsSummary {
  return {
    humanClicks: metrics.humanClicks,
    uniqueHumanClicks: metrics.uniqueHumanClicks,
    suspectedBotClicks: metrics.suspectedBotClicks,
  };
}

function buildBreakdown(
  events: readonly ClickEvent[],
  scope: AnalyticsScope,
  limit: number,
  valueFor: (event: ClickEvent) => string | null,
): AnalyticsBreakdown {
  const groups = new Map<string, ClickEvent[]>();
  for (const event of events) {
    const value = valueFor(event);
    if (value === null) continue;
    const group = groups.get(value) ?? [];
    group.push(event);
    groups.set(value, group);
  }
  const items: AnalyticsBreakdownItem[] = [...groups].map(([value, group]) => ({
    value,
    ...toSummary(aggregate(group, scope)),
  }));
  items.sort(
    (left, right) => right.humanClicks - left.humanClicks || left.value.localeCompare(right.value),
  );
  return { items: items.slice(0, limit), truncated: items.length > limit };
}

function buildBotBreakdown(
  events: readonly ClickEvent[],
  scope: AnalyticsScope,
  limit: number,
): AnalyticsBreakdown {
  const breakdown = buildBreakdown(events, scope, limit, (event) =>
    analyticsDimensionValue(event, "bot"),
  );
  return {
    ...breakdown,
    items: breakdown.items.map((item) => ({ ...item, uniqueHumanClicks: 0 })),
  };
}

function buildTopLinks(
  events: readonly ClickEvent[],
  query: ValidatedAnalyticsQuery,
): AnalyticsBreakdown {
  if (query.scope.kind !== "instance") return { items: [], truncated: false };
  return buildBreakdown(
    events.filter((event) => {
      const occurredAt = new Date(event.occurredAt).getTime();
      return occurredAt >= query.start.getTime() && occurredAt < query.end.getTime();
    }),
    { kind: "instance" },
    query.limit,
    (event) => event.linkId,
  );
}
