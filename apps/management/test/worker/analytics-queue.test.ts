import { createAnalytics, type ClickEvent } from "@shortflare/analytics";
import { createD1AnalyticsPersistence } from "@shortflare/database";
import { env } from "cloudflare:workers";
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { worker } from "../../src/worker/index";
import { resetManagementDatabase } from "../support/management-database";

const event: ClickEvent = {
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
};

describe("Management Analytics Queue interface", () => {
  beforeEach(async () => {
    await resetManagementDatabase();
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
    ]);
  });

  it("acknowledges valid events while retrying only rejected batch members", async () => {
    const batch = createMessageBatch("shortflare-events", [
      { id: "message-valid", timestamp: new Date(), attempts: 1, body: event },
      {
        id: "message-unsupported",
        timestamp: new Date(),
        attempts: 1,
        body: { schemaVersion: 2, eventId: "future-event" },
      },
    ]);
    const context = createExecutionContext();

    await worker.queue(batch, env);

    const result = await getQueueResult(batch, context);
    expect(result.explicitAcks).toEqual(["message-valid"]);
    expect(result.retryMessages).toEqual([{ msgId: "message-unsupported" }]);
    const analytics = createAnalytics({
      persistence: createD1AnalyticsPersistence(env.DB),
      now: () => new Date("2026-08-10T00:00:00.000Z"),
    });
    await expect(
      analytics.query({
        scope: { kind: "link", linkId: "link-1" },
        granularity: "hour",
        start: new Date("2026-08-09T12:00:00.000Z"),
        end: new Date("2026-08-09T13:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      summary: { humanClicks: 1, uniqueHumanClicks: 1, suspectedBotClicks: 0 },
    });
  });

  it("leaves the whole batch unacknowledged when shared D1 ingestion fails", async () => {
    const batch = createMessageBatch("shortflare-events", [
      { id: "message-one", timestamp: new Date(), attempts: 1, body: event },
      {
        id: "message-two",
        timestamp: new Date(),
        attempts: 1,
        body: { ...event, eventId: "event-2" },
      },
    ]);
    const context = createExecutionContext();
    await env.DB.prepare(
      `CREATE TRIGGER reject_analytics_ingestion
       BEFORE INSERT ON analytics_events
       BEGIN
         SELECT RAISE(ABORT, 'simulated shared D1 failure');
       END`,
    ).run();

    try {
      await expect(worker.queue(batch, env)).rejects.toThrow();
      const result = await getQueueResult(batch, context);
      expect(result.explicitAcks).toEqual([]);
      expect(result.retryMessages).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_analytics_ingestion").run();
    }
  });

  it("retries exhausted poison so the configured platform policy dead-letters it", async () => {
    const batch = createMessageBatch("shortflare-events", [
      {
        id: "message-poison",
        timestamp: new Date(),
        attempts: 4,
        body: { schemaVersion: 2, eventId: "future-event" },
      },
    ]);
    const context = createExecutionContext();

    await worker.queue(batch, env);

    const result = await getQueueResult(batch, context);
    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toEqual([{ msgId: "message-poison" }]);
  });
});
