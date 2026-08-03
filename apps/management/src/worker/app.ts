import { createD1LinksPersistence } from "@shortflare/database";
import { createLinks } from "@shortflare/links";
import { Hono } from "hono";

import { hasCapability } from "./access-control";
import type { ManagementDependencies } from "./dependencies";
import type { ManagementEnvironment } from "./environment";
import { apiError } from "./http";
import { createIdentity } from "./identity";
import { createLinksHttpRoutes } from "./modules/links/http/routes";
import { healthResponse } from "./request-schemas";
import { createAuthRoutes } from "./routes/auth";
import { createUserRoutes } from "./routes/users";

export function createManagementApp(dependencies: ManagementDependencies) {
  const app = new Hono<ManagementEnvironment>();

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

  app.get("/api/internal/health", (context) =>
    context.json(healthResponse.parse({ status: "ok" })),
  );
  app.route("/api/internal/auth", createAuthRoutes(dependencies));
  app.route("/api/internal/users", createUserRoutes(dependencies));
  app.route("/api/internal", createLinksHttpRoutes(dependencies));

  return app;
}

const productionDependencies: ManagementDependencies = {
  createIdentity: (bindings) => createIdentity({ db: bindings.DB }),
  createLinks: (bindings) =>
    createLinks({
      persistence: createD1LinksPersistence(bindings.DB),
      redirectDomain: bindings.REDIRECT_DOMAIN,
    }),
  createRequestAuthentication: (bindings) => {
    const identity = createIdentity({ db: bindings.DB });
    return {
      async authenticateSafe(sessionToken) {
        const result = await identity.authenticate(sessionToken);
        return result.ok ? { ok: true, user: result.user } : { ok: false, kind: "unauthenticated" };
      },
      async authenticateMutation(input) {
        const result = await identity.authenticateRequest(input.sessionToken, input.csrfToken);
        if (!result.ok) {
          return {
            ok: false,
            kind: result.kind === "invalid-credentials" ? "unauthenticated" : result.kind,
          };
        }
        return {
          ok: true,
          user: result.user,
          recentlyAuthenticated: result.recentlyAuthenticated,
        };
      },
    };
  },
  hasCapability,
};

export const app = createManagementApp(productionDependencies);
