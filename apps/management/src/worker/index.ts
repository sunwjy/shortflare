import { createD1LinksPersistence } from "@shortflare/database";
import { createLinks } from "@shortflare/links";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";

import type { ManagementEnvironment } from "./environment";
import {
  apiError,
  authenticateMutation,
  authenticateSafe,
  deleteSessionCookie,
  isSameOriginJsonRequest,
  parseJson,
  parseLinkListQuery,
  parsePageQuery,
  parseReservedAliasListQuery,
  setSessionCookie,
  toLinkDto,
  toLinkSummaryDto,
  toReservedAliasDto,
} from "./http";
import { createIdentity } from "./identity";
import {
  confirmationRequest,
  createLinkRequest,
  editLinkRequest,
  emptyRequest,
  healthResponse,
  invitationRequest,
  loginRequest,
  passwordChangeRequest,
  passwordRequest,
  permanentDeleteRequest,
  revisionRequest,
  roleRequest,
  setupRequest,
  tokenPasswordRequest,
} from "./request-schemas";

export const app = new Hono<ManagementEnvironment>();

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

app.get("/api/internal/health", (context) => context.json(healthResponse.parse({ status: "ok" })));

app.post("/api/internal/auth/setup", async (context) => {
  if (!isSameOriginJsonRequest(context.req.raw)) {
    return context.json({ ok: false, kind: "forbidden" } as const, 403);
  }
  const request = await parseJson(context.req.raw, setupRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }

  const result = await createIdentity({ db: context.env.DB }).completeInitialSetup(request);
  return context.json(result, result.ok ? 201 : 400);
});

app.post("/api/internal/auth/login", async (context) => {
  if (!isSameOriginJsonRequest(context.req.raw)) {
    return context.json({ ok: false, kind: "forbidden" } as const, 403);
  }
  const request = await parseJson(context.req.raw, loginRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }

  const result = await createIdentity({ db: context.env.DB }).login(request);
  if (!result.ok) {
    return context.json(result, 401);
  }
  setSessionCookie(context, result.session);
  return context.json({
    ok: true as const,
    user: result.session.user,
    csrfToken: result.session.csrfToken,
  });
});

app.get("/api/internal/auth/session", async (context) => {
  const sessionToken = getCookie(context, "__Host-shortflare_session");
  if (!sessionToken) {
    return context.json({ ok: false, kind: "unauthenticated" } as const, 401);
  }
  const result = await createIdentity({ db: context.env.DB }).openSession(sessionToken);
  if (!result.ok) {
    deleteSessionCookie(context);
    return context.json({ ok: false, kind: "unauthenticated" } as const, 401);
  }
  return context.json({
    ok: true as const,
    user: result.session.user,
    csrfToken: result.session.csrfToken,
  });
});

app.post("/api/internal/auth/logout", async (context) => {
  if (!isSameOriginJsonRequest(context.req.raw)) {
    return context.json({ ok: false, kind: "forbidden" } as const, 403);
  }
  const sessionToken = getCookie(context, "__Host-shortflare_session");
  if (!sessionToken) {
    return context.json({ ok: false, kind: "unauthenticated" } as const, 401);
  }
  const identity = createIdentity({ db: context.env.DB });
  const authentication = await identity.authenticateRequest(
    sessionToken,
    context.req.header("x-csrf-token") ?? "",
  );
  if (!authentication.ok) {
    return context.json(
      {
        ok: false,
        kind:
          authentication.kind === "invalid-credentials" ? "unauthenticated" : "invalid-csrf-token",
      } as const,
      authentication.kind === "invalid-credentials" ? 401 : 403,
    );
  }
  await identity.logout(sessionToken);
  deleteSessionCookie(context);
  return context.body(null, 204);
});

app.post("/api/internal/auth/invitations/accept", async (context) => {
  if (!isSameOriginJsonRequest(context.req.raw)) {
    return context.json({ ok: false, kind: "forbidden" } as const, 403);
  }
  const request = await parseJson(context.req.raw, tokenPasswordRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const result = await createIdentity({ db: context.env.DB }).acceptInvitation(request);
  return context.json(result, result.ok ? 200 : 400);
});

app.post("/api/internal/auth/password-resets/use", async (context) => {
  if (!isSameOriginJsonRequest(context.req.raw)) {
    return context.json({ ok: false, kind: "forbidden" } as const, 403);
  }
  const request = await parseJson(context.req.raw, tokenPasswordRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const result = await createIdentity({ db: context.env.DB }).usePasswordReset(request);
  return context.json(result, result.ok ? 200 : 400);
});

app.post("/api/internal/auth/operator-recovery", async (context) => {
  if (!isSameOriginJsonRequest(context.req.raw)) {
    return context.json({ ok: false, kind: "forbidden" } as const, 403);
  }
  const request = await parseJson(context.req.raw, tokenPasswordRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const result = await createIdentity({ db: context.env.DB }).useOperatorRecovery(request);
  return context.json(result, result.ok ? 200 : 400);
});

app.post("/api/internal/auth/reauthenticate", async (context) => {
  const authenticated = await authenticateMutation(context);
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const request = await parseJson(context.req.raw, passwordRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const result = await authenticated.identity.reauthenticate({
    token: authenticated.sessionToken,
    password: request.password,
  });
  if (!result.ok) {
    return context.json(result, 401);
  }
  setSessionCookie(context, result.session);
  return context.json({
    ok: true as const,
    user: result.session.user,
    csrfToken: result.session.csrfToken,
  });
});

app.post("/api/internal/auth/password", async (context) => {
  const authenticated = await authenticateMutation(context);
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const request = await parseJson(context.req.raw, passwordChangeRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const result = await authenticated.identity.changePassword({
    userId: authenticated.user.id,
    ...request,
  });
  if (result.ok) {
    deleteSessionCookie(context);
  }
  return context.json(result, result.ok ? 200 : 400);
});

app.post("/api/internal/users/invitations", async (context) => {
  const request = await parseJson(context.req.raw, invitationRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const authenticated = await authenticateMutation(context, {
    capability: "manage-users",
    recent: request.role === "administrator",
  });
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const result = await authenticated.identity.issueInvitation({
    actorId: authenticated.user.id,
    ...request,
  });
  const status = result.ok ? 201 : result.kind === "invalid-email" ? 400 : 409;
  return context.json(result, status);
});

app.get("/api/internal/users", async (context) => {
  const authenticated = await authenticateSafe(context, "view-users");
  if ("response" in authenticated) {
    return authenticated.response;
  }
  return context.json({ ok: true as const, users: await authenticated.identity.listUsers() });
});

app.post("/api/internal/users/:userId/cancel-invitation", async (context) => {
  const authenticated = await authenticateMutation(context, { capability: "manage-users" });
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const request = await parseJson(context.req.raw, emptyRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const result = await authenticated.identity.cancelInvitation({
    actorId: authenticated.user.id,
    userId: context.req.param("userId"),
  });
  return context.json(result, result.ok ? 200 : 404);
});

app.post("/api/internal/users/:userId/password-resets", async (context) => {
  const authenticated = await authenticateMutation(context, {
    capability: "manage-users",
    recent: true,
  });
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const request = await parseJson(context.req.raw, emptyRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const result = await authenticated.identity.issuePasswordReset({
    actorId: authenticated.user.id,
    userId: context.req.param("userId"),
  });
  return context.json(result, result.ok ? 201 : result.kind === "user-suspended" ? 409 : 404);
});

app.post("/api/internal/users/:userId/role", async (context) => {
  const request = await parseJson(context.req.raw, roleRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const authenticated = await authenticateMutation(context, {
    capability: "manage-users",
  });
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const result = await authenticated.identity.changeRole({
    actorId: authenticated.user.id,
    userId: context.req.param("userId"),
    role: request.role,
    recentlyAuthenticated: authenticated.recentlyAuthenticated,
  });
  return context.json(
    result,
    result.ok
      ? 200
      : result.kind === "user-not-found"
        ? 404
        : result.kind === "reauthentication-required"
          ? 403
          : 409,
  );
});

app.post("/api/internal/users/:userId/suspend", async (context) => {
  const authenticated = await authenticateMutation(context, {
    capability: "manage-users",
  });
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const request = await parseJson(context.req.raw, emptyRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const result = await authenticated.identity.suspendUser({
    actorId: authenticated.user.id,
    userId: context.req.param("userId"),
    recentlyAuthenticated: authenticated.recentlyAuthenticated,
  });
  return context.json(
    result,
    result.ok
      ? 200
      : result.kind === "user-not-found"
        ? 404
        : result.kind === "reauthentication-required"
          ? 403
          : 409,
  );
});

app.post("/api/internal/users/:userId/reactivate", async (context) => {
  const authenticated = await authenticateMutation(context, { capability: "manage-users" });
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const request = await parseJson(context.req.raw, emptyRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const result = await authenticated.identity.reactivateUser({
    actorId: authenticated.user.id,
    userId: context.req.param("userId"),
  });
  return context.json(result, result.ok ? 200 : 404);
});

app.get("/api/internal/links", async (context) => {
  const authenticated = await authenticateSafe(context, undefined, true);
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const query = parseLinkListQuery(context.req.raw);
  if (query === undefined) {
    return context.json(apiError("invalid-query"), 400);
  }
  const result = await createLinksForContext(context).query(
    { kind: "list", ...query },
    { id: authenticated.user.id },
  );
  if (!result.ok || result.kind !== "page") {
    return context.json(apiError(result.kind), 400);
  }
  return context.json({
    ok: true as const,
    items: result.page.items.map((link) => toLinkSummaryDto(link, context.env.REDIRECT_DOMAIN)),
    nextCursor: result.page.nextCursor,
  });
});

app.get("/api/internal/links/:linkId/destination-versions", async (context) => {
  const authenticated = await authenticateSafe(context, undefined, true);
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const query = parsePageQuery(context.req.raw);
  if (query === undefined) {
    return context.json(apiError("invalid-query"), 400);
  }
  const result = await createLinksForContext(context).query(
    {
      kind: "destination-versions",
      linkId: context.req.param("linkId"),
      ...query,
    },
    { id: authenticated.user.id },
  );
  if (!result.ok) {
    return result.kind === "link-not-found"
      ? context.json(apiError(result.kind), 404)
      : context.json(apiError(result.kind), 400);
  }
  if (result.kind !== "destination-version-page") {
    throw new Error(`Unexpected Destination Version result: ${result.kind}`);
  }
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

app.get("/api/internal/links/:linkId", async (context) => {
  const authenticated = await authenticateSafe(context, undefined, true);
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const result = await createLinksForContext(context).query(
    { kind: "detail", linkId: context.req.param("linkId") },
    { id: authenticated.user.id },
  );
  if (!result.ok) {
    return context.json(apiError(result.kind), 404);
  }
  if (result.kind !== "detail") {
    throw new Error(`Unexpected Link detail result: ${result.kind}`);
  }
  return context.json({
    ok: true as const,
    link: toLinkDto(result.link, context.env.REDIRECT_DOMAIN),
  });
});

app.patch("/api/internal/links/:linkId", async (context) => {
  const authenticated = await authenticateMutation(context, {
    capability: "manage-links",
    apiErrors: true,
  });
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const request = await parseJson(context.req.raw, editLinkRequest);
  if (!request) {
    return context.json(apiError("invalid-request"), 400);
  }
  const editValues =
    request.title !== undefined
      ? {
          title: request.title,
          ...(request.destination === undefined ? {} : { destination: request.destination }),
        }
      : { destination: request.destination! };
  const result = await createLinksForContext(context).execute(
    {
      kind: "edit",
      linkId: context.req.param("linkId"),
      expectedRevision: request.expectedRevision,
      ...editValues,
    },
    { id: authenticated.user.id },
  );
  if (result.ok) {
    if (result.kind !== "link") throw new Error(`Unexpected Link edit result: ${result.kind}`);
    return context.json({
      ok: true as const,
      changed: result.changed,
      link: toLinkDto(result.link, context.env.REDIRECT_DOMAIN),
    });
  }
  if (result.kind === "link-conflict") {
    return context.json(apiError(result.kind, { revision: result.currentRevision }), 409);
  }
  if (result.kind === "link-not-found") {
    return context.json(apiError(result.kind), 404);
  }
  if (result.kind === "invalid-state") {
    return context.json(
      apiError(result.kind, { state: result.state, command: result.command }),
      409,
    );
  }
  return context.json(
    apiError(result.kind, result.kind === "invalid-destination" ? { reason: result.reason } : {}),
    400,
  );
});

app.post("/api/internal/links/:linkId/activate", (context) =>
  executeLinkStateCommand(context, context.req.param("linkId"), "activate"),
);
app.post("/api/internal/links/:linkId/disable", (context) =>
  executeLinkStateCommand(context, context.req.param("linkId"), "disable"),
);
app.post("/api/internal/links/:linkId/archive", (context) =>
  executeLinkStateCommand(context, context.req.param("linkId"), "archive"),
);
app.post("/api/internal/links/:linkId/restore", (context) =>
  executeLinkStateCommand(context, context.req.param("linkId"), "restore"),
);
app.post("/api/internal/links/:linkId/permanently-delete", async (context) => {
  const authenticated = await authenticateMutation(context, {
    capability: "delete-links",
    recent: true,
    apiErrors: true,
  });
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const request = await parseJson(context.req.raw, permanentDeleteRequest);
  if (!request) {
    return context.json(apiError("invalid-request"), 400);
  }
  const result = await createLinksForContext(context).execute(
    {
      kind: "permanently-delete",
      linkId: context.req.param("linkId"),
      ...request,
    },
    { id: authenticated.user.id },
  );
  if (result.ok) {
    if (result.kind !== "deleted") {
      throw new Error(`Unexpected permanent deletion result: ${result.kind}`);
    }
    return context.json({
      ok: true as const,
      reservedAlias: toReservedAliasDto(result.reservedAlias, context.env.REDIRECT_DOMAIN),
    });
  }
  if (result.kind === "link-conflict") {
    return context.json(apiError(result.kind, { revision: result.currentRevision }), 409);
  }
  if (result.kind === "link-not-found") {
    return context.json(apiError(result.kind), 404);
  }
  if (result.kind === "invalid-state") {
    return context.json(
      apiError(result.kind, { state: result.state, command: result.command }),
      409,
    );
  }
  if (result.kind === "confirmation-mismatch") {
    return context.json(apiError(result.kind), 400);
  }
  throw new Error(`Unexpected permanent deletion failure: ${result.kind}`);
});

app.post("/api/internal/links", async (context) => {
  const authenticated = await authenticateMutation(context, {
    capability: "manage-links",
    apiErrors: true,
  });
  if ("response" in authenticated) {
    return authenticated.response;
  }

  const request = await parseJson(context.req.raw, createLinkRequest);
  if (!request) {
    return context.json(apiError("invalid-request"), 400);
  }

  const links = createLinksForContext(context);
  const result = await links.execute(
    {
      kind: "create",
      title: request.title,
      destination: request.destination,
      ...(request.alias === undefined ? {} : { alias: request.alias }),
    },
    { id: authenticated.user.id },
  );
  if (result.ok) {
    if (result.kind !== "link") {
      throw new Error(`Unexpected Link creation result: ${result.kind}`);
    }
    return context.json(
      { ok: true as const, link: toLinkDto(result.link, context.env.REDIRECT_DOMAIN) },
      201,
    );
  }
  if (result.kind === "alias-in-use" || result.kind === "alias-reserved") {
    return context.json(apiError(result.kind, { alias: result.alias }), 409);
  }
  if (result.kind === "invalid-alias") {
    return context.json(apiError(result.kind, { alias: result.alias }), 400);
  }
  if (result.kind === "invalid-destination") {
    return context.json(apiError(result.kind, { reason: result.reason }), 400);
  }
  if (result.kind === "invalid-title") {
    return context.json(apiError(result.kind), 400);
  }
  return context.json(apiError(result.kind), 500);
});

app.get("/api/internal/reserved-aliases", async (context) => {
  const authenticated = await authenticateSafe(context, "manage-reserved-aliases", true);
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const query = parseReservedAliasListQuery(context.req.raw);
  if (query === undefined) {
    return context.json(apiError("invalid-query"), 400);
  }
  const result = await createLinksForContext(context).query(
    { kind: "reserved-aliases", ...query },
    { id: authenticated.user.id },
  );
  if (!result.ok || result.kind !== "reserved-alias-page") {
    return context.json(apiError(result.kind), 400);
  }
  return context.json({
    ok: true as const,
    items: result.page.items.map((alias) => toReservedAliasDto(alias, context.env.REDIRECT_DOMAIN)),
    nextCursor: result.page.nextCursor,
  });
});

app.post("/api/internal/reserved-aliases/:alias/release", async (context) => {
  const authenticated = await authenticateMutation(context, {
    capability: "manage-reserved-aliases",
    recent: true,
    apiErrors: true,
  });
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const request = await parseJson(context.req.raw, confirmationRequest);
  if (!request) {
    return context.json(apiError("invalid-request"), 400);
  }
  const result = await createLinksForContext(context).execute(
    {
      kind: "release-alias",
      alias: context.req.param("alias"),
      confirmationAlias: request.confirmationAlias,
    },
    { id: authenticated.user.id },
  );
  if (result.ok) {
    if (result.kind !== "released") {
      throw new Error(`Unexpected Reserved Alias release result: ${result.kind}`);
    }
    return context.body(null, 204);
  }
  if (result.kind === "reserved-alias-not-found") {
    return context.json(apiError(result.kind), 404);
  }
  if (result.kind === "confirmation-mismatch" || result.kind === "invalid-alias") {
    return context.json(apiError(result.kind), 400);
  }
  throw new Error(`Unexpected Reserved Alias release failure: ${result.kind}`);
});

function createLinksForContext(context: Context<ManagementEnvironment>) {
  return createLinks({
    persistence: createD1LinksPersistence(context.env.DB),
    redirectDomain: context.env.REDIRECT_DOMAIN,
  });
}

async function executeLinkStateCommand(
  context: Context<ManagementEnvironment>,
  linkId: string,
  kind: "activate" | "disable" | "archive" | "restore",
) {
  const authenticated = await authenticateMutation(context, {
    capability: "manage-links",
    apiErrors: true,
  });
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const request = await parseJson(context.req.raw, revisionRequest);
  if (!request) {
    return context.json(apiError("invalid-request"), 400);
  }
  const result = await createLinksForContext(context).execute(
    {
      kind,
      linkId,
      expectedRevision: request.expectedRevision,
    },
    { id: authenticated.user.id },
  );
  if (result.ok) {
    if (result.kind !== "link") throw new Error(`Unexpected Link state result: ${result.kind}`);
    return context.json({
      ok: true as const,
      changed: result.changed,
      link: toLinkDto(result.link, context.env.REDIRECT_DOMAIN),
    });
  }
  if (result.kind === "link-conflict") {
    return context.json(apiError(result.kind, { revision: result.currentRevision }), 409);
  }
  if (result.kind === "link-not-found") {
    return context.json(apiError(result.kind), 404);
  }
  if (result.kind === "invalid-state") {
    return context.json(
      apiError(result.kind, { state: result.state, command: result.command }),
      409,
    );
  }
  throw new Error(`Unexpected Link state failure: ${result.kind}`);
}

export default app;
