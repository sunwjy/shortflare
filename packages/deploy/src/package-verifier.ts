import { execFile as nodeExecFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";

import { z } from "zod";

import { renderCliHelp } from "./cli.js";
import { verifyReleaseBundle } from "./release-bundle.js";
import { parseReleaseManifest } from "./release-manifest.js";

const execFile = promisify(nodeExecFile);

const expectedDescription =
  "An open-source URL shortener designed to run in your own Cloudflare account.";
const expectedHomepage = "https://github.com/sunwjy/shortflare#readme";
const expectedBugsUrl = "https://github.com/sunwjy/shortflare/issues";
const expectedKeywords = ["cloudflare", "cloudflare-workers", "self-hosted", "url-shortener"];

const publicPackageSchema = z
  .object({
    name: z.literal("shortflare"),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    private: z.literal(false),
    description: z.literal(expectedDescription),
    license: z.literal("MIT"),
    repository: z.object({
      type: z.literal("git"),
      url: z.literal("git+https://github.com/sunwjy/shortflare.git"),
    }),
    homepage: z.literal(expectedHomepage),
    bugs: z.object({ url: z.literal(expectedBugsUrl) }),
    keywords: z.array(z.string()),
    engines: z.object({ node: z.literal(">=22.13.0") }),
    exports: z.literal("./dist/index.js"),
    bin: z.object({ shortflare: z.literal("./dist/bin.js") }),
    publishConfig: z.object({ access: z.literal("public"), provenance: z.literal(true) }),
  })
  .passthrough();

const npmPackResultSchema = z
  .array(
    z.object({ files: z.array(z.object({ path: z.string().min(1) }).passthrough()) }).passthrough(),
  )
  .length(1);

export async function verifyPackedPackage(
  input: Readonly<{
    packageRoot: string;
    workspaceRoot: string;
    allowlistPath: string;
    runNpmPack?: (packageRoot: string) => Promise<unknown>;
  }>,
): Promise<void> {
  const packageJson = publicPackageSchema.parse(
    JSON.parse(await readFile(path.join(input.packageRoot, "package.json"), "utf8")),
  );
  assertExactKeywords(packageJson.keywords);

  const manifestResult = parseReleaseManifest(
    JSON.parse(await readFile(path.join(input.packageRoot, "release", "manifest.json"), "utf8")),
  );
  if (!manifestResult.ok) throw new Error("The generated release manifest is invalid");
  if (manifestResult.value.release !== packageJson.version) {
    throw new Error("The package and release manifest versions do not match");
  }
  const bundleIntegrity = await verifyReleaseBundle(input.packageRoot, manifestResult.value);
  if (!bundleIntegrity.ok) {
    throw new Error(`The ${bundleIntegrity.artifact} release artifact does not match its digest`);
  }

  const [repositoryLicense, packageLicense, readme, changelog, notices, allowlist] =
    await Promise.all([
      readFile(path.join(input.workspaceRoot, "LICENSE"), "utf8"),
      readFile(path.join(input.packageRoot, "LICENSE"), "utf8"),
      readFile(path.join(input.packageRoot, "README.md"), "utf8"),
      readFile(path.join(input.packageRoot, "CHANGELOG.md"), "utf8"),
      readFile(path.join(input.packageRoot, "THIRD_PARTY_NOTICES.md"), "utf8"),
      readAllowedPaths(input.allowlistPath),
    ]);
  if (repositoryLicense !== packageLicense) {
    throw new Error("The packed MIT license does not match the repository license");
  }
  const guideUrl = `https://github.com/sunwjy/shortflare/blob/v${packageJson.version}/docs/deployment.md`;
  if (!readme.includes(guideUrl) || !renderCliHelp(packageJson.version).includes(guideUrl)) {
    throw new Error("The package documentation is not pinned to the package version");
  }
  if (!changelog.includes(`## [${packageJson.version}] - `)) {
    throw new Error("The changelog has no entry for the package version");
  }
  if (!notices.startsWith("# Third-Party Notices\n")) {
    throw new Error("The reviewed third-party notices are missing");
  }

  const rawPackResult = await (input.runNpmPack ?? runNpmPack)(input.packageRoot);
  const packResult = npmPackResultSchema.parse(rawPackResult)[0];
  if (packResult === undefined) throw new Error("npm pack returned no package");
  assertExactPackPaths(
    packResult.files.map((file) => file.path),
    allowlist,
  );
}

export function assertExactPackPaths(
  actualPaths: readonly string[],
  allowedPaths: readonly string[],
): void {
  const actual = [...new Set(actualPaths)].toSorted(compareCodePoints);
  const allowed = [...new Set(allowedPaths)].toSorted(compareCodePoints);
  const unexpected = actual.filter((file) => !allowed.includes(file));
  const missing = allowed.filter((file) => !actual.includes(file));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      [
        "The npm tarball does not match pack-allowlist.json",
        ...(unexpected.length === 0 ? [] : [`Unexpected: ${unexpected.join(", ")}`]),
        ...(missing.length === 0 ? [] : [`Missing: ${missing.join(", ")}`]),
      ].join("\n"),
    );
  }
}

async function readAllowedPaths(filePath: string): Promise<string[]> {
  const paths = z
    .array(z.string().min(1))
    .min(1)
    .parse(JSON.parse(await readFile(filePath, "utf8")));
  if (new Set(paths).size !== paths.length)
    throw new Error("pack-allowlist.json has duplicate paths");
  return paths;
}

async function runNpmPack(packageRoot: string): Promise<unknown> {
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), "shortflare-npm-cache-"));
  try {
    const { stdout } = await execFile("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: packageRoot,
      encoding: "utf8",
      env: { ...process.env, NPM_CONFIG_CACHE: cacheDirectory },
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
}

function assertExactKeywords(keywords: readonly string[]): void {
  const actual = [...keywords].toSorted(compareCodePoints);
  if (JSON.stringify(actual) !== JSON.stringify(expectedKeywords)) {
    throw new Error("The public package keywords do not match the reviewed discovery metadata");
  }
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
