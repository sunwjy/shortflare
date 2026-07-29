import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";

import type { ManagementEnvironment } from "../environment";
import {
  authenticateMutation,
  deleteSessionCookie,
  isSameOriginJsonRequest,
  parseJson,
  setSessionCookie,
} from "../http";
import { createIdentity } from "../identity";
import {
  loginRequest,
  passwordChangeRequest,
  passwordRequest,
  setupRequest,
  tokenPasswordRequest,
} from "../request-schemas";

export const authRoutes = new Hono<ManagementEnvironment>();

authRoutes.post("/setup", async (context) => {
  const request = await parsePublicJson(context, setupRequest);
  if (request instanceof Response) return request;
  const result = await createIdentity({ db: context.env.DB }).completeInitialSetup(request);
  return context.json(result, result.ok ? 201 : 400);
});

authRoutes.post("/login", async (context) => {
  const request = await parsePublicJson(context, loginRequest);
  if (request instanceof Response) return request;
  const result = await createIdentity({ db: context.env.DB }).login(request);
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

authRoutes.post("/logout", async (context) => {
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
    return authentication.kind === "invalid-credentials"
      ? context.json({ ok: false, kind: "unauthenticated" } as const, 401)
      : context.json({ ok: false, kind: "invalid-csrf-token" } as const, 403);
  }
  await identity.logout(sessionToken);
  deleteSessionCookie(context);
  return context.body(null, 204);
});

authRoutes.post("/invitations/accept", async (context) => {
  const request = await parsePublicJson(context, tokenPasswordRequest);
  if (request instanceof Response) return request;
  const result = await createIdentity({ db: context.env.DB }).acceptInvitation(request);
  return context.json(result, result.ok ? 200 : 400);
});

authRoutes.post("/password-resets/use", async (context) => {
  const request = await parsePublicJson(context, tokenPasswordRequest);
  if (request instanceof Response) return request;
  const result = await createIdentity({ db: context.env.DB }).usePasswordReset(request);
  return context.json(result, result.ok ? 200 : 400);
});

authRoutes.post("/operator-recovery", async (context) => {
  const request = await parsePublicJson(context, tokenPasswordRequest);
  if (request instanceof Response) return request;
  const result = await createIdentity({ db: context.env.DB }).useOperatorRecovery(request);
  return context.json(result, result.ok ? 200 : 400);
});

authRoutes.post("/reauthenticate", async (context) => {
  const authenticated = await authenticateMutation(context);
  if ("response" in authenticated) return authenticated.response;
  const request = await parseJson(context.req.raw, passwordRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const result = await authenticated.identity.reauthenticate({
    token: authenticated.sessionToken,
    password: request.password,
  });
  if (!result.ok) return context.json(result, 401);
  setSessionCookie(context, result.session);
  return context.json({
    ok: true as const,
    user: result.session.user,
    csrfToken: result.session.csrfToken,
  });
});

authRoutes.post("/password", async (context) => {
  const authenticated = await authenticateMutation(context);
  if ("response" in authenticated) return authenticated.response;
  const request = await parseJson(context.req.raw, passwordChangeRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }
  const result = await authenticated.identity.changePassword({
    userId: authenticated.user.id,
    ...request,
  });
  if (result.ok) deleteSessionCookie(context);
  return context.json(result, result.ok ? 200 : 400);
});

async function parsePublicJson<Schema extends z.ZodType>(
  context: Context<ManagementEnvironment>,
  schema: Schema,
): Promise<z.output<Schema> | Response> {
  if (!isSameOriginJsonRequest(context.req.raw)) {
    return context.json({ ok: false, kind: "forbidden" } as const, 403);
  }
  const request = await parseJson(context.req.raw, schema);
  return request ?? context.json({ ok: false, kind: "invalid-request" } as const, 400);
}
