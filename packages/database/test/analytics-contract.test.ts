import { env } from "cloudflare:workers";
import { createAnalytics, type ClickEvent } from "@shortflare/analytics";
import { beforeEach, describe, expect, it } from "vitest";

import { createD1AnalyticsPersistence } from "../src/index";
import { resetDatabase } from "./reset-database";

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

describe("D1 Analytics persistence contract", () => {
  beforeEach(async () => {
    await resetDatabase();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO links
           (id, title, search_title, state, revision, created_at, updated_at)
         VALUES ('link-1', 'Title', 'title', 'active', 0, 0, 0)`,
      ),
      env.DB.prepare(
        `INSERT INTO destination_versions
           (id, link_id, version_number, destination, created_at)
         VALUES ('destination-1', 'link-1', 1, 'https://example.com', 0)`,
      ),
      env.DB.prepare(
        `INSERT INTO links
           (id, title, search_title, state, revision, created_at, updated_at)
         VALUES ('link-2', 'Second', 'second', 'active', 0, 0, 0)`,
      ),
      env.DB.prepare(
        `INSERT INTO destination_versions
           (id, link_id, version_number, destination, created_at)
         VALUES ('destination-2', 'link-2', 1, 'https://example.net', 0)`,
      ),
    ]);
  });

  it("persists idempotent raw events and queryable rollups atomically", async () => {
    const analytics = createAnalytics({
      persistence: createD1AnalyticsPersistence(env.DB),
      now: () => new Date("2026-08-10T00:00:00.000Z"),
    });
    const second = event({
      eventId: "event-2",
      occurredAt: "2026-08-09T12:20:00.000Z",
    });

    await expect(analytics.ingest([event(), second])).resolves.toEqual([
      { kind: "ingested", eventId: "event-1" },
      { kind: "ingested", eventId: "event-2" },
    ]);
    await expect(analytics.ingest([event()])).resolves.toEqual([
      { kind: "duplicate", eventId: "event-1" },
    ]);
    await expect(analytics.ingest([event({ country: "US" })])).resolves.toEqual([
      { kind: "rejected", eventId: "event-1", reason: "integrity-conflict" },
    ]);
    await expect(
      analytics.ingest([
        event({
          eventId: "wrong-destination-link",
          linkId: "link-2",
          destinationVersionId: "destination-1",
        }),
      ]),
    ).resolves.toEqual([
      { kind: "rejected", eventId: "wrong-destination-link", reason: "invalid-event" },
    ]);

    await expect(
      analytics.query({
        scope: { kind: "link", linkId: "link-1" },
        granularity: "hour",
        start: new Date("2026-08-09T12:00:00.000Z"),
        end: new Date("2026-08-09T13:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      summary: { humanClicks: 2, uniqueHumanClicks: 1, suspectedBotClicks: 0 },
    });
  });

  it("groups Instance top links by Link and restores one UTC day from raw events", async () => {
    const analytics = createAnalytics({
      persistence: createD1AnalyticsPersistence(env.DB),
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      randomId: () => "analytics-audit-1",
    });
    await analytics.ingest([
      event(),
      event({ eventId: "event-2", occurredAt: "2026-08-09T12:20:00.000Z" }),
      event({
        eventId: "event-3",
        linkId: "link-2",
        destinationVersionId: "destination-2",
      }),
    ]);

    await expect(
      analytics.query({
        scope: { kind: "instance" },
        granularity: "day",
        start: new Date("2026-08-09T00:00:00.000Z"),
        end: new Date("2026-08-10T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      topLinks: {
        items: [
          { value: "link-1", humanClicks: 2 },
          { value: "link-2", humanClicks: 1 },
        ],
      },
    });

    // Simulate a corrupted derived day while preserving the authoritative raw events.
    await env.DB.prepare(
      "DELETE FROM analytics_rollups WHERE link_id = 'link-1' AND bucket >= ? AND bucket < ?",
    )
      .bind(
        new Date("2026-08-09T00:00:00.000Z").getTime(),
        new Date("2026-08-10T00:00:00.000Z").getTime(),
      )
      .run();

    await expect(
      analytics.execute({
        kind: "recalculate",
        linkId: "link-1",
        date: new Date("2026-08-09T00:00:00.000Z"),
        actor: { id: "administrator-1" },
      }),
    ).resolves.toEqual({
      kind: "completed",
      affectedEvents: 2,
      auditId: "analytics-audit-1",
    });
    await expect(
      analytics.query({
        scope: { kind: "link", linkId: "link-1" },
        granularity: "day",
        start: new Date("2026-08-09T00:00:00.000Z"),
        end: new Date("2026-08-10T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      summary: { humanClicks: 2, uniqueHumanClicks: 1, suspectedBotClicks: 0 },
    });
  });

  it("erases retained Daily Rollups after their raw events expire", async () => {
    const analytics = createAnalytics({
      persistence: createD1AnalyticsPersistence(env.DB),
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      randomId: () => "analytics-erase-audit",
    });
    await analytics.ingest([event({ occurredAt: "2026-05-01T12:14:00.000Z" })]);
    await analytics.execute({ kind: "expire" });

    await expect(
      analytics.execute({
        kind: "erase",
        scope: { kind: "link", linkId: "link-1" },
        actor: { id: "administrator-1" },
      }),
    ).resolves.toEqual({
      kind: "completed",
      affectedEvents: 0,
      auditId: "analytics-erase-audit",
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
      summary: { humanClicks: 0, uniqueHumanClicks: 0, suspectedBotClicks: 0 },
    });
  });
});
