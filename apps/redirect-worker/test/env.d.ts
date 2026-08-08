declare namespace Cloudflare {
  interface Env {
    ANALYTICS_HMAC_KEY: string;
    ANALYTICS_QUEUE: Queue;
    DB: D1Database;
    REDIRECT_DOMAIN: string;
    TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
  }
}
