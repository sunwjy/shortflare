import { z } from "zod";

import type {
  CloudflareApi,
  CloudflareApiFailure,
  CloudflareQueue,
  WorkerBinding,
  WorkerDomain,
} from "./cloudflare-api.js";
import type { ObservedDeploymentDrift, ObservedDeploymentState } from "./deployment-plan.js";

const markerSchema = z.looseObject({ instanceId: z.string().min(1) });
const coherentSchema = z.looseObject({
  release: z.string().min(1),
  schemaVersion: z.number().int().nonnegative(),
  managementWorkerVersion: z.string().min(1),
  redirectWorkerVersion: z.string().min(1),
  managementArtifactSha256: z.string().length(64).optional(),
  redirectArtifactSha256: z.string().length(64).optional(),
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
    redirectDomain?: string;
    managementDomain?: string;
    targetRelease?: string;
    managementArtifactSha256?: string;
    redirectArtifactSha256?: string;
  }>,
): Promise<ObservedDeploymentState> {
  const [databases, subdomain, queues, scripts, domains] = await Promise.all([
    input.api.listD1Databases(input.accountId, "shortflare"),
    input.api.getWorkersSubdomain(input.accountId),
    input.api.listQueues(input.accountId),
    input.api.listWorkerScripts(input.accountId),
    input.api.listWorkerDomains(input.accountId),
  ]);
  if (!databases.ok) throw new CloudflareObservationError(databases);
  if (!subdomain.ok) throw new CloudflareObservationError(subdomain);
  if (!queues.ok) throw new CloudflareObservationError(queues);
  if (!scripts.ok) throw new CloudflareObservationError(scripts);
  if (!domains.ok) throw new CloudflareObservationError(domains);

  const exactDatabases = databases.databases.filter((database) => database.name === "shortflare");
  if (exactDatabases.length === 0) {
    const collisions = queues.queues
      .filter(
        (queue) => queue.name === "shortflare-events" || queue.name === "shortflare-events-dlq",
      )
      .map((queue) => `queue:${queue.name}`);
    const consumerCollisions = queues.queues.flatMap((queue) =>
      queue.consumers.map((consumer) => `consumer:${queue.name}:${consumer.id}`),
    );
    const workerCollisions = scripts.scripts
      .filter(
        (script) =>
          script.name === "shortflare-management" || script.name === "shortflare-redirect",
      )
      .map((script) => `worker:${script.name}`);
    const domainCollisions = domains.domains
      .filter(
        (domain) =>
          domain.hostname === input.redirectDomain || domain.hostname === input.managementDomain,
      )
      .map((domain) => `domain:${domain.hostname}`);
    return {
      kind: "absent",
      accountId: input.accountId,
      workersDevRegistered: subdomain.registered,
      collisions: [...consumerCollisions, ...collisions, ...workerCollisions, ...domainCollisions],
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

  const [
    coherentRows,
    identityRows,
    migrationRows,
    setupRows,
    attemptRows,
    secrets,
    managementBindings,
    redirectBindings,
    managementVersions,
    redirectVersions,
  ] = await Promise.all([
    queryMissingTableAsEmpty(
      input.api,
      input.accountId,
      database.id,
      `SELECT release, schema_version AS schemaVersion,
              management_worker_version AS managementWorkerVersion,
              redirect_worker_version AS redirectWorkerVersion
       FROM coherent_release WHERE singleton_key = 1`,
    ),
    queryMissingTableAsEmpty(
      input.api,
      input.accountId,
      database.id,
      `SELECT management_artifact_sha256 AS managementArtifactSha256,
              redirect_artifact_sha256 AS redirectArtifactSha256
       FROM coherent_release WHERE singleton_key = 1`,
    ),
    queryMissingTableAsEmpty(
      input.api,
      input.accountId,
      database.id,
      `SELECT name FROM d1_migrations ORDER BY id`,
    ),
    queryMissingTableAsEmpty(
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
    queryMissingTableAsEmpty(
      input.api,
      input.accountId,
      database.id,
      `SELECT id, status, failed_stage AS failedStage
       FROM deployment_attempts WHERE status IN ('running', 'failed')
       ORDER BY updated_at DESC`,
    ),
    input.api.listWorkerSecretNames(input.accountId, "shortflare-redirect"),
    input.api.listWorkerBindings(input.accountId, "shortflare-management"),
    input.api.listWorkerBindings(input.accountId, "shortflare-redirect"),
    input.api.listActiveWorkerVersions(input.accountId, "shortflare-management"),
    input.api.listActiveWorkerVersions(input.accountId, "shortflare-redirect"),
  ]);
  if (!secrets.ok) throw new CloudflareObservationError(secrets);
  if (!managementBindings.ok) throw new CloudflareObservationError(managementBindings);
  if (!redirectBindings.ok) throw new CloudflareObservationError(redirectBindings);
  if (!managementVersions.ok) throw new CloudflareObservationError(managementVersions);
  if (!redirectVersions.ok) throw new CloudflareObservationError(redirectVersions);
  const coherent = coherentSchema.safeParse(
    typeof coherentRows[0] === "object" && coherentRows[0] !== null
      ? { ...coherentRows[0], ...objectRecord(identityRows[0]) }
      : coherentRows[0],
  );
  const setupState = setupStateSchema.safeParse(setupRows[0]);
  const appliedMigrations = new Set(
    migrationRows.flatMap((row) => {
      const parsed = migrationSchema.safeParse(row);
      return parsed.success ? [parsed.data.name] : [];
    }),
  );
  const drift = [
    ...queueDrift(queues.queues),
    ...workerDrift(scripts.scripts.map((script) => script.name)),
    ...workerBindingDrift(database.id, managementBindings.bindings, redirectBindings.bindings),
    ...activeVersionDrift(
      coherent.success ? coherent.data : undefined,
      managementVersions.versionIds,
      redirectVersions.versionIds,
    ),
    ...domainDrift(input, domains.domains),
    ...releaseIdentityDrift(input, coherent.success ? coherent.data : undefined),
  ];
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

function releaseIdentityDrift(
  input: Readonly<{
    targetRelease?: string;
    managementArtifactSha256?: string;
    redirectArtifactSha256?: string;
  }>,
  coherent: z.infer<typeof coherentSchema> | undefined,
): readonly ObservedDeploymentDrift[] {
  if (coherent === undefined || coherent.release !== input.targetRelease) return [];
  return [
    ...(input.managementArtifactSha256 === undefined ||
    coherent.managementArtifactSha256 === input.managementArtifactSha256
      ? []
      : [{ kind: "critical" as const, field: "management.artifactSha256" }]),
    ...(input.redirectArtifactSha256 === undefined ||
    coherent.redirectArtifactSha256 === input.redirectArtifactSha256
      ? []
      : [{ kind: "critical" as const, field: "redirect.artifactSha256" }]),
  ];
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  return parsed.success ? parsed.data : {};
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

async function queryMissingTableAsEmpty(
  api: CloudflareApi,
  accountId: string,
  databaseId: string,
  sql: string,
): Promise<readonly unknown[]> {
  try {
    return await query(api, accountId, databaseId, sql);
  } catch (error: unknown) {
    if (error instanceof CloudflareObservationError && error.failure.status === 400) return [];
    throw error;
  }
}

function queueDrift(queues: readonly CloudflareQueue[]): readonly ObservedDeploymentDrift[] {
  const expected = ["shortflare-events", "shortflare-events-dlq"] as const;
  return expected.flatMap((name) => {
    const queue = queues.find((candidate) => candidate.name === name);
    if (queue === undefined) return [{ kind: "shortflare-invariant", field: `queue.${name}` }];
    const retention =
      queue.settings.messageRetentionPeriod === 86_400
        ? []
        : [{ kind: "shortflare-invariant" as const, field: `queue.${name}.retention` }];
    if (name === "shortflare-events-dlq") return retention;
    const producer = queue.producers.some(
      (candidate) => candidate.type === "worker" && candidate.script === "shortflare-redirect",
    );
    const consumer = queue.consumers.some(
      (candidate) =>
        candidate.type === "worker" &&
        candidate.scriptName === "shortflare-management" &&
        candidate.deadLetterQueue === "shortflare-events-dlq" &&
        candidate.maxRetries === 3,
    );
    return [
      ...retention,
      ...(producer
        ? []
        : [{ kind: "shortflare-invariant" as const, field: "queue.primary.producer" }]),
      ...(consumer
        ? []
        : [{ kind: "shortflare-invariant" as const, field: "queue.primary.consumer" }]),
    ];
  });
}

function workerBindingDrift(
  databaseId: string,
  management: readonly WorkerBinding[],
  redirect: readonly WorkerBinding[],
): readonly ObservedDeploymentDrift[] {
  const hasD1 = (bindings: readonly WorkerBinding[]) =>
    bindings.some(
      (binding) =>
        binding.type === "d1" && binding.name === "DB" && binding.databaseId === databaseId,
    );
  const hasQueue = redirect.some(
    (binding) =>
      binding.type === "queue" &&
      binding.name === "ANALYTICS_QUEUE" &&
      binding.queueName === "shortflare-events",
  );
  return [
    ...(hasD1(management)
      ? []
      : [{ kind: "shortflare-invariant" as const, field: "worker.management.DB" }]),
    ...(hasD1(redirect)
      ? []
      : [{ kind: "shortflare-invariant" as const, field: "worker.redirect.DB" }]),
    ...(hasQueue
      ? []
      : [{ kind: "shortflare-invariant" as const, field: "worker.redirect.ANALYTICS_QUEUE" }]),
  ];
}

function activeVersionDrift(
  coherent: z.infer<typeof coherentSchema> | undefined,
  managementVersionIds: readonly string[],
  redirectVersionIds: readonly string[],
): readonly ObservedDeploymentDrift[] {
  if (coherent === undefined) return [];
  return [
    ...(managementVersionIds.includes(coherent.managementWorkerVersion)
      ? []
      : [{ kind: "critical" as const, field: "worker.management.activeVersion" }]),
    ...(redirectVersionIds.includes(coherent.redirectWorkerVersion)
      ? []
      : [{ kind: "critical" as const, field: "worker.redirect.activeVersion" }]),
  ];
}

function workerDrift(names: readonly string[]): readonly ObservedDeploymentDrift[] {
  return ["shortflare-management", "shortflare-redirect"].flatMap((name) =>
    names.includes(name) ? [] : [{ kind: "shortflare-invariant", field: `worker.${name}` }],
  );
}

function domainDrift(
  input: Readonly<{ redirectDomain?: string; managementDomain?: string }>,
  domains: readonly WorkerDomain[],
): readonly ObservedDeploymentDrift[] {
  const expected = [
    ...(input.redirectDomain === undefined
      ? []
      : [{ hostname: input.redirectDomain, worker: "shortflare-redirect" }]),
    ...(input.managementDomain === undefined
      ? []
      : [{ hostname: input.managementDomain, worker: "shortflare-management" }]),
  ];
  return expected.flatMap(({ hostname, worker }): readonly ObservedDeploymentDrift[] => {
    const domain = domains.find((candidate) => candidate.hostname === hostname);
    if (domain === undefined)
      return [{ kind: "shortflare-invariant", field: `domain.${hostname}` }];
    return domain.worker === worker ? [] : [{ kind: "foreign", field: `domain.${hostname}` }];
  });
}

export class CloudflareObservationError extends Error {
  public constructor(public readonly failure: CloudflareApiFailure) {
    super(`Cloudflare observation failed with ${failure.kind}`);
    this.name = "CloudflareObservationError";
  }
}
