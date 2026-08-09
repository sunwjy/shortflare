declare namespace Cloudflare {
  interface Env {
    CREDENTIAL_SOURCE_RATE_LIMITER: RateLimit;
    DB: D1Database;
    GENERAL_USER_RATE_LIMITER: RateLimit;
    LOGIN_TARGET_RATE_LIMITER: RateLimit;
    MANAGEMENT_SOURCE_RATE_LIMITER: RateLimit;
    PRIVILEGED_ACTOR_RATE_LIMITER: RateLimit;
    REDIRECT_DOMAIN: string;
    TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
  }
}
