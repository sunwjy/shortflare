import { Hono } from "hono";

import type { ManagementEnvironment } from "./environment";
import { apiError } from "./http";
import { healthResponse } from "./request-schemas";
import { authRoutes } from "./routes/auth";
import { linkRoutes } from "./routes/links";
import { userRoutes } from "./routes/users";

export const app = new Hono<ManagementEnvironment>();

app.use("*", async (context, next) => {
  await next();
  context.header("Referrer-Policy", "no-referrer");
  if (context.req.path.startsWith("/api/")) {
    context.header("Cache-Control", "no-store");
  }
});

app.onError((error, context) => {
  console.error(error);
  return context.json(apiError("internal-error"), 500);
});

app.get("/api/internal/health", (context) => context.json(healthResponse.parse({ status: "ok" })));
app.route("/api/internal/auth", authRoutes);
app.route("/api/internal/users", userRoutes);
app.route("/api/internal", linkRoutes);

export default app;
