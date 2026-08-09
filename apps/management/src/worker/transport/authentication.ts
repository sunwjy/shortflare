import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

import type { Capability } from "../access-control";
import type { ManagementDependencies } from "../dependencies";
import type { ManagementEnvironment } from "../environment";
import { createRequestRateLimitMiddleware } from "./request-rate-limits";

const sessionCookieName = "__Host-shortflare_session";

export type AuthenticationFailure =
  | "forbidden"
  | "unauthenticated"
  | "invalid-csrf-token"
  | "reauthentication-required";

export type AuthenticationFailurePresenter = (
  context: Context<ManagementEnvironment>,
  kind: AuthenticationFailure,
  status: 401 | 403,
) => Response;

type AuthenticationDependencies = Pick<
  ManagementDependencies,
  "createRequestAuthentication" | "createRequestRateLimits" | "hasCapability"
>;

export function createAuthenticationMiddleware(
  dependencies: AuthenticationDependencies,
  presentFailure: AuthenticationFailurePresenter,
) {
  const rateLimits = createRequestRateLimitMiddleware(dependencies);
  const requireSafeSession = () =>
    createMiddleware<ManagementEnvironment>(async (context, next) => {
      const sessionToken = getCookie(context, sessionCookieName);
      if (!sessionToken) return presentFailure(context, "unauthenticated", 401);
      const authentication = await dependencies
        .createRequestAuthentication(context.env)
        .authenticateSafe(sessionToken);
      if (!authentication.ok) return presentFailure(context, authentication.kind, 401);
      context.set("authenticatedUser", authentication.user);
      const rateLimitFailure = await rateLimits.enforceGeneralUser(context);
      if (rateLimitFailure) return rateLimitFailure;
      await next();
    });

  const requireMutationSession = () =>
    createMiddleware<ManagementEnvironment>(async (context, next) => {
      const sessionToken = getCookie(context, sessionCookieName);
      if (!sessionToken) return presentFailure(context, "unauthenticated", 401);
      const authentication = await dependencies
        .createRequestAuthentication(context.env)
        .authenticateMutation({
          sessionToken,
          csrfToken: context.req.header("x-csrf-token") ?? "",
        });
      if (!authentication.ok) {
        const status = authentication.kind === "unauthenticated" ? 401 : 403;
        return presentFailure(context, authentication.kind, status);
      }
      context.set("authenticatedUser", authentication.user);
      context.set("sessionToken", sessionToken);
      context.set("recentlyAuthenticated", authentication.recentlyAuthenticated);
      const rateLimitFailure = await rateLimits.enforceGeneralUser(context);
      if (rateLimitFailure) return rateLimitFailure;
      await next();
    });

  const requireCapability = (capability: Capability) =>
    createMiddleware<ManagementEnvironment>(async (context, next) => {
      if (!dependencies.hasCapability(context.var.authenticatedUser, capability)) {
        return presentFailure(context, "forbidden", 403);
      }
      await next();
    });

  const ensureRecentAuthentication = (context: Context<ManagementEnvironment>) =>
    context.var.recentlyAuthenticated
      ? undefined
      : presentFailure(context, "reauthentication-required", 403);

  return {
    ensureRecentAuthentication,
    requireCapability,
    requireMutationSession,
    requireSafeSession,
  };
}
