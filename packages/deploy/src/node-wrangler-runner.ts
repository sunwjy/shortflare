import { spawn as nodeSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { WranglerRun } from "./wrangler-adapter.js";

type SpawnedProcess = Readonly<{
  stdout: Readonly<{ on(event: "data", listener: (chunk: Uint8Array) => void): unknown }>;
  stderr: Readonly<{ on(event: "data", listener: (chunk: Uint8Array) => void): unknown }>;
  stdin: Readonly<{ write(chunk: string): unknown; end(): unknown }>;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (exitCode: number | null) => void): unknown;
}>;

type SpawnProcess = (
  command: string,
  arguments_: readonly string[],
  options: Readonly<{
    shell: false;
    stdio: readonly ["pipe", "pipe", "pipe"];
    env: NodeJS.ProcessEnv;
  }>,
) => SpawnedProcess;

export function createNodeWranglerRun(
  input: Readonly<{
    executable?: string;
    wranglerModule?: string;
    spawn?: SpawnProcess;
    environment?: NodeJS.ProcessEnv;
  }> = {},
): WranglerRun {
  const executable = input.executable ?? process.execPath;
  const wranglerModule = input.wranglerModule ?? fileURLToPath(import.meta.resolve("wrangler"));
  const environment = input.environment ?? process.env;
  const spawnProcess: SpawnProcess =
    input.spawn ??
    ((command, arguments_) =>
      nodeSpawn(command, [...arguments_], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: environment,
      }));

  return async (arguments_, options) =>
    new Promise((resolve, reject) => {
      const child = spawnProcess(executable, [wranglerModule, ...arguments_], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: environment,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Uint8Array) => stdout.push(Buffer.from(chunk)));
      child.stderr.on("data", (chunk: Uint8Array) => stderr.push(Buffer.from(chunk)));
      child.once("error", reject);
      child.once("close", (exitCode) => {
        resolve({
          exitCode: exitCode ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
      if (options?.stdin !== undefined) child.stdin.write(`${options.stdin}\n`);
      child.stdin.end();
    });
}
