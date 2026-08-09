import type { ManagementDependencies } from "../../../dependencies";
import { createAuthenticationMiddleware } from "../../../transport/authentication";
import { createManagementHono } from "../../../transport/factory";
import { parseAuditEventQuery } from "./query";

type AuditHttpDependencies = Pick<
  ManagementDependencies,
  "createAuditEvents" | "createRequestAuthentication" | "createRequestRateLimits" | "hasCapability"
>;

const presentAuthenticationFailure: Parameters<typeof createAuthenticationMiddleware>[1] = (
  context,
  kind,
  status,
) => context.json({ ok: false as const, kind, details: {} }, status);

export function createAuditHttpRoutes(dependencies: AuditHttpDependencies) {
  const routes = createManagementHono();
  const authentication = createAuthenticationMiddleware(dependencies, presentAuthenticationFailure);
  routes.get(
    "/audit-events",
    authentication.requireSafeSession(),
    authentication.requireCapability("view-audit-events"),
    async (context) => {
      const query = parseAuditEventQuery(context.req.raw);
      if (!query) return invalidQuery(context);
      const result = await dependencies.createAuditEvents(context.env).query(query);
      if (!result.ok) return invalidQuery(context);
      return context.json({
        ok: true as const,
        items: result.items.map((event) => ({
          ...event,
          occurredAt: event.occurredAt.toISOString(),
        })),
        nextCursor: result.nextCursor,
      });
    },
  );
  return routes;
}

function invalidQuery(context: Parameters<typeof presentAuthenticationFailure>[0]) {
  return context.json({ ok: false as const, kind: "invalid-query", details: {} }, 400);
}
