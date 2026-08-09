import type { ReleaseManifest } from "./release-manifest";

export type FreshAccountState = Readonly<{
  kind: "absent";
  accountId: string;
  workersDevRegistered: boolean;
  collisions: readonly string[];
}>;

export type ExistingInstanceState = Readonly<{
  kind: "present";
  accountId: string;
  instanceId: string;
  coherentRelease: string;
  schemaVersion: number;
  pendingMigrations: readonly string[];
  analyticsSecret: "present" | "missing";
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
  administratorEmail: string;
}>;

export type DeploymentAction =
  | Readonly<{ kind: "create-d1"; resource: "shortflare" }>
  | Readonly<{ kind: "write-deployment-marker" }>
  | Readonly<{
      kind: "create-queue";
      resource: "shortflare-events" | "shortflare-events-dlq";
      role: "primary" | "dead-letter";
    }>
  | Readonly<{ kind: "configure-analytics-secret" }>
  | Readonly<{ kind: "upload-worker"; worker: "management" | "redirect" }>
  | Readonly<{ kind: "activate-worker"; worker: "management" | "redirect" }>
  | Readonly<{ kind: "verify-worker"; worker: "management" | "redirect" }>
  | Readonly<{ kind: "export-d1" }>
  | Readonly<{ kind: "verify-backup" }>
  | Readonly<{ kind: "apply-migrations"; migrations: readonly string[] }>
  | Readonly<{ kind: "record-coherent-release"; release: string }>
  | Readonly<{ kind: "create-setup-handoff"; administratorEmail: string }>;

export type DeploymentPlan = Readonly<{
  operation: "install" | "upgrade" | "noop";
  accountId: string;
  sourceRelease: "fresh" | string;
  targetRelease: string;
  destructive: boolean;
  actions: readonly DeploymentAction[];
}>;

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
  if (input.observed.kind === "present") {
    const targetsCurrentRelease = input.observed.coherentRelease === input.target.release;
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
      input.observed.drift.length === 0
    ) {
      return {
        ok: true,
        plan: {
          operation: "noop",
          accountId: input.observed.accountId,
          sourceRelease: input.observed.coherentRelease,
          targetRelease: input.target.release,
          destructive: false,
          actions: [],
        },
      };
    }

    return {
      ok: true,
      plan: {
        operation: "upgrade",
        accountId: input.observed.accountId,
        sourceRelease: input.observed.coherentRelease,
        targetRelease: input.target.release,
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
          { kind: "upload-worker", worker: "management" },
          { kind: "activate-worker", worker: "management" },
          { kind: "verify-worker", worker: "management" },
          { kind: "upload-worker", worker: "redirect" },
          { kind: "activate-worker", worker: "redirect" },
          { kind: "verify-worker", worker: "redirect" },
          { kind: "record-coherent-release", release: input.target.release },
        ],
      },
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
    plan: {
      operation: "install",
      accountId: input.observed.accountId,
      sourceRelease: "fresh",
      targetRelease: input.target.release,
      destructive: false,
      actions: [
        { kind: "create-d1", resource: "shortflare" },
        { kind: "write-deployment-marker" },
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
        { kind: "configure-analytics-secret" },
        { kind: "upload-worker", worker: "management" },
        { kind: "activate-worker", worker: "management" },
        { kind: "verify-worker", worker: "management" },
        { kind: "upload-worker", worker: "redirect" },
        { kind: "activate-worker", worker: "redirect" },
        { kind: "verify-worker", worker: "redirect" },
        { kind: "record-coherent-release", release: input.target.release },
        {
          kind: "create-setup-handoff",
          administratorEmail: input.requested.administratorEmail,
        },
      ],
    },
  };
}
