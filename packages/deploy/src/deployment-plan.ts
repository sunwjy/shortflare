import { createHash } from "node:crypto";

import { hashReleaseManifest, type ReleaseManifest } from "./release-manifest.js";

export type FreshAccountState = Readonly<{
  kind: "absent";
  accountId: string;
  workersDevRegistered: boolean;
  collisions: readonly string[];
}>;

export type ExistingInstanceState = Readonly<{
  kind: "present";
  accountId: string;
  databaseId?: string;
  instanceId: string;
  coherentRelease: string;
  coherentWorkerVersions?: Readonly<{ management: string; redirect: string }>;
  domains?: Readonly<{ redirect?: string; management?: string }>;
  schemaVersion: number;
  pendingMigrations: readonly string[];
  analyticsSecret: "present" | "missing";
  initialSetup?: "completed" | "pending" | "required";
  interruptedAttempts?: readonly Readonly<{
    id: string;
    status: "running" | "failed";
    failedStage?: string;
  }>[];
  drift: readonly ObservedDeploymentDrift[];
}>;

export type ObservedDeploymentDrift = Readonly<{
  kind: "shortflare-invariant" | "owner-setting" | "critical" | "foreign";
  field: string;
}>;

export type ObservedDeploymentState = FreshAccountState | ExistingInstanceState;

export type DeploymentRequest = Readonly<{
  redirectDomain: string;
  managementDomain?: string;
  administratorEmail?: string;
}>;

export type DeploymentAction =
  | Readonly<{ kind: "create-d1"; resource: "shortflare" }>
  | Readonly<{ kind: "write-deployment-marker" }>
  | Readonly<{
      kind: "create-queue";
      resource: "shortflare-events" | "shortflare-events-dlq";
      role: "primary" | "dead-letter";
    }>
  | Readonly<{
      kind: "configure-domain";
      worker: "management" | "redirect";
      domain:
        | Readonly<{ kind: "workers-dev" }>
        | Readonly<{ kind: "custom-domain"; hostname: string }>;
    }>
  | Readonly<{ kind: "configure-analytics-secret" }>
  | Readonly<{ kind: "upload-worker"; worker: "management" | "redirect" }>
  | Readonly<{ kind: "activate-worker"; worker: "management" | "redirect" }>
  | Readonly<{ kind: "verify-worker"; worker: "management" | "redirect" }>
  | Readonly<{ kind: "export-d1" }>
  | Readonly<{ kind: "verify-backup" }>
  | Readonly<{ kind: "apply-migrations"; migrations: readonly string[] }>
  | Readonly<{ kind: "record-coherent-release"; release: string }>
  | Readonly<{ kind: "create-setup-handoff"; administratorEmail: string }>
  | Readonly<{
      kind: "recover";
      action: "orphan-resources" | "setup-token" | "analytics-secret" | "worker-rollback";
      target: string;
    }>;

export type DeploymentPlan = Readonly<{
  operation: "install" | "upgrade" | "noop";
  accountId: string;
  sourceRelease: "fresh" | string;
  targetRelease: string;
  targetManifestDigest: string;
  sourceStateDigest: string;
  targetSchemaVersion: number;
  targetArtifactDigests: Readonly<{
    management: string;
    redirect: string;
    migrations: string;
  }>;
  destructive: boolean;
  actions: readonly DeploymentAction[];
  digest: string;
}>;

type UnsignedDeploymentPlan = Omit<DeploymentPlan, "digest">;

export type CreateDeploymentPlanResult =
  | Readonly<{
      ok: true;
      plan: DeploymentPlan;
    }>
  | Readonly<{
      ok: false;
      kind: "resource-collision";
      collisions: readonly string[];
      recovery: "recover-orphan";
    }>
  | Readonly<{
      ok: false;
      kind: "administrator-email-required";
      recovery: "provide-administrator-email";
    }>
  | Readonly<{
      ok: false;
      kind: "management-address-required";
      recovery: "provide-management-domain-or-register-workers-dev";
    }>
  | Readonly<{
      ok: false;
      kind: "analytics-secret-missing";
      recovery: "restore-or-rotate-analytics-secret";
    }>
  | Readonly<{
      ok: false;
      kind: "unsupported-upgrade";
      sourceRelease: string;
      targetRelease: string;
      supportedSources: readonly string[];
    }>
  | Readonly<{
      ok: false;
      kind: "critical-drift";
      fields: readonly string[];
      recovery: "diagnose-and-recover";
    }>;

export function createDeploymentPlan(
  input: Readonly<{
    target: ReleaseManifest;
    observed: ObservedDeploymentState;
    requested: DeploymentRequest;
  }>,
): CreateDeploymentPlanResult {
  const sourceStateDigest = observedStateDigest(input.observed);
  const targetIdentity = {
    targetSchemaVersion: input.target.schema.version,
    targetArtifactDigests: {
      management: input.target.artifacts.management.sha256,
      redirect: input.target.artifacts.redirect.sha256,
      migrations: input.target.artifacts.migrations.sha256,
    },
  };
  const requiresAdministratorEmail =
    input.observed.kind === "absent" ||
    input.observed.coherentRelease === "fresh" ||
    input.observed.initialSetup === "required";
  if (requiresAdministratorEmail && input.requested.administratorEmail === undefined) {
    return {
      ok: false,
      kind: "administrator-email-required",
      recovery: "provide-administrator-email",
    };
  }
  if (input.observed.kind === "present") {
    const changedDomains = [
      ...(input.observed.domains?.redirect === undefined ||
      input.observed.domains.redirect === input.requested.redirectDomain
        ? []
        : ["domain.redirect"]),
      ...(input.requested.managementDomain === undefined ||
      input.observed.domains?.management === undefined ||
      input.observed.domains.management === input.requested.managementDomain
        ? []
        : ["domain.management"]),
    ];
    if (changedDomains.length > 0) {
      return {
        ok: false,
        kind: "critical-drift",
        fields: changedDomains,
        recovery: "diagnose-and-recover",
      };
    }
    const targetsCurrentRelease = input.observed.coherentRelease === input.target.release;
    if (
      input.observed.schemaVersion > input.target.schema.version ||
      (targetsCurrentRelease &&
        input.observed.pendingMigrations.length === 0 &&
        input.observed.schemaVersion !== input.target.schema.version)
    ) {
      return {
        ok: false,
        kind: "critical-drift",
        fields: ["schema.version"],
        recovery: "diagnose-and-recover",
      };
    }
    if (
      !targetsCurrentRelease &&
      !input.target.supportedSources.includes(input.observed.coherentRelease)
    ) {
      return {
        ok: false,
        kind: "unsupported-upgrade",
        sourceRelease: input.observed.coherentRelease,
        targetRelease: input.target.release,
        supportedSources: input.target.supportedSources,
      };
    }

    const criticalDrift = input.observed.drift
      .filter((drift) => drift.kind === "critical")
      .map((drift) => drift.field);
    if (criticalDrift.length > 0) {
      return {
        ok: false,
        kind: "critical-drift",
        fields: criticalDrift,
        recovery: "diagnose-and-recover",
      };
    }

    if (input.observed.coherentRelease === "fresh") {
      return {
        ok: true,
        plan: finalizePlan({
          operation: "install",
          accountId: input.observed.accountId,
          sourceRelease: "fresh",
          targetRelease: input.target.release,
          targetManifestDigest: hashReleaseManifest(input.target),
          sourceStateDigest,
          ...targetIdentity,
          destructive: false,
          actions: installActions(input, false),
        }),
      };
    }

    if (input.observed.analyticsSecret === "missing") {
      return {
        ok: false,
        kind: "analytics-secret-missing",
        recovery: "restore-or-rotate-analytics-secret",
      };
    }

    if (
      targetsCurrentRelease &&
      input.observed.pendingMigrations.length === 0 &&
      input.observed.drift.length === 0 &&
      input.observed.initialSetup === "required"
    ) {
      return {
        ok: true,
        plan: finalizePlan({
          operation: "install",
          accountId: input.observed.accountId,
          sourceRelease: input.observed.coherentRelease,
          targetRelease: input.target.release,
          targetManifestDigest: hashReleaseManifest(input.target),
          sourceStateDigest,
          ...targetIdentity,
          destructive: false,
          actions: [
            {
              kind: "create-setup-handoff",
              administratorEmail: administratorEmail(input.requested),
            },
          ],
        }),
      };
    }

    if (
      targetsCurrentRelease &&
      input.observed.pendingMigrations.length === 0 &&
      input.observed.drift.length === 0
    ) {
      return {
        ok: true,
        plan: finalizePlan({
          operation: "noop",
          accountId: input.observed.accountId,
          sourceRelease: input.observed.coherentRelease,
          targetRelease: input.target.release,
          targetManifestDigest: hashReleaseManifest(input.target),
          sourceStateDigest,
          ...targetIdentity,
          destructive: false,
          actions: [],
        }),
      };
    }

    return {
      ok: true,
      plan: finalizePlan({
        operation: "upgrade",
        accountId: input.observed.accountId,
        sourceRelease: input.observed.coherentRelease,
        targetRelease: input.target.release,
        targetManifestDigest: hashReleaseManifest(input.target),
        sourceStateDigest,
        ...targetIdentity,
        destructive: false,
        actions: [
          ...(input.observed.pendingMigrations.length > 0
            ? ([
                { kind: "export-d1" },
                { kind: "verify-backup" },
                {
                  kind: "apply-migrations",
                  migrations: input.observed.pendingMigrations,
                },
              ] as const)
            : []),
          {
            kind: "create-queue",
            resource: "shortflare-events-dlq",
            role: "dead-letter",
          },
          { kind: "create-queue", resource: "shortflare-events", role: "primary" },
          { kind: "upload-worker", worker: "management" },
          { kind: "upload-worker", worker: "redirect" },
          { kind: "activate-worker", worker: "management" },
          {
            kind: "configure-domain",
            worker: "management",
            domain:
              input.requested.managementDomain === undefined
                ? { kind: "workers-dev" }
                : { kind: "custom-domain", hostname: input.requested.managementDomain },
          },
          { kind: "verify-worker", worker: "management" },
          { kind: "activate-worker", worker: "redirect" },
          {
            kind: "configure-domain",
            worker: "redirect",
            domain: { kind: "custom-domain", hostname: input.requested.redirectDomain },
          },
          { kind: "verify-worker", worker: "redirect" },
          { kind: "record-coherent-release", release: input.target.release },
        ],
      }),
    };
  }

  if (input.observed.collisions.length > 0) {
    return {
      ok: false,
      kind: "resource-collision",
      collisions: input.observed.collisions,
      recovery: "recover-orphan",
    };
  }

  if (!input.observed.workersDevRegistered && input.requested.managementDomain === undefined) {
    return {
      ok: false,
      kind: "management-address-required",
      recovery: "provide-management-domain-or-register-workers-dev",
    };
  }

  return {
    ok: true,
    plan: finalizePlan({
      operation: "install",
      accountId: input.observed.accountId,
      sourceRelease: "fresh",
      targetRelease: input.target.release,
      targetManifestDigest: hashReleaseManifest(input.target),
      sourceStateDigest,
      ...targetIdentity,
      destructive: false,
      actions: installActions(input, true),
    }),
  };
}

export function observedStateDigest(observed: ObservedDeploymentState): string {
  return createHash("sha256").update(JSON.stringify(observed)).digest("hex");
}

function installActions(
  input: Readonly<{
    target: ReleaseManifest;
    observed: ObservedDeploymentState;
    requested: DeploymentRequest;
  }>,
  includeFoundation: boolean,
): readonly DeploymentAction[] {
  return [
    ...(includeFoundation
      ? ([
          { kind: "create-d1", resource: "shortflare" },
          { kind: "write-deployment-marker" },
          { kind: "apply-migrations", migrations: input.target.schema.migrations },
        ] as const)
      : input.observed.kind === "present" && input.observed.pendingMigrations.length > 0
        ? ([{ kind: "apply-migrations", migrations: input.observed.pendingMigrations }] as const)
        : []),
    {
      kind: "create-queue",
      resource: "shortflare-events-dlq",
      role: "dead-letter",
    },
    {
      kind: "create-queue",
      resource: "shortflare-events",
      role: "primary",
    },
    { kind: "upload-worker", worker: "management" },
    // A staged Redirect version creates the Worker before Wrangler can attach its first secret.
    { kind: "upload-worker", worker: "redirect" },
    { kind: "configure-analytics-secret" },
    { kind: "upload-worker", worker: "redirect" },
    { kind: "activate-worker", worker: "management" },
    {
      kind: "configure-domain",
      worker: "management",
      domain:
        input.requested.managementDomain === undefined
          ? { kind: "workers-dev" }
          : { kind: "custom-domain", hostname: input.requested.managementDomain },
    },
    { kind: "verify-worker", worker: "management" },
    { kind: "activate-worker", worker: "redirect" },
    {
      kind: "configure-domain",
      worker: "redirect",
      domain: { kind: "custom-domain", hostname: input.requested.redirectDomain },
    },
    { kind: "verify-worker", worker: "redirect" },
    { kind: "record-coherent-release", release: input.target.release },
    {
      kind: "create-setup-handoff",
      administratorEmail: administratorEmail(input.requested),
    },
  ];
}

function finalizePlan(plan: UnsignedDeploymentPlan): DeploymentPlan {
  // Approval covers the exact ordered actions while secret material remains outside the plan.
  const digest = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  return { ...plan, digest };
}

function administratorEmail(request: DeploymentRequest): string {
  if (request.administratorEmail === undefined) {
    throw new Error("Administrator email precondition was not enforced");
  }
  return request.administratorEmail;
}
