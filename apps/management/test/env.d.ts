declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    REDIRECT_DOMAIN: string;
    TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
  }
}
