import { createD1LinksPersistence } from "@shortflare/database";
import { createLinks } from "@shortflare/links";
import { Hono } from "hono";

import { hasCapability } from "./access-control";
import type { ManagementDependencies } from "./dependencies";
import type { ManagementEnvironment } from "./environment";
import { createIdentity, type Identity } from "./modules/identity";
import { createIdentityHttpRoutes } from "./modules/identity/http/routes";
import { createLinksHttpRoutes } from "./modules/links/http/routes";
import { healthResponse } from "./request-schemas";
import type { RequestAuthentication } from "./transport/request-authentication";

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
    return context.json({ ok: false, kind: "internal-error", details: {} } as const, 500);
  });

  app.get("/api/internal/health", (context) =>
    context.json(healthResponse.parse({ status: "ok" })),
  );
  app.route("/api/internal", createIdentityHttpRoutes(dependencies));
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
  createRequestAuthentication: (bindings) =>
    createRequestAuthentication(createIdentity({ db: bindings.DB })),
  hasCapability,
};

export const app = createManagementApp(productionDependencies);

function createRequestAuthentication(identity: Identity): RequestAuthentication {
  return {
    async authenticateSafe(sessionToken) {
      const result = await identity.sessions.authenticate(sessionToken);
      return result.ok ? { ok: true, user: result.user } : { ok: false, kind: "unauthenticated" };
    },
    async authenticateMutation(input) {
      const result = await identity.sessions.authenticateRequest(
        input.sessionToken,
        input.csrfToken,
      );
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
}
