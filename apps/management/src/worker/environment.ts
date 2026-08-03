import type { User } from "./identity";

/**
 * Cloudflare bindings available to the Management Worker.
 *
 * Keep this interface transport-only: domain modules receive the individual
 * dependencies they need instead of importing Worker context.
 */
export type ManagementBindings = {
  DB: D1Database;
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
