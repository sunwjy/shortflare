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
          d1Databases: { DB: "shortflare-redirect-test" },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["../../packages/database/test/apply-migrations.ts"],
    },
  };
});
