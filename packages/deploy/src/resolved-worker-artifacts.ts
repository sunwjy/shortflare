import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const d1BindingSchema = z.looseObject({
  binding: z.string(),
  database_name: z.string(),
  database_id: z.string(),
  migrations_dir: z.string().optional(),
});
const workerConfigSchema = z.looseObject({
  name: z.string(),
  main: z.string(),
  account_id: z.string().optional(),
  d1_databases: z.array(d1BindingSchema),
});
const managementConfigSchema = workerConfigSchema.extend({
  vars: z.record(z.string(), z.unknown()),
  ratelimits: z.array(z.looseObject({ name: z.string(), namespace_id: z.string() })),
});
const redirectConfigSchema = workerConfigSchema.extend({
  queues: z.looseObject({
    producers: z.array(z.looseObject({ binding: z.string(), queue: z.string() })),
  }),
});

export async function prepareWorkerArtifacts(
  input: Readonly<{
    releaseRoot: string;
    temporaryRoot: string;
    accountId: string;
    databaseId: string;
    redirectDomain: string;
    rateLimitNamespaceBase: number;
  }>,
): Promise<Readonly<{ managementConfig: string; redirectConfig: string }>> {
  if (!Number.isSafeInteger(input.rateLimitNamespaceBase) || input.rateLimitNamespaceBase <= 0) {
    throw new Error("Rate limit namespace base must be a positive safe integer");
  }
  await cp(input.releaseRoot, input.temporaryRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const managementConfig = path.join(
    input.temporaryRoot,
    "artifacts",
    "management",
    "shortflare_management",
    "wrangler.json",
  );
  const redirectConfig = path.join(
    input.temporaryRoot,
    "artifacts",
    "redirect",
    "shortflare_redirect",
    "wrangler.json",
  );
  const management = managementConfigSchema.parse(
    JSON.parse(await readFile(managementConfig, "utf8")),
  );
  const redirect = redirectConfigSchema.parse(JSON.parse(await readFile(redirectConfig, "utf8")));

  management.account_id = input.accountId;
  redirect.account_id = input.accountId;
  management.vars.REDIRECT_DOMAIN = input.redirectDomain;
  management.d1_databases = management.d1_databases.map((binding) => ({
    ...binding,
    database_id: input.databaseId,
    migrations_dir: "../../../migrations",
  }));
  management.ratelimits = management.ratelimits.map((binding, index) => ({
    ...binding,
    namespace_id: String(input.rateLimitNamespaceBase + index),
  }));
  redirect.d1_databases = redirect.d1_databases.map((binding) => ({
    ...binding,
    database_id: input.databaseId,
    migrations_dir: "../../../migrations",
  }));
  redirect.queues.producers = redirect.queues.producers.map((producer) => ({
    ...producer,
    queue: "shortflare-events",
  }));

  await Promise.all([
    writeFile(managementConfig, `${JSON.stringify(management)}\n`),
    writeFile(redirectConfig, `${JSON.stringify(redirect)}\n`),
  ]);
  return { managementConfig, redirectConfig };
}
