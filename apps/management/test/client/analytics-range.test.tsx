import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  analyticsRequestRange,
  normalizeAnalyticsSearch,
} from "../../src/client/features/analytics/analytics-range";

describe("Analytics URL date range", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T14:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the seven UTC dates ending today when URL state is omitted", () => {
    expect(analyticsRequestRange(normalizeAnalyticsSearch({}))).toEqual({
      start: "2026-08-03T00:00:00.000Z",
      end: "2026-08-10T00:00:00.000Z",
      granularity: "day",
      label: "Aug 3–9, 2026 UTC",
    });
  });

  it("turns an inclusive custom UTC range into a half-open query", () => {
    const search = normalizeAnalyticsSearch({
      range: "custom",
      start: "2025-08-10",
      end: "2026-08-09",
      metric: "unique",
      bots: true,
    });

    expect(search).toEqual({
      range: "custom",
      start: "2025-08-10",
      end: "2026-08-09",
      metric: "unique",
      bots: true,
    });
    expect(analyticsRequestRange(search)).toMatchObject({
      start: "2025-08-10T00:00:00.000Z",
      end: "2026-08-10T00:00:00.000Z",
      granularity: "day",
    });
  });

  it("normalizes invalid and default URL values to the default state", () => {
    expect(
      normalizeAnalyticsSearch({
        range: "custom",
        start: "2025-08-08",
        end: "2026-08-09",
        metric: "human",
        bots: "false",
      }),
    ).toEqual({});
    expect(normalizeAnalyticsSearch({ range: "7d", metric: "human", bots: false })).toEqual({});
  });
});
