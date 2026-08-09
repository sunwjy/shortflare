import type { AnalyticsQueryResult } from "@shortflare/analytics";

import type { ManagementDependencies } from "../../../dependencies";
import { createAuthenticationMiddleware } from "../../../transport/authentication";
import { createManagementHono } from "../../../transport/factory";
import { parseAnalyticsQuery } from "./query";

type AnalyticsHttpDependencies = Pick<
  ManagementDependencies,
  | "createAnalytics"
  | "createLinks"
  | "createRequestAuthentication"
  | "createRequestRateLimits"
  | "hasCapability"
>;

const presentAuthenticationFailure: Parameters<typeof createAuthenticationMiddleware>[1] = (
  context,
  kind,
  status,
) => context.json({ ok: false as const, kind, details: {} }, status);

export function createAnalyticsHttpRoutes(dependencies: AnalyticsHttpDependencies) {
  const routes = createManagementHono();
  const authentication = createAuthenticationMiddleware(dependencies, presentAuthenticationFailure);

  routes.get(
    "/analytics",
    authentication.requireSafeSession(),
    authentication.requireCapability("view-analytics"),
    async (context) => {
      const query = parseAnalyticsQuery(context.req.raw);
      if (query === undefined) return invalidQuery(context);
      const result = await dependencies
        .createAnalytics(context.env)
        .query({ ...query, scope: { kind: "instance" } });
      if (result.kind !== "ok") return analyticsFailure(context, result);

      const rankedIds = result.topLinks.items.map(({ value }) => value);
      const summaries = await dependencies
        .createLinks(context.env)
        .query({ kind: "summaries", linkIds: rankedIds }, { id: context.var.authenticatedUser.id });
      if (!summaries.ok || summaries.kind !== "summaries") {
        throw new Error("Links returned an unexpected Analytics composition result");
      }
      const displayById = new Map(summaries.items.map((link) => [link.id, link]));
      const { kind: _kind, ...analytics } = result;
      return context.json({
        ok: true as const,
        ...analytics,
        topLinks: {
          ...result.topLinks,
          items: result.topLinks.items.flatMap((item) => {
            const link = displayById.get(item.value);
            return link === undefined
              ? []
              : [
                  {
                    id: link.id,
                    alias: link.alias,
                    shortUrl: new URL(link.alias, `https://${context.env.REDIRECT_DOMAIN}/`).href,
                    title: link.title,
                    state: link.state,
                    humanClicks: item.humanClicks,
                    uniqueHumanClicks: item.uniqueHumanClicks,
                    suspectedBotClicks: item.suspectedBotClicks,
                  },
                ];
          }),
        },
      });
    },
  );

  routes.get(
    "/links/:linkId/analytics",
    authentication.requireSafeSession(),
    authentication.requireCapability("view-analytics"),
    async (context) => {
      const query = parseAnalyticsQuery(context.req.raw);
      if (query === undefined) return invalidQuery(context);
      const result = await dependencies.createAnalytics(context.env).query({
        ...query,
        scope: { kind: "link", linkId: context.req.param("linkId") },
      });
      if (result.kind !== "ok") return analyticsFailure(context, result);
      const { kind: _kind, ...analytics } = result;
      return context.json({ ok: true as const, ...analytics });
    },
  );

  return routes;
}

function invalidQuery(context: Parameters<typeof presentAuthenticationFailure>[0]) {
  return context.json({ ok: false as const, kind: "invalid-query", details: {} }, 400);
}

function analyticsFailure(
  context: Parameters<typeof presentAuthenticationFailure>[0],
  result: Exclude<AnalyticsQueryResult, { kind: "ok" }>,
) {
  return context.json(
    { ok: false as const, kind: result.kind, details: {} },
    result.kind === "not-found" ? 404 : 400,
  );
}
