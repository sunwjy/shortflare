import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";

import type { ManagementDependencies } from "../../../dependencies";
import type { ManagementEnvironment } from "../../../environment";
import {
  createAuthenticationMiddleware,
  type AuthenticationFailurePresenter,
} from "../../../transport/authentication";
import { parseJson } from "../../../transport/json";
import { requireJsonRequestIntegrity } from "../../../transport/request-integrity";
import { deleteSessionCookie, setSessionCookie } from "./cookies";
import {
  loginRequest,
  passwordChangeRequest,
  passwordRequest,
  setupRequest,
  tokenPasswordRequest,
} from "./schemas";

const presentAuthenticationFailure: AuthenticationFailurePresenter = (context, kind, status) =>
  context.json({ ok: false, kind } as const, status);

export function createAuthRoutes(
  dependencies: Pick<
    ManagementDependencies,
    "createIdentity" | "createRequestAuthentication" | "hasCapability"
  >,
) {
  const authRoutes = new Hono<ManagementEnvironment>();
  const authentication = createAuthenticationMiddleware(dependencies, presentAuthenticationFailure);
  const requireIntegrity = requireJsonRequestIntegrity(presentAuthenticationFailure);

  authRoutes.post("/setup", requireIntegrity, async (context) => {
    const request = await parsePublicJson(context, setupRequest);
    if (request instanceof Response) return request;
    const result = await dependencies
      .createIdentity(context.env)
      .initialSetup.completeInitialSetup(request);
    return context.json(result, result.ok ? 201 : 400);
  });

  authRoutes.post("/login", requireIntegrity, async (context) => {
    const request = await parsePublicJson(context, loginRequest);
    if (request instanceof Response) return request;
    const result = await dependencies.createIdentity(context.env).sessions.login(request);
    if (!result.ok) return context.json(result, 401);
    setSessionCookie(context, result.session);
    return context.json({
      ok: true as const,
      user: result.session.user,
      csrfToken: result.session.csrfToken,
    });
  });

  authRoutes.get("/session", async (context) => {
    const sessionToken = getCookie(context, "__Host-shortflare_session");
    if (!sessionToken) {
      return context.json({ ok: false, kind: "unauthenticated" } as const, 401);
    }
    const result = await dependencies
      .createIdentity(context.env)
      .sessions.openSession(sessionToken);
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

  authRoutes.post(
    "/logout",
    requireIntegrity,
    authentication.requireMutationSession(),
    async (context) => {
      await dependencies.createIdentity(context.env).sessions.logout(context.var.sessionToken);
      deleteSessionCookie(context);
      return context.body(null, 204);
    },
  );

  authRoutes.post("/invitations/accept", requireIntegrity, async (context) => {
    const request = await parsePublicJson(context, tokenPasswordRequest);
    if (request instanceof Response) return request;
    const result = await dependencies
      .createIdentity(context.env)
      .invitations.acceptInvitation(request);
    return context.json(result, result.ok ? 200 : 400);
  });

  authRoutes.post("/password-resets/use", requireIntegrity, async (context) => {
    const request = await parsePublicJson(context, tokenPasswordRequest);
    if (request instanceof Response) return request;
    const result = await dependencies
      .createIdentity(context.env)
      .passwordResets.usePasswordReset(request);
    return context.json(result, result.ok ? 200 : 400);
  });

  authRoutes.post("/operator-recovery", requireIntegrity, async (context) => {
    const request = await parsePublicJson(context, tokenPasswordRequest);
    if (request instanceof Response) return request;
    const result = await dependencies
      .createIdentity(context.env)
      .operatorRecovery.useOperatorRecovery(request);
    return context.json(result, result.ok ? 200 : 400);
  });

  authRoutes.post(
    "/reauthenticate",
    requireIntegrity,
    authentication.requireMutationSession(),
    async (context) => {
      const request = await parseJson(context.req.raw, passwordRequest);
      if (!request) {
        return context.json({ ok: false, kind: "invalid-request" } as const, 400);
      }
      const result = await dependencies.createIdentity(context.env).sessions.reauthenticate({
        token: context.var.sessionToken,
        password: request.password,
      });
      if (!result.ok) return context.json(result, 401);
      setSessionCookie(context, result.session);
      return context.json({
        ok: true as const,
        user: result.session.user,
        csrfToken: result.session.csrfToken,
      });
    },
  );

  authRoutes.post(
    "/password",
    requireIntegrity,
    authentication.requireMutationSession(),
    async (context) => {
      const request = await parseJson(context.req.raw, passwordChangeRequest);
      if (!request) {
        return context.json({ ok: false, kind: "invalid-request" } as const, 400);
      }
      const result = await dependencies.createIdentity(context.env).sessions.changePassword({
        userId: context.var.authenticatedUser.id,
        ...request,
      });
      if (result.ok) deleteSessionCookie(context);
      return context.json(result, result.ok ? 200 : 400);
    },
  );

  return authRoutes;
}

async function parsePublicJson<Schema extends z.ZodType>(
  context: Context<ManagementEnvironment>,
  schema: Schema,
): Promise<z.output<Schema> | Response> {
  const request = await parseJson(context.req.raw, schema);
  return request ?? context.json({ ok: false, kind: "invalid-request" } as const, 400);
}
