import { describe, expect, it } from "vitest";

import { parseReleaseManifest } from "../src/index";

describe("Shortflare Release manifest", () => {
  it("accepts one self-contained stable release", () => {
    const manifest = {
      formatVersion: 1,
      release: "1.0.0",
      schema: {
        version: 5,
        journalSha256: "1".repeat(64),
        migrations: ["0000_initial_schema.sql", "0005_deployment_control.sql"],
      },
      supportedSources: ["fresh", "0.9.0"],
      rollbackSafeFrom: ["0.9.0"],
      artifacts: {
        management: {
          path: "artifacts/management/index.js",
          sha256: "2".repeat(64),
        },
        redirect: {
          path: "artifacts/redirect/index.js",
          sha256: "3".repeat(64),
        },
        migrations: {
          path: "artifacts/migrations",
          sha256: "4".repeat(64),
        },
      },
    };

    expect(parseReleaseManifest(manifest)).toEqual({
      ok: true,
      value: manifest,
    });
  });

  it("rejects an artifact path that can escape the package", () => {
    const result = parseReleaseManifest({
      formatVersion: 1,
      release: "1.0.0",
      schema: {
        version: 5,
        journalSha256: "1".repeat(64),
        migrations: ["0000_initial_schema.sql", "0005_deployment_control.sql"],
      },
      supportedSources: ["fresh"],
      rollbackSafeFrom: [],
      artifacts: {
        management: {
          path: "../management/index.js",
          sha256: "2".repeat(64),
        },
        redirect: {
          path: "artifacts/redirect/index.js",
          sha256: "3".repeat(64),
        },
        migrations: {
          path: "artifacts/migrations",
          sha256: "4".repeat(64),
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "invalid-release-manifest",
      issues: [{ path: "artifacts.management.path" }],
    });
  });
});
