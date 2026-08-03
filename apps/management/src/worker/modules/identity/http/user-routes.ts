import { type Context, Hono } from "hono";

import type { ManagementDependencies } from "../../../dependencies";
import type { ManagementEnvironment } from "../../../environment";
import {
  createAuthenticationMiddleware,
  type AuthenticationFailurePresenter,
} from "../../../transport/authentication";
import { parseJson } from "../../../transport/json";
import { requireJsonRequestIntegrity } from "../../../transport/request-integrity";
import type { Identity } from "..";
import { emptyRequest, invitationRequest, roleRequest } from "./schemas";

const presentAuthenticationFailure: AuthenticationFailurePresenter = (context, kind, status) =>
  context.json({ ok: false, kind } as const, status);

export function createUserRoutes(
  dependencies: Pick<
    ManagementDependencies,
    "createIdentity" | "createRequestAuthentication" | "hasCapability"
  >,
) {
  const userRoutes = new Hono<ManagementEnvironment>();
  const authentication = createAuthenticationMiddleware(dependencies, presentAuthenticationFailure);
  const requireIntegrity = requireJsonRequestIntegrity(presentAuthenticationFailure);

  userRoutes.post(
    "/invitations",
    requireIntegrity,
    authentication.requireMutationSession(),
    authentication.requireCapability("manage-users"),
    async (context) => {
      const request = await parseJson(context.req.raw, invitationRequest);
      if (!request) return invalidRequest(context);
      if (request.role === "administrator") {
        const failure = authentication.ensureRecentAuthentication(context);
        if (failure) return failure;
      }
      const result = await dependencies.createIdentity(context.env).invitations.issueInvitation({
        actorId: context.var.authenticatedUser.id,
        ...request,
      });
      return context.json(result, invitationStatus(result));
    },
  );

  userRoutes.get(
    "/",
    authentication.requireSafeSession(),
    authentication.requireCapability("view-users"),
    async (context) =>
      context.json({
        ok: true as const,
        users: await dependencies.createIdentity(context.env).users.listUsers(),
      }),
  );

  userRoutes.post(
    "/:userId/cancel-invitation",
    requireIntegrity,
    authentication.requireMutationSession(),
    authentication.requireCapability("manage-users"),
    async (context) => {
      if (!(await parseEmptyRequest(context))) return invalidRequest(context);
      const result = await dependencies.createIdentity(context.env).invitations.cancelInvitation({
        actorId: context.var.authenticatedUser.id,
        userId: context.req.param("userId"),
      });
      return context.json(result, result.ok ? 200 : 404);
    },
  );

  userRoutes.post(
    "/:userId/password-resets",
    requireIntegrity,
    authentication.requireMutationSession(),
    authentication.requireCapability("manage-users"),
    async (context) => {
      if (!(await parseEmptyRequest(context))) return invalidRequest(context);
      const failure = authentication.ensureRecentAuthentication(context);
      if (failure) return failure;
      const result = await dependencies
        .createIdentity(context.env)
        .passwordResets.issuePasswordReset({
          actorId: context.var.authenticatedUser.id,
          userId: context.req.param("userId"),
        });
      return context.json(result, passwordResetStatus(result));
    },
  );

  userRoutes.post(
    "/:userId/role",
    requireIntegrity,
    authentication.requireMutationSession(),
    authentication.requireCapability("manage-users"),
    async (context) => {
      const request = await parseJson(context.req.raw, roleRequest);
      if (!request) return invalidRequest(context);
      const result = await dependencies.createIdentity(context.env).users.changeRole({
        actorId: context.var.authenticatedUser.id,
        userId: context.req.param("userId"),
        role: request.role,
        recentlyAuthenticated: context.var.recentlyAuthenticated,
      });
      return context.json(result, lifecycleStatus(result));
    },
  );

  userRoutes.post(
    "/:userId/suspend",
    requireIntegrity,
    authentication.requireMutationSession(),
    authentication.requireCapability("manage-users"),
    async (context) => {
      if (!(await parseEmptyRequest(context))) return invalidRequest(context);
      const result = await dependencies.createIdentity(context.env).users.suspendUser({
        actorId: context.var.authenticatedUser.id,
        userId: context.req.param("userId"),
        recentlyAuthenticated: context.var.recentlyAuthenticated,
      });
      return context.json(result, lifecycleStatus(result));
    },
  );

  userRoutes.post(
    "/:userId/reactivate",
    requireIntegrity,
    authentication.requireMutationSession(),
    authentication.requireCapability("manage-users"),
    async (context) => {
      if (!(await parseEmptyRequest(context))) return invalidRequest(context);
      const result = await dependencies.createIdentity(context.env).users.reactivateUser({
        actorId: context.var.authenticatedUser.id,
        userId: context.req.param("userId"),
      });
      return context.json(result, result.ok ? 200 : 404);
    },
  );

  return userRoutes;
}

async function parseEmptyRequest(context: Context<ManagementEnvironment>) {
  return parseJson(context.req.raw, emptyRequest);
}

function invalidRequest(context: Context<ManagementEnvironment>) {
  return context.json({ ok: false, kind: "invalid-request" } as const, 400);
}

function invitationStatus(
  result: Awaited<ReturnType<Identity["invitations"]["issueInvitation"]>>,
): 201 | 400 | 409 {
  if (result.ok) return 201;
  switch (result.kind) {
    case "invalid-email":
      return 400;
    case "user-active":
    case "user-suspended":
      return 409;
  }
}

function passwordResetStatus(
  result: Awaited<ReturnType<Identity["passwordResets"]["issuePasswordReset"]>>,
): 201 | 404 | 409 {
  if (result.ok) return 201;
  switch (result.kind) {
    case "user-not-found":
      return 404;
    case "user-suspended":
      return 409;
  }
}

function lifecycleStatus(
  result:
    | Awaited<ReturnType<Identity["users"]["changeRole"]>>
    | Awaited<ReturnType<Identity["users"]["suspendUser"]>>,
): 200 | 403 | 404 | 409 {
  if (result.ok) return 200;
  switch (result.kind) {
    case "reauthentication-required":
      return 403;
    case "user-not-found":
      return 404;
    case "last-active-administrator":
      return 409;
  }
}
