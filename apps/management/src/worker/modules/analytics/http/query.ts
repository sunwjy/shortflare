import type { AnalyticsQuery } from "@shortflare/analytics";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAXIMUM_RANGE_MS = 366 * DAY_MS;

export function parseAnalyticsQuery(request: Request): Omit<AnalyticsQuery, "scope"> | undefined {
  const parameters = new URL(request.url).searchParams;
  const allowed = new Set(["start", "end", "granularity", "limit"]);
  if (Array.from(parameters.keys()).some((key) => !allowed.has(key))) return undefined;

  const start = one(parameters, "start");
  const end = one(parameters, "end");
  const granularity = one(parameters, "granularity");
  const limitValue = one(parameters, "limit");
  if (start === null || end === null || granularity === null || limitValue === null) {
    return undefined;
  }
  if (start === undefined || end === undefined) return undefined;
  if (granularity !== "hour" && granularity !== "day") return undefined;

  const startDate = parseIsoDate(start);
  const endDate = parseIsoDate(end);
  if (startDate === undefined || endDate === undefined) return undefined;
  const duration = endDate.getTime() - startDate.getTime();
  if (duration <= 0 || duration > MAXIMUM_RANGE_MS) return undefined;

  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  if (startDate >= tomorrow || endDate > tomorrow) return undefined;

  const limit = limitValue === undefined ? undefined : parseLimit(limitValue);
  if (limitValue !== undefined && limit === undefined) return undefined;
  return {
    start: startDate,
    end: endDate,
    granularity,
    ...(limit === undefined ? {} : { limit }),
  };
}

function one(parameters: URLSearchParams, name: string): string | undefined | null {
  const values = parameters.getAll(name);
  return values.length > 1 ? null : values[0];
}

function parseIsoDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date : undefined;
}

function parseLimit(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit <= 50 ? limit : undefined;
}
