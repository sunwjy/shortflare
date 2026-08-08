import type {
  AnalyticsBreakdown,
  AnalyticsBreakdownItem,
  AnalyticsPersistence,
  AnalyticsQueryResult,
} from "@shortflare/analytics";
import { DAY_MS, HOUR_MS } from "@shortflare/analytics/event-policy";
import { and, eq, gte, lt } from "drizzle-orm";

import type { ShortflareDatabase } from "../d1";
import * as databaseSchema from "../schema";

type Dimension = "total" | "referrer" | "country" | "device" | "bot";
type Rollup = typeof databaseSchema.analyticsRollups.$inferSelect;

export async function queryD1Analytics(
  database: ShortflareDatabase,
  query: Parameters<AnalyticsPersistence["query"]>[0],
): Promise<AnalyticsQueryResult> {
  const scopeKind = query.scope.kind === "destination-version" ? "destination-version" : "link";
  const scopeId =
    query.scope.kind === "instance"
      ? undefined
      : query.scope.kind === "link"
        ? query.scope.linkId
        : query.scope.destinationVersionId;
  if (query.scope.kind !== "instance" && !(await analyticsScopeExists(database, query.scope))) {
    return { kind: "not-found" };
  }
  const conditions = [
    eq(databaseSchema.analyticsRollups.scopeKind, scopeKind),
    eq(databaseSchema.analyticsRollups.interval, query.granularity),
    gte(databaseSchema.analyticsRollups.bucket, query.start),
    lt(databaseSchema.analyticsRollups.bucket, query.end),
  ];
  if (scopeId !== undefined) {
    conditions.push(eq(databaseSchema.analyticsRollups.scopeId, scopeId));
  }
  const rows = await database
    .select()
    .from(databaseSchema.analyticsRollups)
    .where(and(...conditions));
  const summary = summarize(rows);
  const size = query.granularity === "hour" ? HOUR_MS : DAY_MS;
  const series = [];
  for (let time = query.start.getTime(); time < query.end.getTime(); time += size) {
    series.push({
      bucket: new Date(time).toISOString(),
      ...summarize(rows.filter(({ bucket }) => bucket.getTime() === time)),
    });
  }
  const breakdown = (dimension: Dimension): AnalyticsBreakdown =>
    groupRows(rows, query.limit, (row) =>
      row.dimension === dimension ? row.dimensionValue : null,
    );
  return {
    kind: "ok",
    summary,
    series,
    breakdowns: {
      referrer: breakdown("referrer"),
      country: breakdown("country"),
      device: breakdown("device"),
      bot: breakdown("bot"),
    },
    topLinks:
      query.scope.kind === "instance"
        ? groupRows(rows, query.limit, (row) => (row.dimension === "total" ? row.scopeId : null))
        : { items: [], truncated: false },
  };
}

async function analyticsScopeExists(
  database: ShortflareDatabase,
  scope: Exclude<Parameters<AnalyticsPersistence["query"]>[0]["scope"], { kind: "instance" }>,
) {
  if (scope.kind === "link") {
    return (
      (
        await database
          .select({ id: databaseSchema.links.id })
          .from(databaseSchema.links)
          .where(eq(databaseSchema.links.id, scope.linkId))
          .limit(1)
      ).length === 1
    );
  }
  return (
    (
      await database
        .select({ id: databaseSchema.destinationVersions.id })
        .from(databaseSchema.destinationVersions)
        .where(
          and(
            eq(databaseSchema.destinationVersions.id, scope.destinationVersionId),
            eq(databaseSchema.destinationVersions.linkId, scope.linkId),
          ),
        )
        .limit(1)
    ).length === 1
  );
}

function summarize(rows: readonly Rollup[]) {
  return {
    humanClicks: rows
      .filter(({ dimension }) => dimension === "total")
      .reduce((sum, { humanClicks }) => sum + humanClicks, 0),
    uniqueHumanClicks: rows
      .filter(({ dimension }) => dimension === "total")
      .reduce((sum, { uniqueHumanClicks }) => sum + uniqueHumanClicks, 0),
    suspectedBotClicks: rows
      .filter(
        ({ dimension, dimensionValue }) =>
          dimension === "bot" && dimensionValue === "suspected-bot",
      )
      .reduce((sum, { suspectedBotClicks }) => sum + suspectedBotClicks, 0),
  };
}

function groupRows(
  rows: readonly Rollup[],
  limit: number,
  keyFor: (row: Rollup) => string | null,
): AnalyticsBreakdown {
  const groups = new Map<string, Rollup[]>();
  for (const row of rows) {
    const key = keyFor(row);
    if (key === null) continue;
    const values = groups.get(key) ?? [];
    values.push(row);
    groups.set(key, values);
  }
  const items: AnalyticsBreakdownItem[] = [...groups].map(([value, values]) => ({
    value,
    ...sumAll(values),
  }));
  items.sort(
    (left, right) => right.humanClicks - left.humanClicks || left.value.localeCompare(right.value),
  );
  return { items: items.slice(0, limit), truncated: items.length > limit };
}

function sumAll(rows: readonly Rollup[]) {
  return rows.reduce(
    (result, row) => ({
      humanClicks: result.humanClicks + row.humanClicks,
      uniqueHumanClicks: result.uniqueHumanClicks + row.uniqueHumanClicks,
      suspectedBotClicks: result.suspectedBotClicks + row.suspectedBotClicks,
    }),
    { humanClicks: 0, uniqueHumanClicks: 0, suspectedBotClicks: 0 },
  );
}
