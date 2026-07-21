interface IntegrationProbeEvent {
  eventId: string;
  emittedAt: string;
}

declare namespace Cloudflare {
  interface Env {
    ANALYTICS_QUEUE: Queue<IntegrationProbeEvent>;
    DB: D1Database;
    ENABLE_INTEGRATION_PROBES: string;
    MANAGEMENT: Fetcher;
    TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
  }
}
