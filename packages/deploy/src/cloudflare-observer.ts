import { z } from "zod";

import type { CloudflareApi, CloudflareApiFailure, CloudflareQueue } from "./cloudflare-api.js";
import type { ObservedDeploymentDrift, ObservedDeploymentState } from "./deployment-plan.js";

const markerSchema = z.looseObject({ instanceId: z.string().min(1) });
const coherentSchema = z.looseObject({
  release: z.string().min(1),
  schemaVersion: z.number().int().nonnegative(),
});
const migrationSchema = z.looseObject({ name: z.string().min(1) });
const setupStateSchema = z.looseObject({
  setupCompletedAt: z.number().nullable(),
  activeAdministrators: z.number().int().nonnegative(),
  validSetup: z.number().int().min(0).max(1),
});
const attemptSchema = z.looseObject({
  id: z.string().min(1),
  status: z.enum(["running", "failed"]),
  failedStage: z.string().nullable(),
});

export async function observeCloudflareDeployment(
  input: Readonly<{
    api: CloudflareApi;
    accountId: string;
    targetMigrations: readonly string[];
  }>,
): Promise<ObservedDeploymentState> {
  const [databases, subdomain, queues] = await Promise.all([
    input.api.listD1Databases(input.accountId, "shortflare"),
    input.api.getWorkersSubdomain(input.accountId),
    input.api.listQueues(input.accountId),
  ]);
  if (!databases.ok) throw new CloudflareObservationError(databases);
  if (!subdomain.ok) throw new CloudflareObservationError(subdomain);
  if (!queues.ok) throw new CloudflareObservationError(queues);

  const exactDatabases = databases.databases.filter((database) => database.name === "shortflare");
  if (exactDatabases.length === 0) {
    const collisions = queues.queues
      .filter(
        (queue) => queue.name === "shortflare-events" || queue.name === "shortflare-events-dlq",
      )
      .map((queue) => `queue:${queue.name}`);
    return {
      kind: "absent",
      accountId: input.accountId,
      workersDevRegistered: subdomain.registered,
      collisions,
    };
  }
  if (exactDatabases.length !== 1) {
    return {
      kind: "absent",
      accountId: input.accountId,
      workersDevRegistered: subdomain.registered,
      collisions: ["d1:shortflare"],
    };
  }

  const database = exactDatabases[0];
  if (database === undefined) throw new Error("D1 discovery invariant failed");
  const markerRows = await query(
    input.api,
    input.accountId,
    database.id,
    `SELECT instance_id AS instanceId FROM deployment_marker WHERE singleton_key = 1`,
  ).catch((error: unknown) => {
    if (error instanceof CloudflareObservationError && error.failure.status === 400) return [];
    throw error;
  });
  const marker = markerSchema.safeParse(markerRows[0]);
  if (!marker.success) {
    return {
      kind: "absent",
      accountId: input.accountId,
      workersDevRegistered: subdomain.registered,
      collisions: ["d1:shortflare"],
    };
  }

  const [coherentRows, migrationRows, setupRows, attemptRows, secrets] = await Promise.all([
    query(
      input.api,
      input.accountId,
      database.id,
      `SELECT release, schema_version AS schemaVersion
       FROM coherent_release WHERE singleton_key = 1`,
    ),
    query(input.api, input.accountId, database.id, `SELECT name FROM d1_migrations ORDER BY id`),
    query(
      input.api,
      input.accountId,
      database.id,
      `SELECT i.setup_completed_at AS setupCompletedAt,
              COUNT(u.id) AS activeAdministrators,
              EXISTS(SELECT 1 FROM initial_setup s WHERE s.singleton_key = 1
                     AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000) AS validSetup
       FROM instances i
       LEFT JOIN users u ON u.state = 'active' AND u.role = 'administrator'
       WHERE i.singleton_key = 1
       GROUP BY i.singleton_key, i.setup_completed_at`,
    ),
    query(
      input.api,
      input.accountId,
      database.id,
      `SELECT id, status, failed_stage AS failedStage
       FROM deployment_attempts WHERE status IN ('running', 'failed')
       ORDER BY updated_at DESC`,
    ),
    input.api.listWorkerSecretNames(input.accountId, "shortflare-redirect"),
  ]);
  if (!secrets.ok) throw new CloudflareObservationError(secrets);
  const coherent = coherentSchema.safeParse(coherentRows[0]);
  const setupState = setupStateSchema.safeParse(setupRows[0]);
  const appliedMigrations = new Set(
    migrationRows.flatMap((row) => {
      const parsed = migrationSchema.safeParse(row);
      return parsed.success ? [parsed.data.name] : [];
    }),
  );
  const drift = queueDrift(queues.queues);
  const interruptedAttempts = attemptRows.flatMap((row) => {
    const parsed = attemptSchema.safeParse(row);
    if (!parsed.success) return [];
    return [
      {
        id: parsed.data.id,
        status: parsed.data.status,
        ...(parsed.data.failedStage === null ? {} : { failedStage: parsed.data.failedStage }),
      },
    ];
  });
  return {
    kind: "present",
    accountId: input.accountId,
    databaseId: database.id,
    instanceId: marker.data.instanceId,
    coherentRelease: coherent.success ? coherent.data.release : "fresh",
    schemaVersion: coherent.success ? coherent.data.schemaVersion : 0,
    pendingMigrations: input.targetMigrations.filter((name) => !appliedMigrations.has(name)),
    analyticsSecret: secrets.names.includes("ANALYTICS_HMAC_KEY") ? "present" : "missing",
    initialSetup:
      setupState.success &&
      (setupState.data.setupCompletedAt !== null || setupState.data.activeAdministrators > 0)
        ? "completed"
        : setupState.success && setupState.data.validSetup === 1
          ? "pending"
          : "required",
    interruptedAttempts,
    drift,
  };
}

async function query(
  api: CloudflareApi,
  accountId: string,
  databaseId: string,
  sql: string,
): Promise<readonly unknown[]> {
  const result = await api.queryD1(accountId, databaseId, sql);
  if (!result.ok) throw new CloudflareObservationError(result);
  return result.rows;
}

function queueDrift(queues: readonly CloudflareQueue[]): readonly ObservedDeploymentDrift[] {
  const expected = ["shortflare-events", "shortflare-events-dlq"] as const;
  return expected.flatMap((name) => {
    const queue = queues.find((candidate) => candidate.name === name);
    if (queue === undefined) return [{ kind: "shortflare-invariant", field: `queue.${name}` }];
    return queue.settings.messageRetentionPeriod === 86_400
      ? []
      : [{ kind: "shortflare-invariant", field: `queue.${name}.retention` }];
  });
}

export class CloudflareObservationError extends Error {
  public constructor(public readonly failure: CloudflareApiFailure) {
    super(`Cloudflare observation failed with ${failure.kind}`);
    this.name = "CloudflareObservationError";
  }
}
