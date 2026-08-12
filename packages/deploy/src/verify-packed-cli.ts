import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  produceVerifiedPackedCli,
  smokePackedCliArtifactDirectory,
} from "./packed-cli-verifier.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const [command, ...arguments_] = process.argv.slice(2);

if (command === "produce" && arguments_.length === 1) {
  const artifact = await produceVerifiedPackedCli({
    packageRoot,
    workspaceRoot,
    allowlistPath: path.join(packageRoot, "pack-allowlist.json"),
    destination: path.resolve(arguments_[0] ?? ""),
  });
  process.stdout.write(
    `Verified packed CLI ${artifact.version} (${artifact.sha256}) at ${artifact.tarballPath}\n`,
  );
} else if (command === "smoke" && arguments_.length === 1) {
  const result = await smokePackedCliArtifactDirectory({
    packageRoot,
    artifactDirectory: path.resolve(arguments_[0] ?? ""),
  });
  process.stdout.write(`Smoked packed CLI ${result.version} (${result.sha256})\n`);
} else {
  process.stderr.write(
    "Usage: verify-packed-cli produce <destination> | smoke <artifact-directory>\n",
  );
  process.exitCode = 2;
}
