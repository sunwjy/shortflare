import { describe, expect, it } from "vitest";

import { createClickAnalytics, type ClickEvent, type ClickEventDelivery } from "../src/index";

const testKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function createDelivery(events: ClickEvent[]): ClickEventDelivery {
  return {
    async deliver(event) {
      events.push(event);
    },
  };
}

describe("Click Analytics interface", () => {
  it("records a normalized versioned event without retained request identifiers", async () => {
    const events: ClickEvent[] = [];
    const analytics = createClickAnalytics({
      hmacKey: testKey,
      delivery: createDelivery(events),
      now: () => new Date("2026-08-09T12:14:00.000Z"),
      randomId: () => "event-1",
    });

    await expect(
      analytics.record({
        linkId: "link-1",
        destinationVersionId: "destination-1",
        clientIp: "203.0.113.10",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
        referrer: "HTTPS://News.Example.COM:443/story?id=secret#fragment",
        country: "kr",
      }),
    ).resolves.toEqual({ kind: "recorded", eventId: "event-1" });

    expect(events).toEqual([
      {
        schemaVersion: 1,
        classificationVersion: 1,
        eventId: "event-1",
        linkId: "link-1",
        destinationVersionId: "destination-1",
        occurredAt: "2026-08-09T12:14:00.000Z",
        pseudonymousVisitor: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        botClassification: "human",
        referrerDomain: "news.example.com",
        country: "KR",
        deviceCategory: "desktop",
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("203.0.113.10");
    expect(JSON.stringify(events)).not.toContain("Mozilla");
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("scopes the Pseudonymous Visitor to one Link and UTC half-hour", async () => {
    const events: ClickEvent[] = [];
    let now = new Date("2026-08-09T12:29:59.000Z");
    const analytics = createClickAnalytics({
      hmacKey: testKey,
      delivery: createDelivery(events),
      now: () => now,
      randomId: () => `event-${events.length + 1}`,
    });
    const request = {
      destinationVersionId: "destination-1",
      clientIp: "203.0.113.10",
      userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36",
      referrer: null,
      country: null,
    } as const;

    await analytics.record({ ...request, linkId: "link-1" });
    await analytics.record({ ...request, linkId: "link-1" });
    await analytics.record({ ...request, linkId: "link-2" });
    now = new Date("2026-08-09T12:30:00.000Z");
    await analytics.record({ ...request, linkId: "link-1" });

    expect(events[0]?.pseudonymousVisitor).toBe(events[1]?.pseudonymousVisitor);
    expect(events[2]?.pseudonymousVisitor).not.toBe(events[0]?.pseudonymousVisitor);
    expect(events[3]?.pseudonymousVisitor).not.toBe(events[0]?.pseudonymousVisitor);
  });

  it("classifies missing metadata and automation without blocking delivery", async () => {
    const events: ClickEvent[] = [];
    const analytics = createClickAnalytics({
      hmacKey: testKey,
      delivery: createDelivery(events),
      now: () => new Date("2026-08-09T12:14:00.000Z"),
      randomId: () => `event-${events.length + 1}`,
    });

    await analytics.record({
      linkId: "link-1",
      destinationVersionId: "destination-1",
      clientIp: null,
      userAgent: null,
      referrer: null,
      country: "XX",
    });
    await analytics.record({
      linkId: "link-1",
      destinationVersionId: "destination-1",
      clientIp: "203.0.113.10",
      userAgent: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      referrer: "not a URL",
      country: "ZZ",
    });

    expect(events.map(({ botClassification }) => botClassification)).toEqual([
      "suspected-bot",
      "suspected-bot",
    ]);
    expect(events.map(({ referrerDomain }) => referrerDomain)).toEqual(["direct", "unknown"]);
    expect(events.map(({ country }) => country)).toEqual(["unknown", "unknown"]);
    expect(events.map(({ deviceCategory }) => deviceCategory)).toEqual(["unknown", "other"]);
  });
});
