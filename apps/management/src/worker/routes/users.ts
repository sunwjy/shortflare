import { type Context, Hono } from "hono";

import type { ManagementEnvironment } from "../environment";
import { authenticateMutation, authenticateSafe, parseJson } from "../http";
import { createIdentity } from "../identity";
import { emptyRequest, invitationRequest, roleRequest } from "../request-schemas";

export const userRoutes = new Hono<ManagementEnvironment>();
type Identity = ReturnType<typeof createIdentity>;

userRoutes.post("/invitations", async (context) => {
  const request = await parseJson(context.req.raw, invitationRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const authenticated = await authenticateMutation(context, {
    capability: "manage-users",
    recent: request.role === "administrator",
  });
  if ("response" in authenticated) return authenticated.response;

  const result = await authenticated.identity.issueInvitation({
    actorId: authenticated.user.id,
    ...request,
  });
  return context.json(result, invitationStatus(result));
});

userRoutes.get("/", async (context) => {
  const authenticated = await authenticateSafe(context, "view-users");
  if ("response" in authenticated) return authenticated.response;
  return context.json({
    ok: true as const,
    users: await authenticated.identity.listUsers(),
  });
});

userRoutes.post("/:userId/cancel-invitation", async (context) => {
  const authenticated = await authenticateMutation(context, {
    capability: "manage-users",
  });
  if ("response" in authenticated) return authenticated.response;
  if (!(await parseEmptyRequest(context))) return invalidRequest(context);
  const result = await authenticated.identity.cancelInvitation({
    actorId: authenticated.user.id,
    userId: context.req.param("userId"),
  });
  return context.json(result, result.ok ? 200 : 404);
});

userRoutes.post("/:userId/password-resets", async (context) => {
  const authenticated = await authenticateMutation(context, {
    capability: "manage-users",
    recent: true,
  });
  if ("response" in authenticated) return authenticated.response;
  if (!(await parseEmptyRequest(context))) return invalidRequest(context);
  const result = await authenticated.identity.issuePasswordReset({
    actorId: authenticated.user.id,
    userId: context.req.param("userId"),
  });
  return context.json(result, passwordResetStatus(result));
});

userRoutes.post("/:userId/role", async (context) => {
  const request = await parseJson(context.req.raw, roleRequest);
  if (!request) return invalidRequest(context);
  const authenticated = await authenticateMutation(context, {
    capability: "manage-users",
  });
  if ("response" in authenticated) return authenticated.response;
  const result = await authenticated.identity.changeRole({
    actorId: authenticated.user.id,
    userId: context.req.param("userId"),
    role: request.role,
    recentlyAuthenticated: authenticated.recentlyAuthenticated,
  });
  return context.json(result, lifecycleStatus(result));
});

userRoutes.post("/:userId/suspend", async (context) => {
  const authenticated = await authenticateMutation(context, {
    capability: "manage-users",
  });
  if ("response" in authenticated) return authenticated.response;
  if (!(await parseEmptyRequest(context))) return invalidRequest(context);
  const result = await authenticated.identity.suspendUser({
    actorId: authenticated.user.id,
    userId: context.req.param("userId"),
    recentlyAuthenticated: authenticated.recentlyAuthenticated,
  });
  return context.json(result, lifecycleStatus(result));
});

userRoutes.post("/:userId/reactivate", async (context) => {
  const authenticated = await authenticateMutation(context, {
    capability: "manage-users",
  });
  if ("response" in authenticated) return authenticated.response;
  if (!(await parseEmptyRequest(context))) return invalidRequest(context);
  const result = await authenticated.identity.reactivateUser({
    actorId: authenticated.user.id,
    userId: context.req.param("userId"),
  });
  return context.json(result, result.ok ? 200 : 404);
});

async function parseEmptyRequest(context: Context<ManagementEnvironment>) {
  return parseJson(context.req.raw, emptyRequest);
}

function invalidRequest(context: Context<ManagementEnvironment>) {
  return context.json({ ok: false, kind: "invalid-request" } as const, 400);
}

function invitationStatus(
  result: Awaited<ReturnType<Identity["issueInvitation"]>>,
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
  result: Awaited<ReturnType<Identity["issuePasswordReset"]>>,
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
    | Awaited<ReturnType<Identity["changeRole"]>>
    | Awaited<ReturnType<Identity["suspendUser"]>>,
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
