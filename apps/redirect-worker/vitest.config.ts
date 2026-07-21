import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.resolve(projectDirectory, "../../packages/database/drizzle/migrations"),
  );

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            ENABLE_INTEGRATION_PROBES: "true",
            TEST_MIGRATIONS: migrations,
          },
          d1Databases: { DB: "shortflare-local" },
          queueProducers: { ANALYTICS_QUEUE: "shortflare-events" },
          serviceBindings: { MANAGEMENT: "shortflare-management" },
          workers: [
            {
              name: "shortflare-management",
              modules: true,
              scriptPath: "./.wrangler/integration/management/index.js",
              compatibilityDate: "2026-07-19",
              bindings: { ENABLE_INTEGRATION_PROBES: "true" },
              d1Databases: { DB: "shortflare-local" },
              queueConsumers: {
                "shortflare-events": { maxBatchTimeout: 0.05 },
              },
            },
          ],
        },
      }),
    ],
    test: {
      globalSetup: ["./vitest.global.ts"],
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
