import type { LinkQueryResult, LinkResult } from "@shortflare/links";
import { type Context, Hono } from "hono";

import type { ManagementDependencies } from "../dependencies";
import type { ManagementEnvironment } from "../environment";
import {
  apiError,
  createAuthentication,
  parseJson,
  parseLinkListQuery,
  parsePageQuery,
  parseReservedAliasListQuery,
  toLinkDto,
  toLinkSummaryDto,
  toReservedAliasDto,
} from "../http";
import {
  confirmationRequest,
  createLinkRequest,
  editLinkRequest,
  permanentDeleteRequest,
  revisionRequest,
} from "../request-schemas";

export function createLinkRoutes(
  dependencies: Pick<ManagementDependencies, "createIdentity" | "createLinks">,
) {
  const linkRoutes = new Hono<ManagementEnvironment>();
  const { authenticateMutation, authenticateSafe } = createAuthentication(
    dependencies.createIdentity,
  );

  linkRoutes.get("/links", async (context) => {
    const authenticated = await authenticateSafe(context, undefined, true);
    if ("response" in authenticated) return authenticated.response;
    const query = parseLinkListQuery(context.req.raw);
    if (!query) return context.json(apiError("invalid-query"), 400);
    const result = await links(context).query(
      { kind: "list", ...query },
      { id: authenticated.user.id },
    );
    if (!result.ok) return queryFailure(context, result);
    if (result.kind !== "page") return unexpectedQuery(result);
    return context.json({
      ok: true as const,
      items: result.page.items.map((link) => toLinkSummaryDto(link, context.env.REDIRECT_DOMAIN)),
      nextCursor: result.page.nextCursor,
    });
  });

  linkRoutes.get("/links/:linkId/destination-versions", async (context) => {
    const authenticated = await authenticateSafe(context, undefined, true);
    if ("response" in authenticated) return authenticated.response;
    const query = parsePageQuery(context.req.raw);
    if (!query) return context.json(apiError("invalid-query"), 400);
    const result = await links(context).query(
      {
        kind: "destination-versions",
        linkId: context.req.param("linkId"),
        ...query,
      },
      { id: authenticated.user.id },
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
  });

  linkRoutes.get("/links/:linkId", async (context) => {
    const authenticated = await authenticateSafe(context, undefined, true);
    if ("response" in authenticated) return authenticated.response;
    const result = await links(context).query(
      { kind: "detail", linkId: context.req.param("linkId") },
      { id: authenticated.user.id },
    );
    if (!result.ok) return queryFailure(context, result);
    if (result.kind !== "detail") return unexpectedQuery(result);
    return context.json({
      ok: true as const,
      link: toLinkDto(result.link, context.env.REDIRECT_DOMAIN),
    });
  });

  linkRoutes.patch("/links/:linkId", async (context) => {
    const authenticated = await authenticateMutation(context, {
      capability: "manage-links",
      apiErrors: true,
    });
    if ("response" in authenticated) return authenticated.response;
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
      { id: authenticated.user.id },
    );
    if (!result.ok) return commandFailure(context, result);
    if (result.kind !== "link") return unexpectedCommand(result);
    return context.json({
      ok: true as const,
      changed: result.changed,
      link: toLinkDto(result.link, context.env.REDIRECT_DOMAIN),
    });
  });

  for (const command of ["activate", "disable", "archive", "restore"] as const) {
    linkRoutes.post(`/links/:linkId/${command}`, (context) =>
      executeStateCommand(context, command),
    );
  }

  linkRoutes.post("/links/:linkId/permanently-delete", async (context) => {
    const authenticated = await authenticateMutation(context, {
      capability: "delete-links",
      recent: true,
      apiErrors: true,
    });
    if ("response" in authenticated) return authenticated.response;
    const request = await parseJson(context.req.raw, permanentDeleteRequest);
    if (!request) return context.json(apiError("invalid-request"), 400);
    const result = await links(context).execute(
      {
        kind: "permanently-delete",
        linkId: context.req.param("linkId"),
        ...request,
      },
      { id: authenticated.user.id },
    );
    if (!result.ok) return commandFailure(context, result);
    if (result.kind !== "deleted") return unexpectedCommand(result);
    return context.json({
      ok: true as const,
      reservedAlias: toReservedAliasDto(result.reservedAlias, context.env.REDIRECT_DOMAIN),
    });
  });

  linkRoutes.post("/links", async (context) => {
    const authenticated = await authenticateMutation(context, {
      capability: "manage-links",
      apiErrors: true,
    });
    if ("response" in authenticated) return authenticated.response;
    const request = await parseJson(context.req.raw, createLinkRequest);
    if (!request) return context.json(apiError("invalid-request"), 400);
    const result = await links(context).execute(
      {
        kind: "create",
        title: request.title,
        destination: request.destination,
        ...(request.alias === undefined ? {} : { alias: request.alias }),
      },
      { id: authenticated.user.id },
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
  });

  linkRoutes.get("/reserved-aliases", async (context) => {
    const authenticated = await authenticateSafe(context, "manage-reserved-aliases", true);
    if ("response" in authenticated) return authenticated.response;
    const query = parseReservedAliasListQuery(context.req.raw);
    if (!query) return context.json(apiError("invalid-query"), 400);
    const result = await links(context).query(
      { kind: "reserved-aliases", ...query },
      { id: authenticated.user.id },
    );
    if (!result.ok) return queryFailure(context, result);
    if (result.kind !== "reserved-alias-page") return unexpectedQuery(result);
    return context.json({
      ok: true as const,
      items: result.page.items.map((alias) =>
        toReservedAliasDto(alias, context.env.REDIRECT_DOMAIN),
      ),
      nextCursor: result.page.nextCursor,
    });
  });

  linkRoutes.post("/reserved-aliases/:alias/release", async (context) => {
    const authenticated = await authenticateMutation(context, {
      capability: "manage-reserved-aliases",
      recent: true,
      apiErrors: true,
    });
    if ("response" in authenticated) return authenticated.response;
    const request = await parseJson(context.req.raw, confirmationRequest);
    if (!request) return context.json(apiError("invalid-request"), 400);
    const result = await links(context).execute(
      {
        kind: "release-alias",
        alias: context.req.param("alias"),
        confirmationAlias: request.confirmationAlias,
      },
      { id: authenticated.user.id },
    );
    if (!result.ok) return commandFailure(context, result);
    if (result.kind !== "released") return unexpectedCommand(result);
    return context.body(null, 204);
  });

  async function executeStateCommand(
    context: Context<ManagementEnvironment>,
    kind: "activate" | "disable" | "archive" | "restore",
  ) {
    const authenticated = await authenticateMutation(context, {
      capability: "manage-links",
      apiErrors: true,
    });
    if ("response" in authenticated) return authenticated.response;
    const request = await parseJson(context.req.raw, revisionRequest);
    if (!request) return context.json(apiError("invalid-request"), 400);
    const linkId = context.req.param("linkId");
    if (!linkId) throw new Error("Link route is missing linkId");
    const result = await links(context).execute(
      {
        kind,
        linkId,
        expectedRevision: request.expectedRevision,
      },
      { id: authenticated.user.id },
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

  return linkRoutes;
}

type CommandFailure = Extract<LinkResult, { ok: false }>;
function commandFailure(context: Context<ManagementEnvironment>, result: CommandFailure) {
  switch (result.kind) {
    case "alias-in-use":
    case "alias-reserved":
      return context.json(apiError(result.kind, { alias: result.alias }), 409);
    case "invalid-alias":
      return context.json(apiError(result.kind, { alias: result.alias }), 400);
    case "invalid-title":
    case "confirmation-mismatch":
      return context.json(apiError(result.kind), 400);
    case "invalid-destination":
      return context.json(apiError(result.kind, { reason: result.reason }), 400);
    case "link-not-found":
      return context.json(apiError(result.kind), 404);
    case "invalid-state":
      return context.json(
        apiError(result.kind, { state: result.state, command: result.command }),
        409,
      );
    case "reserved-alias-not-found":
      return context.json(apiError(result.kind), 404);
    case "alias-generation-exhausted":
      return context.json(apiError(result.kind), 500);
    case "link-conflict":
      return context.json(apiError(result.kind, { revision: result.currentRevision }), 409);
  }
}

type QueryFailure = Extract<LinkQueryResult, { ok: false }>;
function queryFailure(context: Context<ManagementEnvironment>, result: QueryFailure) {
  switch (result.kind) {
    case "invalid-cursor":
      return context.json(apiError(result.kind), 400);
    case "link-not-found":
      return context.json(apiError(result.kind), 404);
  }
}

function unexpectedCommand(result: Extract<LinkResult, { ok: true }>): never {
  throw new Error(`Unexpected Link command result: ${result.kind}`);
}

function unexpectedQuery(result: Extract<LinkQueryResult, { ok: true }>): never {
  throw new Error(`Unexpected Link query result: ${result.kind}`);
}
