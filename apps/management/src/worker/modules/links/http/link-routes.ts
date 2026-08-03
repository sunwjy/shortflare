import { type Context, Hono } from "hono";

import type { ManagementEnvironment } from "../../../environment";
import { parseJson } from "../../../http";
import { createAuthenticationMiddleware } from "../../../transport/authentication";
import { requireJsonRequestIntegrity } from "../../../transport/request-integrity";
import type { LinksHttpDependencies } from "./dependencies";
import { commandFailure, queryFailure, unexpectedCommand, unexpectedQuery } from "./errors";
import { apiError, toLinkDto, toLinkSummaryDto, toReservedAliasDto } from "./presenter";
import { parseLinkListQuery, parsePageQuery } from "./queries";
import {
  createLinkRequest,
  editLinkRequest,
  permanentDeleteRequest,
  revisionRequest,
} from "./schemas";
import { presentAuthenticationFailure } from "./security";

export function createLinkResourceRoutes(dependencies: LinksHttpDependencies) {
  const routes = new Hono<ManagementEnvironment>();
  const authentication = createAuthenticationMiddleware(dependencies, presentAuthenticationFailure);
  const requireIntegrity = requireJsonRequestIntegrity(presentAuthenticationFailure);

  routes.get("/links", authentication.requireSafeSession(), async (context) => {
    const query = parseLinkListQuery(context.req.raw);
    if (!query) return context.json(apiError("invalid-query"), 400);
    const result = await links(context).query(
      { kind: "list", ...query },
      { id: context.var.authenticatedUser.id },
    );
    if (!result.ok) return queryFailure(context, result);
    if (result.kind !== "page") return unexpectedQuery(result);
    return context.json({
      ok: true as const,
      items: result.page.items.map((link) => toLinkSummaryDto(link, context.env.REDIRECT_DOMAIN)),
      nextCursor: result.page.nextCursor,
    });
  });

  routes.get(
    "/links/:linkId/destination-versions",
    authentication.requireSafeSession(),
    async (context) => {
      const query = parsePageQuery(context.req.raw);
      if (!query) return context.json(apiError("invalid-query"), 400);
      const result = await links(context).query(
        {
          kind: "destination-versions",
          linkId: context.req.param("linkId"),
          ...query,
        },
        { id: context.var.authenticatedUser.id },
      );
      if (!result.ok) return queryFailure(context, result);
      if (result.kind !== "destination-version-page") return unexpectedQuery(result);
      return context.json({
        ok: true as const,
        items: result.page.items.map((version) => ({
          id: version.id,
          versionNumber: version.versionNumber,
          url: version.destination,
          createdAt: version.createdAt.toISOString(),
          current: version.versionNumber === result.page.currentVersionNumber,
        })),
        nextCursor: result.page.nextCursor,
      });
    },
  );

  routes.get("/links/:linkId", authentication.requireSafeSession(), async (context) => {
    const result = await links(context).query(
      { kind: "detail", linkId: context.req.param("linkId") },
      { id: context.var.authenticatedUser.id },
    );
    if (!result.ok) return queryFailure(context, result);
    if (result.kind !== "detail") return unexpectedQuery(result);
    return context.json({
      ok: true as const,
      link: toLinkDto(result.link, context.env.REDIRECT_DOMAIN),
    });
  });

  routes.patch(
    "/links/:linkId",
    requireIntegrity,
    authentication.requireMutationSession(),
    authentication.requireCapability("manage-links"),
    async (context) => {
      const request = await parseJson(context.req.raw, editLinkRequest);
      if (!request) return context.json(apiError("invalid-request"), 400);
      const editValues =
        request.title !== undefined
          ? {
              title: request.title,
              ...(request.destination === undefined ? {} : { destination: request.destination }),
            }
          : { destination: request.destination! };
      const result = await links(context).execute(
        {
          kind: "edit",
          linkId: context.req.param("linkId"),
          expectedRevision: request.expectedRevision,
          ...editValues,
        },
        { id: context.var.authenticatedUser.id },
      );
      if (!result.ok) return commandFailure(context, result);
      if (result.kind !== "link") return unexpectedCommand(result);
      return context.json({
        ok: true as const,
        changed: result.changed,
        link: toLinkDto(result.link, context.env.REDIRECT_DOMAIN),
      });
    },
  );

  for (const command of ["activate", "disable", "archive", "restore"] as const) {
    routes.post(
      `/links/:linkId/${command}`,
      requireIntegrity,
      authentication.requireMutationSession(),
      authentication.requireCapability("manage-links"),
      (context) => executeStateCommand(context, command),
    );
  }

  routes.post(
    "/links/:linkId/permanently-delete",
    requireIntegrity,
    authentication.requireMutationSession(),
    authentication.requireCapability("delete-links"),
    async (context) => {
      const request = await parseJson(context.req.raw, permanentDeleteRequest);
      if (!request) return context.json(apiError("invalid-request"), 400);
      const failure = authentication.ensureRecentAuthentication(context);
      if (failure) return failure;
      const result = await links(context).execute(
        {
          kind: "permanently-delete",
          linkId: context.req.param("linkId"),
          ...request,
        },
        { id: context.var.authenticatedUser.id },
      );
      if (!result.ok) return commandFailure(context, result);
      if (result.kind !== "deleted") return unexpectedCommand(result);
      return context.json({
        ok: true as const,
        reservedAlias: toReservedAliasDto(result.reservedAlias, context.env.REDIRECT_DOMAIN),
      });
    },
  );

  routes.post(
    "/links",
    requireIntegrity,
    authentication.requireMutationSession(),
    authentication.requireCapability("manage-links"),
    async (context) => {
      const request = await parseJson(context.req.raw, createLinkRequest);
      if (!request) return context.json(apiError("invalid-request"), 400);
      const result = await links(context).execute(
        {
          kind: "create",
          title: request.title,
          destination: request.destination,
          ...(request.alias === undefined ? {} : { alias: request.alias }),
        },
        { id: context.var.authenticatedUser.id },
      );
      if (!result.ok) return commandFailure(context, result);
      if (result.kind !== "link") return unexpectedCommand(result);
      return context.json(
        {
          ok: true as const,
          link: toLinkDto(result.link, context.env.REDIRECT_DOMAIN),
        },
        201,
      );
    },
  );

  async function executeStateCommand(
    context: Context<ManagementEnvironment>,
    kind: "activate" | "disable" | "archive" | "restore",
  ) {
    const request = await parseJson(context.req.raw, revisionRequest);
    if (!request) return context.json(apiError("invalid-request"), 400);
    const linkId = context.req.param("linkId");
    if (!linkId) throw new Error("Link route is missing linkId");
    const result = await links(context).execute(
      { kind, linkId, expectedRevision: request.expectedRevision },
      { id: context.var.authenticatedUser.id },
    );
    if (!result.ok) return commandFailure(context, result);
    if (result.kind !== "link") return unexpectedCommand(result);
    return context.json({
      ok: true as const,
      changed: result.changed,
      link: toLinkDto(result.link, context.env.REDIRECT_DOMAIN),
    });
  }

  function links(context: Context<ManagementEnvironment>) {
    return dependencies.createLinks(context.env);
  }

  return routes;
}
