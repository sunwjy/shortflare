import { createD1LinksPersistence } from "@shortflare/database";
import { createLinks } from "@shortflare/links";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import { createIdentity, type User } from "./identity";

const healthResponse = z.object({ status: z.literal("ok") });
const createLinkRequest = z.strictObject({
  alias: z.string(),
  title: z.string(),
  destination: z.string(),
});
const setupRequest = z.strictObject({
  token: z.string(),
  password: z.string(),
});
const loginRequest = z.strictObject({
  email: z.string(),
  password: z.string(),
});
const invitationRequest = z.strictObject({
  email: z.string(),
  role: z.enum(["administrator", "member", "viewer"]),
});
const tokenPasswordRequest = z.strictObject({
  token: z.string(),
  password: z.string(),
});
const passwordRequest = z.strictObject({
  password: z.string(),
});
const passwordChangeRequest = z.strictObject({
  currentPassword: z.string(),
  password: z.string(),
});
const roleRequest = z.strictObject({
  role: z.enum(["administrator", "member", "viewer"]),
});
const emptyRequest = z.strictObject({});

type Bindings = {
  DB: D1Database;
  REDIRECT_DOMAIN: string;
};
type AppEnvironment = { Bindings: Bindings };

export const app = new Hono<AppEnvironment>();

app.use("*", async (context, next) => {
  await next();
  context.header("Referrer-Policy", "no-referrer");
  if (context.req.path.startsWith("/api/")) {
    context.header("Cache-Control", "no-store");
  }
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
    administrator: true,
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
  const authenticated = await authenticateSafe(context, true);
  if ("response" in authenticated) {
    return authenticated.response;
  }
  return context.json({ ok: true as const, users: await authenticated.identity.listUsers() });
});

app.post("/api/internal/users/:userId/cancel-invitation", async (context) => {
  const authenticated = await authenticateMutation(context, { administrator: true });
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
    administrator: true,
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
  const identity = createIdentity({ db: context.env.DB });
  const target = await identity.getUser(context.req.param("userId"));
  const recent = request.role === "administrator" || target?.role === "administrator";
  const authenticated = await authenticateMutation(context, { administrator: true, recent });
  if ("response" in authenticated) {
    return authenticated.response;
  }
  const result = await authenticated.identity.changeRole({
    actorId: authenticated.user.id,
    userId: context.req.param("userId"),
    role: request.role,
  });
  return context.json(result, result.ok ? 200 : result.kind === "user-not-found" ? 404 : 409);
});

app.post("/api/internal/users/:userId/suspend", async (context) => {
  const identity = createIdentity({ db: context.env.DB });
  const target = await identity.getUser(context.req.param("userId"));
  const authenticated = await authenticateMutation(context, {
    administrator: true,
    recent: target?.role === "administrator",
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
  });
  return context.json(result, result.ok ? 200 : result.kind === "user-not-found" ? 404 : 409);
});

app.post("/api/internal/users/:userId/reactivate", async (context) => {
  const authenticated = await authenticateMutation(context, { administrator: true });
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

app.post("/api/internal/links", async (context) => {
  if (!isSameOriginJsonRequest(context.req.raw)) {
    return context.json({ ok: false, kind: "forbidden" } as const, 403);
  }
  const sessionToken = getCookie(context, "__Host-shortflare_session");
  if (!sessionToken) {
    return context.json({ ok: false, kind: "unauthenticated" } as const, 401);
  }
  const authentication = await createIdentity({ db: context.env.DB }).authenticateRequest(
    sessionToken,
    context.req.header("x-csrf-token") ?? "",
  );
  if (!authentication.ok) {
    const status = authentication.kind === "invalid-credentials" ? 401 : 403;
    const kind = status === 401 ? "unauthenticated" : "invalid-csrf-token";
    return context.json({ ok: false, kind }, status);
  }
  if (authentication.user.role === "viewer") {
    return context.json({ ok: false, kind: "forbidden" } as const, 403);
  }

  const request = await parseJson(context.req.raw, createLinkRequest);
  if (!request) {
    return context.json({ ok: false, kind: "invalid-request" } as const, 400);
  }

  const links = createLinks({
    persistence: createD1LinksPersistence(context.env.DB),
    redirectDomain: context.env.REDIRECT_DOMAIN,
  });
  const result = await links.execute(
    { kind: "create", ...request },
    { id: authentication.user.id },
  );
  if (result.ok) {
    return context.json(result, 201);
  }
  const status = result.kind === "alias-in-use" || result.kind === "alias-reserved" ? 409 : 400;
  return context.json(result, status);
});

function isSameOriginJsonRequest(request: Request) {
  return (
    request.headers.get("origin") === new URL(request.url).origin &&
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
      "application/json"
  );
}

async function parseJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.output<Schema> | undefined> {
  try {
    const result = schema.safeParse(await request.json());
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function deleteSessionCookie(context: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(context, "__Host-shortflare_session", {
    path: "/",
    secure: true,
  });
}

function setSessionCookie(
  context: Context<AppEnvironment>,
  session: Readonly<{ token: string; expiresAt: Date }>,
) {
  const maxAge = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1_000));
  setCookie(context, "__Host-shortflare_session", session.token, {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "Lax",
    secure: true,
  });
}

async function authenticateMutation(
  context: Context<AppEnvironment>,
  requirements: Readonly<{ administrator?: boolean; recent?: boolean }> = {},
): Promise<
  | Readonly<{
      identity: ReturnType<typeof createIdentity>;
      user: User;
      sessionToken: string;
    }>
  | Readonly<{ response: Response }>
> {
  if (!isSameOriginJsonRequest(context.req.raw)) {
    return {
      response: context.json({ ok: false, kind: "forbidden" } as const, 403),
    };
  }
  const sessionToken = getCookie(context, "__Host-shortflare_session");
  if (!sessionToken) {
    return {
      response: context.json({ ok: false, kind: "unauthenticated" } as const, 401),
    };
  }
  const identity = createIdentity({ db: context.env.DB });
  const authentication = await identity.authenticateRequest(
    sessionToken,
    context.req.header("x-csrf-token") ?? "",
    requirements.recent,
  );
  if (!authentication.ok) {
    const unauthenticated = authentication.kind === "invalid-credentials";
    return {
      response: context.json(
        {
          ok: false,
          kind: unauthenticated ? "unauthenticated" : authentication.kind,
        },
        unauthenticated ? 401 : 403,
      ),
    };
  }
  if (requirements.administrator && authentication.user.role !== "administrator") {
    return {
      response: context.json({ ok: false, kind: "forbidden" } as const, 403),
    };
  }
  return { identity, user: authentication.user, sessionToken };
}

async function authenticateSafe(
  context: Context<AppEnvironment>,
  administrator = false,
): Promise<
  | Readonly<{ identity: ReturnType<typeof createIdentity>; user: User }>
  | Readonly<{ response: Response }>
> {
  const sessionToken = getCookie(context, "__Host-shortflare_session");
  if (!sessionToken) {
    return {
      response: context.json({ ok: false, kind: "unauthenticated" } as const, 401),
    };
  }
  const identity = createIdentity({ db: context.env.DB });
  const authentication = await identity.authenticate(sessionToken);
  if (!authentication.ok) {
    return {
      response: context.json({ ok: false, kind: "unauthenticated" } as const, 401),
    };
  }
  if (administrator && authentication.user.role !== "administrator") {
    return {
      response: context.json({ ok: false, kind: "forbidden" } as const, 403),
    };
  }
  return { identity, user: authentication.user };
}

export default app;
