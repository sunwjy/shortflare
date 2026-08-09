import { createAnalytics } from "@shortflare/analytics";
import { createD1AnalyticsPersistence, createD1LinksPersistence } from "@shortflare/database";
import { createLinks } from "@shortflare/links";

import { hasCapability } from "./access-control";
import type { ManagementDependencies } from "./dependencies";
import { createIdentity, type Identity } from "./modules/identity";
import { createAnalyticsHttpRoutes } from "./modules/analytics/http/routes";
import { createIdentityHttpRoutes } from "./modules/identity/http/routes";
import { createLinksHttpRoutes } from "./modules/links/http/routes";
import { handleUnexpectedError } from "./transport/error-handler";
import { createManagementHono } from "./transport/factory";
import type { RequestAuthentication } from "./transport/request-authentication";
import { applySecurityHeaders } from "./transport/security-headers";

export function createManagementApp(dependencies: ManagementDependencies) {
  const app = createManagementHono();

  app.use("*", applySecurityHeaders);
  app.onError(handleUnexpectedError);
  app.get("/api/internal/health", (context) => context.json({ status: "ok" } as const));
  app.route("/api/internal", createIdentityHttpRoutes(dependencies));
  app.route("/api/internal", createLinksHttpRoutes(dependencies));
  app.route("/api/internal", createAnalyticsHttpRoutes(dependencies));

  return app;
}

const productionDependencies: ManagementDependencies = {
  createAnalytics: (bindings) =>
    createAnalytics({ persistence: createD1AnalyticsPersistence(bindings.DB) }),
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
