import { execFile as nodeExecFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

import {
  assertPackedRuntimeDependencies,
  productionDependencyPolicySchema,
} from "./packed-runtime-dependencies.js";

const execFile = promisify(nodeExecFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await verifyPackedRuntimeDependencies(packageRoot);

async function verifyPackedRuntimeDependencies(root: string): Promise<void> {
  const packageJson = z
    .object({ name: z.literal("shortflare"), version: z.string().min(1) })
    .parse(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")));
  const policy = productionDependencyPolicySchema.parse(
    JSON.parse(await readFile(path.join(root, "production-dependency-policy.json"), "utf8")),
  );
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "shortflare-packed-runtime-"));
  const npmCache = path.join(temporaryRoot, "npm-cache");
  const environment = {
    ...process.env,
    NPM_CONFIG_CACHE: npmCache,
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  };

  try {
    await execFile("pnpm", ["pack", "--pack-destination", temporaryRoot], {
      cwd: root,
      env: environment,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    const tarballPath = path.join(temporaryRoot, `${packageJson.name}-${packageJson.version}.tgz`);
    await writeFile(
      path.join(temporaryRoot, "package.json"),
      JSON.stringify({ name: "shortflare-packed-runtime-verifier", private: true }),
    );
    await execFile(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        tarballPath,
      ],
      {
        cwd: temporaryRoot,
        env: environment,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      },
    );

    const packageNames = [
      packageJson.name,
      ...new Set(policy.dependencies.flatMap((expectation) => expectation.path)),
    ];
    const { stdout } = await execFile("npm", ["ls", ...packageNames, "--all", "--json"], {
      cwd: temporaryRoot,
      env: environment,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    assertPackedRuntimeDependencies(JSON.parse(stdout), {
      dependencies: [
        { path: [packageJson.name], version: packageJson.version },
        ...policy.dependencies,
      ],
    });
    process.stdout.write(
      `Verified packed runtime dependencies: ${policy.dependencies
        .map((dependency) => `${dependency.path.at(-1)}@${dependency.version}`)
        .join(", ")}\n`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
