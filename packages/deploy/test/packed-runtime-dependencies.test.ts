import { describe, expect, it } from "vitest";

import {
  assertPackedRuntimeDependencies,
  type ProductionDependencyPolicy,
} from "../src/packed-runtime-dependencies";

const expectedPolicy = {
  dependencies: [
    { path: ["shortflare"], version: "0.1.0" },
    { path: ["shortflare", "wrangler"], version: "4.120.1" },
    {
      path: ["shortflare", "wrangler", "miniflare", "sharp"],
      version: "0.35.2",
    },
  ],
} as const satisfies ProductionDependencyPolicy;

describe("packed runtime dependencies", () => {
  it("accepts the exact dependency versions at their intended runtime paths", () => {
    expect(() => assertPackedRuntimeDependencies(validTree(), expectedPolicy)).not.toThrow();
  });

  it("rejects a dependency that is present only outside its intended runtime path", () => {
    const tree = validTree({ includeSharpAtExpectedPath: false, includeSharpAtRoot: true });

    expect(() => assertPackedRuntimeDependencies(tree, expectedPolicy)).toThrowError(
      "Packed runtime dependency path is missing: shortflare > wrangler > miniflare > sharp",
    );
  });

  it("rejects an unexpected version at an intended runtime path", () => {
    const tree = validTree({ wranglerVersion: "4.112.0" });

    expect(() => assertPackedRuntimeDependencies(tree, expectedPolicy)).toThrowError(
      "Packed runtime dependency shortflare > wrangler resolved to 4.112.0; expected 4.120.1",
    );
  });
});

function validTree(
  input: Readonly<{
    wranglerVersion?: string;
    includeSharpAtExpectedPath?: boolean;
    includeSharpAtRoot?: boolean;
  }> = {},
) {
  const includeSharpAtExpectedPath = input.includeSharpAtExpectedPath ?? true;
  return {
    dependencies: {
      shortflare: {
        version: "0.1.0",
        dependencies: {
          wrangler: {
            version: input.wranglerVersion ?? "4.120.1",
            dependencies: {
              miniflare: {
                version: "5.20260804.0-alpha",
                dependencies: includeSharpAtExpectedPath ? { sharp: { version: "0.35.2" } } : {},
              },
            },
          },
        },
      },
      ...(input.includeSharpAtRoot ? { sharp: { version: "0.35.2" } } : {}),
    },
  };
}
