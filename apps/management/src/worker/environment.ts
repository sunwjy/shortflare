import type { User } from "./modules/identity";

/**
 * Cloudflare bindings available to the Management Worker.
 *
 * Keep this interface transport-only: domain modules receive the individual
 * dependencies they need instead of importing Worker context.
 */
export type ManagementBindings = {
  CREDENTIAL_SOURCE_RATE_LIMITER: RateLimit;
  DB: D1Database;
  GENERAL_USER_RATE_LIMITER: RateLimit;
  LOGIN_TARGET_RATE_LIMITER: RateLimit;
  MANAGEMENT_SOURCE_RATE_LIMITER: RateLimit;
  PRIVILEGED_ACTOR_RATE_LIMITER: RateLimit;
  REDIRECT_DOMAIN: string;
};

export type ManagementEnvironment = {
  Bindings: ManagementBindings;
  Variables: {
    authenticatedUser: User;
    sessionToken: string;
    recentlyAuthenticated: boolean;
  };
};
