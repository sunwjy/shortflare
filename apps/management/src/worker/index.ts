import { Hono } from "hono";
import { z } from "zod";

interface IntegrationProbeEvent {
  eventId: string;
  emittedAt: string;
}

interface Bindings {
  DB: D1Database;
  ENABLE_INTEGRATION_PROBES?: string;
}

const healthResponse = z.object({ status: z.literal("ok") });
export const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/internal/health", (context) => context.json(healthResponse.parse({ status: "ok" })));

app.get("/api/internal/integration/queue/:eventId", async (context) => {
  if (context.env.ENABLE_INTEGRATION_PROBES !== "true") {
    return context.notFound();
  }

  const storedEvent = await context.env.DB.prepare(
    `SELECT
       event_id AS eventId,
       emitted_at AS emittedAt,
       consumed_at AS consumedAt
     FROM integration_probe_events
     WHERE event_id = ?`,
  )
    .bind(context.req.param("eventId"))
    .first<{ eventId: string; emittedAt: string; consumedAt: string }>();

  if (storedEvent === null) {
    return context.notFound();
  }

  return context.json(storedEvent);
});

async function consumeIntegrationProbes(batch: MessageBatch<IntegrationProbeEvent>, env: Bindings) {
  const consumedAt = new Date().toISOString();
  const statements = batch.messages.map((message) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO integration_probe_events
         (event_id, emitted_at, consumed_at)
       VALUES (?, ?, ?)`,
    ).bind(message.body.eventId, message.body.emittedAt, consumedAt),
  );

  await env.DB.batch(statements);

  for (const message of batch.messages) {
    message.ack();
  }
}

export default {
  fetch: app.fetch,
  queue: consumeIntegrationProbes,
} satisfies ExportedHandler<Bindings, IntegrationProbeEvent>;
