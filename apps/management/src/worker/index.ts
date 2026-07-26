import { Hono } from "hono";
import { z } from "zod";

const healthResponse = z.object({ status: z.literal("ok") });
export const app = new Hono();

app.get("/api/internal/health", (context) => context.json(healthResponse.parse({ status: "ok" })));

export default app;
