export type AnalyticsRangePreset = "today" | "7d" | "30d" | "90d" | "custom";
export type AnalyticsMetric = "human" | "unique";

export type AnalyticsSearch = Readonly<{
  range?: AnalyticsRangePreset;
  start?: string;
  end?: string;
  metric?: AnalyticsMetric;
  bots?: true;
}>;

export type AnalyticsRequestRange = Readonly<{
  start: string;
  end: string;
  granularity: "hour" | "day";
  label: string;
}>;

const DAY_MS = 24 * 60 * 60 * 1_000;

export function normalizeAnalyticsSearch(
  raw: Readonly<Record<string, unknown>>,
  now = new Date(),
): AnalyticsSearch {
  const range = isRangePreset(raw.range) ? raw.range : "7d";
  const metric = raw.metric === "unique" ? "unique" : "human";
  const bots = raw.bots === true || raw.bots === "true";

  if (range === "custom") {
    const start = typeof raw.start === "string" ? parseUtcDate(raw.start) : undefined;
    const end = typeof raw.end === "string" ? parseUtcDate(raw.end) : undefined;
    const today = utcDay(now);
    if (
      start === undefined ||
      end === undefined ||
      start > end ||
      end > today ||
      end.getTime() - start.getTime() >= 366 * DAY_MS
    ) {
      return {};
    }
    return {
      range,
      start: formatUtcDate(start),
      end: formatUtcDate(end),
      ...(metric === "unique" ? { metric } : {}),
      ...(bots ? { bots: true as const } : {}),
    };
  }

  return {
    ...(range === "7d" ? {} : { range }),
    ...(metric === "unique" ? { metric } : {}),
    ...(bots ? { bots: true as const } : {}),
  };
}

export function analyticsRequestRange(
  search: AnalyticsSearch,
  now = new Date(),
): AnalyticsRequestRange {
  const today = utcDay(now);
  const range = search.range ?? "7d";
  const start =
    range === "custom"
      ? (parseUtcDate(search.start ?? "") ?? today)
      : new Date(today.getTime() - (presetDays(range) - 1) * DAY_MS);
  const inclusiveEnd = range === "custom" ? (parseUtcDate(search.end ?? "") ?? today) : today;
  const end = new Date(inclusiveEnd.getTime() + DAY_MS);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    granularity: range === "today" ? "hour" : "day",
    label: formatRangeLabel(start, inclusiveEnd),
  };
}

function isRangePreset(value: unknown): value is AnalyticsRangePreset {
  return (
    value === "today" || value === "7d" || value === "30d" || value === "90d" || value === "custom"
  );
}

function presetDays(range: Exclude<AnalyticsRangePreset, "custom">): number {
  return { today: 1, "7d": 7, "30d": 30, "90d": 90 }[range];
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseUtcDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && formatUtcDate(parsed) === value ? parsed : undefined;
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatRangeLabel(start: Date, end: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const year = end.getUTCFullYear();
  if (start.getTime() === end.getTime()) {
    return `${formatter.format(end)}, ${year} UTC`;
  }
  const sameMonth = start.getUTCFullYear() === year && start.getUTCMonth() === end.getUTCMonth();
  const startLabel = formatter.format(start);
  const endLabel = sameMonth ? String(end.getUTCDate()) : formatter.format(end);
  const startYear = start.getUTCFullYear() === year ? "" : `, ${start.getUTCFullYear()}`;
  return `${startLabel}${startYear}–${endLabel}, ${year} UTC`;
}
