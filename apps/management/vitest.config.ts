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
        miniflare: {
          bindings: {
            REDIRECT_DOMAIN: "short.test",
            TEST_MIGRATIONS: migrations,
          },
          compatibilityDate: "2026-07-19",
          d1Databases: { DB: "shortflare-management-test" },
          ratelimits: {
            CREDENTIAL_SOURCE_RATE_LIMITER: {
              namespace_id: "test-credential-source",
              simple: { limit: 100_000, period: 60 },
            },
            GENERAL_USER_RATE_LIMITER: {
              namespace_id: "test-general-user",
              simple: { limit: 100_000, period: 60 },
            },
            LOGIN_TARGET_RATE_LIMITER: {
              namespace_id: "test-login-target",
              simple: { limit: 100_000, period: 60 },
            },
            MANAGEMENT_SOURCE_RATE_LIMITER: {
              namespace_id: "test-management-source",
              simple: { limit: 100_000, period: 60 },
            },
            PRIVILEGED_ACTOR_RATE_LIMITER: {
              namespace_id: "test-privileged-actor",
              simple: { limit: 100_000, period: 60 },
            },
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["../../packages/database/test/apply-migrations.ts"],
    },
  };
});
