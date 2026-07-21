import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

describe("local Cloudflare integration", () => {
  it("delivers a Redirect Worker event through Queue to Management and shared D1", async () => {
    const eventId = crypto.randomUUID();
    const emitResponse = await SELF.fetch(
      `https://short.test/__shortflare/integration/queue/${eventId}`,
      { method: "POST" },
    );

    expect(emitResponse.status).toBe(202);
    expect(await emitResponse.json()).toEqual({ eventId, status: "queued" });

    const storedEvent = await vi.waitUntil(
      async () => {
        const response = await env.MANAGEMENT.fetch(
          `https://management.test/api/internal/integration/queue/${eventId}`,
        );

        if (!response.ok) return undefined;
        return response.json();
      },
      { interval: 25, timeout: 2_000 },
    );

    expect(storedEvent).toEqual({
      consumedAt: expect.any(String),
      emittedAt: expect.any(String),
      eventId,
    });
  });
});
