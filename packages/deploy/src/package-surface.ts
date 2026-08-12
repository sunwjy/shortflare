import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const reviewedLicenseIdentifiers = new Set(["Apache-2.0", "ISC", "MIT", "MIT AND ISC", "OFL-1.1"]);

const licenseRecordSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  identifier: z.string().min(1),
  text: z.string().min(1),
});
const viteLicenseRecordSchema = licenseRecordSchema.extend({ text: z.string().min(1).optional() });

export type ThirdPartyLicense = z.infer<typeof licenseRecordSchema>;

export async function createThirdPartyNotices(
  input: Readonly<{
    viteBuildRoots: readonly string[];
    assetPackageRoots: readonly string[];
    fallbackPackageRoots?: readonly string[];
  }>,
): Promise<string> {
  const viteLicenseFiles = (
    await Promise.all(input.viteBuildRoots.map(findViteLicenseFiles))
  ).flat();
  if (viteLicenseFiles.length === 0) {
    throw new Error("No Vite license metadata was found in the release builds");
  }

  const rawLicenses = (
    await Promise.all([
      ...viteLicenseFiles.map(readViteLicenses),
      ...input.assetPackageRoots.map(readAssetLicense),
    ])
  ).flat();
  const fallbackLicenses = new Map(
    (await Promise.all((input.fallbackPackageRoots ?? []).map(readFallbackPackageLicense))).map(
      (license) => [`${license.name}@${license.version}`, license],
    ),
  );
  const licenses = rawLicenses.map((license) =>
    resolveLicenseText(license, rawLicenses, fallbackLicenses),
  );
  const uniqueLicenses = new Map<string, ThirdPartyLicense>();
  for (const license of licenses) {
    assertReviewedLicense(license);
    const key = `${license.name}@${license.version}`;
    const previous = uniqueLicenses.get(key);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(license)) {
      throw new Error(`Conflicting license metadata was found for ${key}`);
    }
    uniqueLicenses.set(key, license);
  }

  const entries = [...uniqueLicenses.values()].toSorted((left, right) =>
    compareCodePoints(`${left.name}@${left.version}`, `${right.name}@${right.version}`),
  );
  return renderThirdPartyNotices(entries);
}

export async function preparePublicPackageSurface(
  input: Readonly<{
    repositoryLicensePath: string;
    packageLicensePath: string;
    reviewedNoticesPath: string;
    viteBuildRoots: readonly string[];
    assetPackageRoots: readonly string[];
    fallbackPackageRoots?: readonly string[];
  }>,
): Promise<void> {
  await cp(input.repositoryLicensePath, input.packageLicensePath, { force: true });
  const [expectedNotices, reviewedNotices] = await Promise.all([
    createThirdPartyNotices(input),
    readFile(input.reviewedNoticesPath, "utf8"),
  ]);
  if (expectedNotices !== reviewedNotices) {
    throw new Error(
      "THIRD_PARTY_NOTICES.md does not match the bundled dependencies; regenerate and review it",
    );
  }
}

export async function writeThirdPartyNotices(
  input: Parameters<typeof createThirdPartyNotices>[0] & Readonly<{ outputPath: string }>,
): Promise<void> {
  await writeFile(input.outputPath, await createThirdPartyNotices(input), { mode: 0o644 });
}

export function renderThirdPartyNotices(licenses: readonly ThirdPartyLicense[]): string {
  const sections = licenses.map(
    (license) =>
      `## ${license.name}@${license.version} (${license.identifier})\n\n${normalizeText(license.text)}`,
  );
  return `# Third-Party Notices

Shortflare bundles the following third-party code and font assets. Each entry
reproduces the license text reported by the reviewed build input.

${sections.join("\n\n---\n\n")}
`;
}

async function findViteLicenseFiles(root: string): Promise<string[]> {
  return (
    await findFiles(root, (filePath) => {
      return (
        path.basename(filePath) === "license.json" &&
        path.basename(path.dirname(filePath)) === ".vite"
      );
    })
  ).toSorted(compareCodePoints);
}

async function readViteLicenses(filePath: string) {
  return z.array(viteLicenseRecordSchema).parse(JSON.parse(await readFile(filePath, "utf8")));
}

async function readFallbackPackageLicense(packageRoot: string): Promise<ThirdPartyLicense> {
  const packageJson = z
    .object({
      name: z.string().min(1),
      version: z.string().min(1),
      license: z.string().min(1),
    })
    .passthrough()
    .parse(JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")));
  const licenseFiles = await findLicenseFiles(packageRoot);
  if (licenseFiles.length === 0) {
    throw new Error(`No license text was found in fallback package ${packageJson.name}`);
  }
  const sections = await Promise.all(
    licenseFiles.map(async (filePath) => {
      const relativePath = path.relative(packageRoot, filePath).split(path.sep).join("/");
      return `License file: ${relativePath}\n\n${normalizeText(await readFile(filePath, "utf8"))}`;
    }),
  );
  return {
    name: packageJson.name,
    version: packageJson.version,
    identifier: packageJson.license,
    text: sections.join("\n\n"),
  };
}

async function findLicenseFiles(root: string): Promise<string[]> {
  return (
    await findFiles(root, (filePath) => {
      return /^(?:license|licence)(?:\.[^.]+)?$/i.test(path.basename(filePath));
    })
  ).toSorted(compareCodePoints);
}

async function findFiles(
  directory: string,
  matches: (filePath: string) => boolean,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findFiles(entryPath, matches);
      return Promise.resolve(entry.isFile() && matches(entryPath) ? [entryPath] : []);
    }),
  );
  return nestedFiles.flat();
}

function resolveLicenseText(
  license: z.infer<typeof viteLicenseRecordSchema>,
  allLicenses: readonly z.infer<typeof viteLicenseRecordSchema>[],
  fallbackLicenses: ReadonlyMap<string, ThirdPartyLicense>,
): ThirdPartyLicense {
  if (license.text !== undefined) return licenseRecordSchema.parse(license);
  const key = `${license.name}@${license.version}`;
  const fallback = fallbackLicenses.get(key);
  if (fallback !== undefined) {
    if (fallback.identifier !== license.identifier) {
      throw new Error(`Fallback license identifier does not match ${key}`);
    }
    return fallback;
  }
  if (license.identifier === "Apache-2.0") {
    const standardText = allLicenses.find(
      (candidate) => candidate.identifier === license.identifier && candidate.text !== undefined,
    )?.text;
    if (standardText !== undefined) return { ...license, text: standardText };
  }
  throw new Error(`No reviewed license text was found for ${key}`);
}

async function readAssetLicense(packageRoot: string): Promise<ThirdPartyLicense[]> {
  const packageJson = z
    .strictObject({
      name: z.string().min(1),
      version: z.string().min(1),
      license: z.string().min(1),
    })
    .passthrough()
    .parse(JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")));
  return [
    {
      name: packageJson.name,
      version: packageJson.version,
      identifier: packageJson.license,
      text: await readFile(path.join(packageRoot, "LICENSE"), "utf8"),
    },
  ];
}

function assertReviewedLicense(license: ThirdPartyLicense): void {
  if (!reviewedLicenseIdentifiers.has(license.identifier)) {
    throw new Error(
      `Unreviewed license identifier '${license.identifier}' for ${license.name}@${license.version}`,
    );
  }
}

function normalizeText(value: string): string {
  return value.replaceAll("\r\n", "\n").trim();
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
