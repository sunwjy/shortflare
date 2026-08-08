import type {
  AnalyticsBreakdown,
  AnalyticsBreakdownItem,
  AnalyticsQueryResult,
  AnalyticsScope,
  AnalyticsSummary,
} from "./analytics";
import type { ClickEvent } from "./click-analytics";
import { DAY_MS } from "./event-policy";
import { buildInMemoryResult } from "./in-memory-analytics-results";
import type { ValidatedAnalyticsQuery } from "./persistence";

type OkResult = Extract<AnalyticsQueryResult, { kind: "ok" }>;
export type RetainedDailyRollup = Readonly<{
  linkId: string;
  scope: AnalyticsScope;
  day: number;
  result: OkResult;
}>;

const emptySummary = (): AnalyticsSummary => ({
  humanClicks: 0,
  uniqueHumanClicks: 0,
  suspectedBotClicks: 0,
});

export function retainDailyRollups(
  retained: Map<string, RetainedDailyRollup>,
  events: readonly ClickEvent[],
) {
  const days = new Map<number, ClickEvent[]>();
  for (const event of events) {
    const day = Math.floor(new Date(event.occurredAt).getTime() / DAY_MS) * DAY_MS;
    const values = days.get(day) ?? [];
    values.push(event);
    days.set(day, values);
  }
  for (const [day, dayEvents] of days) {
    const links = new Map<string, ClickEvent[]>();
    for (const event of dayEvents) {
      const values = links.get(event.linkId) ?? [];
      values.push(event);
      links.set(event.linkId, values);
    }
    for (const [linkId, linkEvents] of links) {
      for (const scope of scopesFor(linkEvents)) {
        const result = buildInMemoryResult(linkEvents, {
          scope,
          granularity: "day",
          start: new Date(day),
          end: new Date(day + DAY_MS),
          limit: Number.MAX_SAFE_INTEGER,
        });
        if (result.kind !== "ok") throw new Error("Daily rollup derivation must succeed");
        const key = retainedKey(scope, day, linkId);
        const existing = retained.get(key);
        retained.set(key, {
          linkId,
          scope,
          day,
          result: existing === undefined ? result : mergeOkResults(existing.result, result),
        });
      }
    }
  }
}

function scopesFor(events: readonly ClickEvent[]): AnalyticsScope[] {
  return [
    { kind: "instance" },
    ...[...new Set(events.map(({ linkId }) => linkId))].map((linkId) => ({
      kind: "link" as const,
      linkId,
    })),
    ...new Map(
      events.map((event) => [
        `${event.linkId}\u0000${event.destinationVersionId}`,
        {
          kind: "destination-version" as const,
          linkId: event.linkId,
          destinationVersionId: event.destinationVersionId,
        },
      ]),
    ).values(),
  ];
}

export function mergeRetainedRollups(
  live: AnalyticsQueryResult,
  retained: Iterable<RetainedDailyRollup>,
  query: ValidatedAnalyticsQuery,
): AnalyticsQueryResult {
  if (live.kind !== "ok") return live;
  let merged = live;
  for (const rollup of retained) {
    if (
      rollup.day >= query.start.getTime() &&
      rollup.day < query.end.getTime() &&
      scopesMatch(rollup.scope, query.scope)
    ) {
      merged = mergeOkResults(merged, rollup.result);
    }
  }
  return limitResult(merged, query.limit);
}

function mergeOkResults(left: OkResult, right: OkResult): OkResult {
  return {
    kind: "ok",
    summary: addSummary(left.summary, right.summary),
    series: mergeItems(left.series, right.series, (item) => item.bucket).map(
      ({ value: bucket, ...summary }) => ({ bucket, ...summary }),
    ),
    breakdowns: {
      referrer: mergeBreakdowns(left.breakdowns.referrer, right.breakdowns.referrer),
      country: mergeBreakdowns(left.breakdowns.country, right.breakdowns.country),
      device: mergeBreakdowns(left.breakdowns.device, right.breakdowns.device),
      bot: mergeBreakdowns(left.breakdowns.bot, right.breakdowns.bot),
    },
    topLinks: mergeBreakdowns(left.topLinks, right.topLinks),
  };
}

function mergeBreakdowns(left: AnalyticsBreakdown, right: AnalyticsBreakdown): AnalyticsBreakdown {
  return {
    items: mergeItems(left.items, right.items, (item) => item.value),
    truncated: false,
  };
}

function mergeItems<T extends AnalyticsSummary>(
  left: readonly T[],
  right: readonly T[],
  valueFor: (item: T) => string,
): AnalyticsBreakdownItem[] {
  const values = new Map<string, AnalyticsSummary>();
  for (const item of [...left, ...right]) {
    const value = valueFor(item);
    values.set(value, addSummary(values.get(value) ?? emptySummary(), item));
  }
  return [...values].map(([value, summary]) => ({ value, ...summary }));
}

function addSummary(left: AnalyticsSummary, right: AnalyticsSummary): AnalyticsSummary {
  return {
    humanClicks: left.humanClicks + right.humanClicks,
    uniqueHumanClicks: left.uniqueHumanClicks + right.uniqueHumanClicks,
    suspectedBotClicks: left.suspectedBotClicks + right.suspectedBotClicks,
  };
}

function limitResult(result: OkResult, limit: number): OkResult {
  const limitBreakdown = (breakdown: AnalyticsBreakdown): AnalyticsBreakdown => {
    const items = breakdown.items.toSorted(
      (left, right) =>
        right.humanClicks - left.humanClicks || left.value.localeCompare(right.value),
    );
    return { items: items.slice(0, limit), truncated: items.length > limit };
  };
  return {
    ...result,
    series: result.series.toSorted((left, right) => left.bucket.localeCompare(right.bucket)),
    breakdowns: {
      referrer: limitBreakdown(result.breakdowns.referrer),
      country: limitBreakdown(result.breakdowns.country),
      device: limitBreakdown(result.breakdowns.device),
      bot: limitBreakdown(result.breakdowns.bot),
    },
    topLinks: limitBreakdown(result.topLinks),
  };
}

function retainedKey(scope: AnalyticsScope, day: number, contributorLinkId: string): string {
  const scopeId =
    scope.kind === "instance"
      ? `instance:${contributorLinkId}`
      : scope.kind === "link"
        ? `link:${scope.linkId}`
        : `destination:${scope.linkId}:${scope.destinationVersionId}`;
  return `${scopeId}\u0000${day}`;
}

function scopesMatch(left: AnalyticsScope, right: AnalyticsScope): boolean {
  if (left.kind === "instance" || right.kind === "instance") {
    return left.kind === right.kind;
  }
  if (left.kind === "link" || right.kind === "link") {
    return left.kind === right.kind && left.linkId === right.linkId;
  }
  return left.linkId === right.linkId && left.destinationVersionId === right.destinationVersionId;
}
