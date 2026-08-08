import { describe, expect, it } from "vitest";

import { createAnalytics, createInMemoryAnalyticsPersistence, type ClickEvent } from "../src/index";

function event(overrides: Partial<ClickEvent> = {}): ClickEvent {
  return {
    schemaVersion: 1,
    classificationVersion: 1,
    eventId: "event-1",
    linkId: "link-1",
    destinationVersionId: "destination-1",
    occurredAt: "2026-08-09T12:14:00.000Z",
    pseudonymousVisitor: "A".repeat(43),
    botClassification: "human",
    referrerDomain: "news.example.com",
    country: "KR",
    deviceCategory: "desktop",
    ...overrides,
  };
}

describe("Analytics interface", () => {
  it("ingests idempotently and reports fixed-bucket Human and Unique metrics", async () => {
    const analytics = createAnalytics({
      persistence: createInMemoryAnalyticsPersistence(),
      now: () => new Date("2026-08-10T00:00:00.000Z"),
    });

    await expect(
      analytics.ingest([
        event(),
        event({ eventId: "event-2", occurredAt: "2026-08-09T12:20:00.000Z" }),
        event({
          eventId: "event-3",
          occurredAt: "2026-08-09T12:31:00.000Z",
          referrerDomain: "direct",
        }),
        event({
          eventId: "event-4",
          occurredAt: "2026-08-09T12:32:00.000Z",
          botClassification: "suspected-bot",
          deviceCategory: "other",
        }),
      ]),
    ).resolves.toEqual([
      { kind: "ingested", eventId: "event-1" },
      { kind: "ingested", eventId: "event-2" },
      { kind: "ingested", eventId: "event-3" },
      { kind: "ingested", eventId: "event-4" },
    ]);

    await expect(analytics.ingest([event()])).resolves.toEqual([
      { kind: "duplicate", eventId: "event-1" },
    ]);

    await expect(
      analytics.query({
        scope: { kind: "link", linkId: "link-1" },
        granularity: "hour",
        start: new Date("2026-08-09T12:00:00.000Z"),
        end: new Date("2026-08-09T13:00:00.000Z"),
        limit: 10,
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      summary: { humanClicks: 3, uniqueHumanClicks: 2, suspectedBotClicks: 1 },
      series: [
        {
          bucket: "2026-08-09T12:00:00.000Z",
          humanClicks: 3,
          uniqueHumanClicks: 2,
          suspectedBotClicks: 1,
        },
      ],
      breakdowns: {
        referrer: {
          items: [
            {
              value: "news.example.com",
              humanClicks: 2,
              uniqueHumanClicks: 1,
              suspectedBotClicks: 0,
            },
            {
              value: "direct",
              humanClicks: 1,
              uniqueHumanClicks: 1,
              suspectedBotClicks: 0,
            },
          ],
          truncated: false,
        },
        bot: {
          items: [
            {
              value: "human",
              humanClicks: 3,
              uniqueHumanClicks: 0,
              suspectedBotClicks: 0,
            },
            {
              value: "suspected-bot",
              humanClicks: 0,
              uniqueHumanClicks: 0,
              suspectedBotClicks: 1,
            },
          ],
          truncated: false,
        },
      },
    });
  });

  it("isolates invalid events and Event ID integrity conflicts", async () => {
    const analytics = createAnalytics({ persistence: createInMemoryAnalyticsPersistence() });

    await analytics.ingest([event()]);
    await expect(
      analytics.ingest([
        { schemaVersion: 2, eventId: "future" },
        event({ eventId: "x".repeat(129) }),
        event({ eventId: "full-referrer", referrerDomain: "https://example.com/private" }),
        event({ eventId: "event-1", country: "US" }),
        event({ eventId: "event-2" }),
      ]),
    ).resolves.toEqual([
      { kind: "rejected", eventId: "future", reason: "unsupported-schema" },
      { kind: "rejected", eventId: "x".repeat(129), reason: "invalid-event" },
      { kind: "rejected", eventId: "full-referrer", reason: "invalid-event" },
      { kind: "rejected", eventId: "event-1", reason: "integrity-conflict" },
      { kind: "ingested", eventId: "event-2" },
    ]);
  });

  it("retains Daily Rollups after expiry and rejects recalculation without complete raw data", async () => {
    const analytics = createAnalytics({
      persistence: createInMemoryAnalyticsPersistence(),
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      randomId: () => "audit-1",
    });
    await analytics.ingest([
      event({ occurredAt: "2026-05-01T12:14:00.000Z" }),
      event({ eventId: "event-2", occurredAt: "2026-08-09T12:14:00.000Z" }),
    ]);

    await expect(analytics.execute({ kind: "expire" })).resolves.toEqual({
      kind: "completed",
      affectedEvents: 1,
    });
    await expect(
      analytics.query({
        scope: { kind: "link", linkId: "link-1" },
        granularity: "day",
        start: new Date("2026-05-01T00:00:00.000Z"),
        end: new Date("2026-05-02T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      summary: { humanClicks: 1, uniqueHumanClicks: 1, suspectedBotClicks: 0 },
    });
    await expect(
      analytics.execute({
        kind: "recalculate",
        linkId: "link-1",
        date: new Date("2026-05-01T00:00:00.000Z"),
        actor: { id: "administrator-1" },
      }),
    ).resolves.toEqual({ kind: "incomplete-raw" });
  });

  it("erases one Link without removing other Instance analytics", async () => {
    const analytics = createAnalytics({
      persistence: createInMemoryAnalyticsPersistence(),
      randomId: () => "audit-1",
    });
    await analytics.ingest([
      event(),
      event({
        eventId: "event-2",
        linkId: "link-2",
        destinationVersionId: "destination-2",
      }),
    ]);

    await expect(
      analytics.execute({
        kind: "erase",
        scope: { kind: "link", linkId: "link-1" },
        actor: { id: "administrator-1" },
      }),
    ).resolves.toEqual({ kind: "completed", affectedEvents: 1, auditId: "audit-1" });
    await expect(
      analytics.query({
        scope: { kind: "link", linkId: "link-1" },
        granularity: "day",
        start: new Date("2026-08-09T00:00:00.000Z"),
        end: new Date("2026-08-10T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      summary: { humanClicks: 0, uniqueHumanClicks: 0, suspectedBotClicks: 0 },
    });
    await expect(
      analytics.query({
        scope: { kind: "instance" },
        granularity: "day",
        start: new Date("2026-08-09T00:00:00.000Z"),
        end: new Date("2026-08-10T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      summary: { humanClicks: 1, uniqueHumanClicks: 1, suspectedBotClicks: 0 },
    });
  });
});
