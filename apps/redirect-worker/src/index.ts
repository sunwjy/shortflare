import { Hono } from "hono";

interface IntegrationProbeEvent {
  eventId: string;
  emittedAt: string;
}

interface Bindings {
  ANALYTICS_QUEUE: Queue<IntegrationProbeEvent>;
  ENABLE_INTEGRATION_PROBES?: string;
}

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (context) => context.text("Shortflare is installed."));

app.post("/__shortflare/integration/queue/:eventId", async (context) => {
  if (context.env.ENABLE_INTEGRATION_PROBES !== "true") {
    return context.notFound();
  }

  const eventId = context.req.param("eventId");
  await context.env.ANALYTICS_QUEUE.send({
    eventId,
    emittedAt: new Date().toISOString(),
  });

  return context.json({ eventId, status: "queued" }, 202);
});

export default app;
