import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

import { preparePublicPackageSurface, writeThirdPartyNotices } from "./package-surface.js";

export function workspacePackageSurfacePaths(moduleUrl: string = import.meta.url) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..");
  const workspaceRoot = path.resolve(packageRoot, "../..");
  const managementRoot = path.join(workspaceRoot, "apps", "management");
  const managementRequire = createRequire(path.join(managementRoot, "package.json"));
  const rechartsRequire = createRequire(managementRequire.resolve("recharts"));
  return {
    packageRoot,
    workspaceRoot,
    repositoryLicensePath: path.join(workspaceRoot, "LICENSE"),
    packageLicensePath: path.join(packageRoot, "LICENSE"),
    reviewedNoticesPath: path.join(packageRoot, "THIRD_PARTY_NOTICES.md"),
    viteBuildRoots: [
      path.join(managementRoot, "dist"),
      path.join(workspaceRoot, "apps", "redirect-worker", "dist"),
    ],
    assetPackageRoots: [
      path.join(managementRoot, "node_modules", "@fontsource-variable", "geist"),
      path.join(managementRoot, "node_modules", "@fontsource-variable", "geist-mono"),
    ],
    fallbackPackageRoots: [path.dirname(rechartsRequire.resolve("victory-vendor/package.json"))],
  } as const;
}

export async function prepareWorkspacePackageSurface(): Promise<void> {
  await preparePublicPackageSurface(workspacePackageSurfacePaths());
}

export async function writeWorkspaceThirdPartyNotices(): Promise<void> {
  const paths = workspacePackageSurfacePaths();
  await writeThirdPartyNotices({
    viteBuildRoots: paths.viteBuildRoots,
    assetPackageRoots: paths.assetPackageRoots,
    fallbackPackageRoots: paths.fallbackPackageRoots,
    outputPath: paths.reviewedNoticesPath,
  });
}
