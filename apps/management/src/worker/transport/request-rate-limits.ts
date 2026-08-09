import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import type { ManagementDependencies } from "../dependencies";
import type { ManagementBindings, ManagementEnvironment } from "../environment";

export type RateLimitBudget =
  | "management-source"
  | "credential-source"
  | "login-target"
  | "privileged-actor"
  | "general-user";

export type RequestRateLimits = Readonly<{
  limit(budget: RateLimitBudget, key: string): Promise<boolean>;
}>;

type RateLimitDependencies = Pick<ManagementDependencies, "createRequestRateLimits">;

const retryAfterSeconds = 60;

export function createCloudflareRequestRateLimits(bindings: ManagementBindings): RequestRateLimits {
  const limits: Record<RateLimitBudget, RateLimit> = {
    "management-source": bindings.MANAGEMENT_SOURCE_RATE_LIMITER,
    "credential-source": bindings.CREDENTIAL_SOURCE_RATE_LIMITER,
    "login-target": bindings.LOGIN_TARGET_RATE_LIMITER,
    "privileged-actor": bindings.PRIVILEGED_ACTOR_RATE_LIMITER,
    "general-user": bindings.GENERAL_USER_RATE_LIMITER,
  };
  return {
    async limit(budget, key) {
      return (await limits[budget].limit({ key })).success;
    },
  };
}

export function createRequestRateLimitMiddleware(dependencies: RateLimitDependencies) {
  const requireBudget = (
    budget: RateLimitBudget,
    key: (context: Context<ManagementEnvironment>) => string,
  ) =>
    createMiddleware<ManagementEnvironment>(async (context, next) => {
      const failure = await enforceRateLimit(context, dependencies, budget, key(context));
      if (failure) return failure;
      await next();
    });

  return {
    enforceGeneralUser: (context: Context<ManagementEnvironment>) =>
      enforceRateLimit(context, dependencies, "general-user", context.var.authenticatedUser.id),
    enforceLoginTarget: (context: Context<ManagementEnvironment>, normalizedEmail: string) =>
      enforceRateLimit(context, dependencies, "login-target", normalizedEmail),
    requireCredentialSource: () => requireBudget("credential-source", requestSourceKey),
    requireManagementSource: () => requireBudget("management-source", requestSourceKey),
    requirePrivilegedActor: () =>
      requireBudget("privileged-actor", (context) => context.var.authenticatedUser.id),
  };
}

async function enforceRateLimit(
  context: Context<ManagementEnvironment>,
  dependencies: RateLimitDependencies,
  budget: RateLimitBudget,
  key: string,
) {
  const allowed = await dependencies.createRequestRateLimits(context.env).limit(budget, key);
  if (allowed) return undefined;
  context.header("retry-after", String(retryAfterSeconds));
  return context.json({ ok: false, kind: "rate-limited" } as const, 429);
}

function requestSourceKey(context: Context<ManagementEnvironment>) {
  return context.req.header("cf-connecting-ip") ?? "unknown";
}
