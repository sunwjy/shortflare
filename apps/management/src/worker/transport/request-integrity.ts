import { createMiddleware } from "hono/factory";

import type { ManagementEnvironment } from "../environment";
import type { AuthenticationFailurePresenter } from "./authentication";

function isSameOriginJsonRequest(request: Request) {
  return (
    request.headers.get("origin") === new URL(request.url).origin &&
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
      "application/json"
  );
}

export function requireJsonRequestIntegrity(presentFailure: AuthenticationFailurePresenter) {
  return createMiddleware<ManagementEnvironment>(async (context, next) => {
    if (!isSameOriginJsonRequest(context.req.raw)) {
      return presentFailure(context, "forbidden", 403);
    }
    await next();
  });
}
