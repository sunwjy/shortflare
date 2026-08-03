import { createMiddleware } from "hono/factory";

import type { ManagementEnvironment } from "../environment";

export const applySecurityHeaders = createMiddleware<ManagementEnvironment>(
  async (context, next) => {
    await next();
    context.header("Referrer-Policy", "no-referrer");
    if (context.req.path.startsWith("/api/")) {
      context.header("Cache-Control", "no-store");
    }
  },
);
