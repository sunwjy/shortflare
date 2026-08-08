import type { ClickEvent } from "./click-analytics";

export const HALF_HOUR_MS = 30 * 60 * 1_000;
export const HOUR_MS = 60 * 60 * 1_000;
export const DAY_MS = 24 * HOUR_MS;
export const RAW_RETENTION_MS = 90 * DAY_MS;

export type AnalyticsDimension = "total" | "referrer" | "country" | "device" | "bot";
type UniqueDimension = Exclude<AnalyticsDimension, "bot">;
export type EventDimension =
  | Readonly<{ dimension: UniqueDimension; value: string; uniqueEligible: true }>
  | Readonly<{ dimension: AnalyticsDimension; value: string; uniqueEligible: false }>;

export function eventDimensions(event: ClickEvent): readonly EventDimension[] {
  return event.botClassification === "human"
    ? [
        { dimension: "total", value: "all", uniqueEligible: true },
        { dimension: "referrer", value: event.referrerDomain, uniqueEligible: true },
        { dimension: "country", value: event.country, uniqueEligible: true },
        { dimension: "device", value: event.deviceCategory, uniqueEligible: true },
        { dimension: "bot", value: "human", uniqueEligible: false },
      ]
    : [{ dimension: "bot", value: "suspected-bot", uniqueEligible: false }];
}

export function analyticsDimensionValue(
  event: ClickEvent,
  dimension: AnalyticsDimension,
): string | null {
  return (
    eventDimensions(event).find((candidate) => candidate.dimension === dimension)?.value ?? null
  );
}

export function sameClickEvent(left: ClickEvent, right: ClickEvent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function halfHourBucket(date: Date): number {
  return Math.floor(date.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS;
}

export function uniqueVisitorKey(event: ClickEvent, scopeId: string): string {
  return `${scopeId}\u0000${halfHourBucket(new Date(event.occurredAt))}\u0000${event.pseudonymousVisitor}`;
}

export function intervalBucket(date: Date, interval: "hour" | "day"): number {
  const size = interval === "hour" ? HOUR_MS : DAY_MS;
  return Math.floor(date.getTime() / size) * size;
}
