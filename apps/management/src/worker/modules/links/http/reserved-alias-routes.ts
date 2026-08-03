import { Hono } from "hono";

import type { ManagementEnvironment } from "../../../environment";
import { createAuthenticationMiddleware } from "../../../transport/authentication";
import { parseJson } from "../../../transport/json";
import { requireJsonRequestIntegrity } from "../../../transport/request-integrity";
import type { LinksHttpDependencies } from "./dependencies";
import { commandFailure, queryFailure, unexpectedCommand, unexpectedQuery } from "./errors";
import { apiError, toReservedAliasDto } from "./presenter";
import { parseReservedAliasListQuery } from "./queries";
import { confirmationRequest } from "./schemas";
import { presentAuthenticationFailure } from "./security";

export function createReservedAliasRoutes(dependencies: LinksHttpDependencies) {
  const routes = new Hono<ManagementEnvironment>();
  const authentication = createAuthenticationMiddleware(dependencies, presentAuthenticationFailure);
  const requireIntegrity = requireJsonRequestIntegrity(presentAuthenticationFailure);

  routes.get(
    "/reserved-aliases",
    authentication.requireSafeSession(),
    authentication.requireCapability("manage-reserved-aliases"),
    async (context) => {
      const query = parseReservedAliasListQuery(context.req.raw);
      if (!query) return context.json(apiError("invalid-query"), 400);
      const result = await dependencies
        .createLinks(context.env)
        .query({ kind: "reserved-aliases", ...query }, { id: context.var.authenticatedUser.id });
      if (!result.ok) return queryFailure(context, result);
      if (result.kind !== "reserved-alias-page") return unexpectedQuery(result);
      return context.json({
        ok: true as const,
        items: result.page.items.map((alias) =>
          toReservedAliasDto(alias, context.env.REDIRECT_DOMAIN),
        ),
        nextCursor: result.page.nextCursor,
      });
    },
  );

  routes.post(
    "/reserved-aliases/:alias/release",
    requireIntegrity,
    authentication.requireMutationSession(),
    authentication.requireCapability("manage-reserved-aliases"),
    async (context) => {
      const request = await parseJson(context.req.raw, confirmationRequest);
      if (!request) return context.json(apiError("invalid-request"), 400);
      const failure = authentication.ensureRecentAuthentication(context);
      if (failure) return failure;
      const result = await dependencies.createLinks(context.env).execute(
        {
          kind: "release-alias",
          alias: context.req.param("alias"),
          confirmationAlias: request.confirmationAlias,
        },
        { id: context.var.authenticatedUser.id },
      );
      if (!result.ok) return commandFailure(context, result);
      if (result.kind !== "released") return unexpectedCommand(result);
      return context.body(null, 204);
    },
  );

  return routes;
}
