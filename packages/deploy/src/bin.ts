#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderCliHelp, runCli } from "./cli.js";
import type { DeploymentPlan } from "./deployment-plan.js";
import { createProductionApplication } from "./production-application.js";

const rawArguments = process.argv.slice(2);
const jsonMode = rawArguments.includes("--json");
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (rawArguments.includes("--help") || rawArguments.includes("-h")) {
  process.stdout.write(renderCliHelp(await readPackageVersion()));
} else {
  await runMain();
}

async function runMain(): Promise<void> {
  try {
    const secretInput = needsSecretInput(rawArguments)
      ? await readSecretInput(process.stdin)
      : undefined;
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    const completedArguments = await completeArguments(rawArguments, prompt);
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (apiToken === undefined || apiToken.length === 0) {
      throw new Error(
        "CLOUDFLARE_API_TOKEN is required. Create a scoped token for D1, Workers, Queues, and domains.",
      );
    }
    const application = await createProductionApplication({
      packageRoot,
      apiToken,
      environment: process.env,
      platform: process.platform,
      homeDirectory: process.env.HOME ?? process.cwd(),
      promptApproval: (plan) => confirmPlan(prompt, plan),
      promptAdministratorEmail: process.stdin.isTTY
        ? () => prompt.question("Initial Administrator email: ")
        : async () => undefined,
      ...(secretInput === undefined ? {} : { secretInput }),
    });
    const exitCode = await runCli(completedArguments, application, {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    });
    prompt.close();
    process.exitCode = exitCode;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Shortflare failed unexpectedly";
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, formatVersion: 1, error: { kind: "startup-failure", message } })}\n`,
      );
    } else {
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
}

async function readPackageVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string") throw new Error("Package version is missing");
  return packageJson.version;
}

async function completeArguments(
  arguments_: readonly string[],
  prompt: ReturnType<typeof createInterface>,
): Promise<readonly string[]> {
  const completed = [...arguments_];
  const command = completed[0];
  if (!hasOption(completed, "--account-id") && process.env.CLOUDFLARE_ACCOUNT_ID !== undefined) {
    completed.push("--account-id", process.env.CLOUDFLARE_ACCOUNT_ID);
  }
  if (command !== "deploy" || completed.includes("--json") || !process.stdin.isTTY) {
    return completed;
  }
  if (!hasOption(completed, "--redirect-domain")) {
    completed.push("--redirect-domain", await prompt.question("Redirect custom domain: "));
  }
  return completed;
}

async function confirmPlan(
  prompt: ReturnType<typeof createInterface>,
  plan: DeploymentPlan,
): Promise<boolean> {
  process.stderr.write(
    `\nDeployment plan ${plan.digest}\n${plan.sourceRelease} -> ${plan.targetRelease}\n` +
      `${plan.actions.map((action) => `- ${action.kind}`).join("\n")}\n`,
  );
  const answer = await prompt.question("Apply this plan? [y/N] ");
  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
}

function hasOption(arguments_: readonly string[], name: string): boolean {
  return arguments_.some((argument) => argument === name || argument.startsWith(`${name}=`));
}

function needsSecretInput(arguments_: readonly string[]): boolean {
  return arguments_.includes("--setup-token-stdin") || arguments_.includes("--secret-stdin");
}

async function readSecretInput(stream: NodeJS.ReadableStream): Promise<string> {
  let value = "";
  for await (const chunk of stream) {
    value += String(chunk);
    if (value.length > 1024) throw new Error("Secret input exceeds 1024 characters");
  }
  const secret = value.replace(/[\r\n]+$/, "");
  if (secret.length === 0) throw new Error("Secret input is empty");
  if (
    rawArguments[0] === "recover" &&
    rawArguments[1] === "analytics-secret" &&
    !/^[A-Za-z0-9_-]{43}$/.test(secret)
  ) {
    throw new Error("Analytics secret must be an unpadded base64url 256-bit value");
  }
  return secret;
}
