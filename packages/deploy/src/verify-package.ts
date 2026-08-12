import { fileURLToPath } from "node:url";
import path from "node:path";

import { verifyPackedPackage } from "./package-verifier.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
await verifyPackedPackage({
  packageRoot,
  workspaceRoot,
  allowlistPath: path.join(packageRoot, "pack-allowlist.json"),
});
