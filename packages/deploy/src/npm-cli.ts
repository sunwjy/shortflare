import { execFile as nodeExecFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);

/**
 * Runs npm through its JavaScript entrypoint with Node and argument arrays.
 * Windows exposes npm through a .cmd shim, which Node cannot execute directly
 * while preserving shell-free subprocesses.
 */
export async function runNpm(
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
  }>,
): Promise<Readonly<{ stdout: string; stderr: string }>> {
  const npmCliPath = await resolveNpmCliPath();
  return execFile(process.execPath, [npmCliPath, ...args], {
    ...options,
    encoding: "utf8",
  });
}

async function resolveNpmCliPath(): Promise<string> {
  const executableDirectory = path.dirname(process.execPath);
  const candidates = [
    path.join(executableDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(executableDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(
      executableDirectory,
      "..",
      "libexec",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ];
  const readableCandidates = await Promise.all(candidates.map(isReadableFile));
  const candidate = candidates.find((_, index) => readableCandidates[index]);
  if (candidate !== undefined) return candidate;
  throw new Error("Could not locate the npm CLI bundled with Node.js");
}

async function isReadableFile(filePath: string): Promise<boolean> {
  return access(filePath, constants.R_OK).then(
    () => true,
    () => false,
  );
}
