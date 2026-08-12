import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createThirdPartyNotices, preparePublicPackageSurface } from "../src/package-surface";

describe("public package legal surface", () => {
  it("merges, sorts, and deduplicates bundled code and asset licenses", async () => {
    const fixture = await createFixture();
    await writeViteLicenses(fixture.buildRoot, [
      license("zod", "4.4.3", "MIT", "Zod license"),
      license("hono", "4.12.31", "MIT", "Hono license"),
      license("zod", "4.4.3", "MIT", "Zod license"),
    ]);
    await writeAssetLicense(fixture.assetRoot, "@fontsource-variable/geist", "5.3.0", "OFL-1.1");

    const notices = await createThirdPartyNotices({
      viteBuildRoots: [fixture.buildRoot],
      assetPackageRoots: [fixture.assetRoot],
    });

    expect(notices).toContain("## @fontsource-variable/geist@5.3.0 (OFL-1.1)");
    expect(notices.indexOf("## hono@")).toBeLessThan(notices.indexOf("## zod@"));
    expect(notices.match(/## zod@/g)).toHaveLength(1);
  });

  it("rejects an identifier that has not received explicit review", async () => {
    const fixture = await createFixture();
    await writeViteLicenses(fixture.buildRoot, [license("copyleft", "1.0.0", "GPL-3.0", "text")]);

    await expect(
      createThirdPartyNotices({ viteBuildRoots: [fixture.buildRoot], assetPackageRoots: [] }),
    ).rejects.toThrow("Unreviewed license identifier 'GPL-3.0'");
  });

  it("requires missing license text to come from a matching fallback package", async () => {
    const fixture = await createFixture();
    await writeViteLicenses(fixture.buildRoot, [
      { name: "victory-vendor", version: "37.3.6", identifier: "MIT AND ISC" },
    ]);
    await writeAssetLicense(fixture.assetRoot, "victory-vendor", "37.3.6", "MIT AND ISC");

    const notices = await createThirdPartyNotices({
      viteBuildRoots: [fixture.buildRoot],
      assetPackageRoots: [],
      fallbackPackageRoots: [fixture.assetRoot],
    });

    expect(notices).toContain("License file: LICENSE");
    expect(notices).toContain("Asset license");
  });

  it("copies the authoritative license and rejects stale reviewed notices", async () => {
    const fixture = await createFixture();
    const repositoryLicensePath = path.join(fixture.root, "LICENSE");
    const packageLicensePath = path.join(fixture.root, "package", "LICENSE");
    const reviewedNoticesPath = path.join(fixture.root, "package", "THIRD_PARTY_NOTICES.md");
    await mkdir(path.dirname(packageLicensePath), { recursive: true });
    await writeFile(repositoryLicensePath, "authoritative license\n");
    await writeFile(reviewedNoticesPath, "stale\n");
    await writeViteLicenses(fixture.buildRoot, [license("hono", "4.12.31", "MIT", "text")]);

    await expect(
      preparePublicPackageSurface({
        repositoryLicensePath,
        packageLicensePath,
        reviewedNoticesPath,
        viteBuildRoots: [fixture.buildRoot],
        assetPackageRoots: [],
      }),
    ).rejects.toThrow("does not match the bundled dependencies");
    await expect(readFile(packageLicensePath, "utf8")).resolves.toBe("authoritative license\n");
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "shortflare-package-surface-"));
  return {
    root,
    buildRoot: path.join(root, "build"),
    assetRoot: path.join(root, "asset"),
  };
}

async function writeViteLicenses(root: string, licenses: readonly unknown[]): Promise<void> {
  const metadataDirectory = path.join(root, "worker", ".vite");
  await mkdir(metadataDirectory, { recursive: true });
  await writeFile(path.join(metadataDirectory, "license.json"), JSON.stringify(licenses));
}

async function writeAssetLicense(
  root: string,
  name: string,
  version: string,
  identifier: string,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name, version, license: identifier }),
  );
  await writeFile(path.join(root, "LICENSE"), "Asset license\n");
}

function license(name: string, version: string, identifier: string, text: string) {
  return { name, version, identifier, text };
}
