#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCli } from "./cli.js";
import type { DeploymentPlan } from "./deployment-plan.js";
import { createProductionApplication } from "./production-application.js";

const rawArguments = process.argv.slice(2);
const jsonMode = rawArguments.includes("--json");

try {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  const completedArguments = await completeArguments(rawArguments, prompt);
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (apiToken === undefined || apiToken.length === 0) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN is required. Create a scoped token for D1, Workers, Queues, and domains.",
    );
  }
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const application = await createProductionApplication({
    packageRoot,
    apiToken,
    environment: process.env,
    platform: process.platform,
    homeDirectory: process.env.HOME ?? process.cwd(),
    promptApproval: (plan) => confirmPlan(prompt, plan),
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
  if (!hasOption(completed, "--administrator-email")) {
    completed.push("--administrator-email", await prompt.question("Initial Administrator email: "));
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
