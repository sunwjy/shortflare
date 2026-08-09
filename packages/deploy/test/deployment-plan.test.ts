import { describe, expect, it } from "vitest";

import { createDeploymentPlan, parseReleaseManifest } from "../src/index";

describe("Deployment Reconciliation plan", () => {
  it("orders a fresh installation without exposing the setup secret", () => {
    const parsed = parseReleaseManifest(releaseManifest());
    if (!parsed.ok) {
      throw new Error("test manifest must be valid");
    }

    const result = createDeploymentPlan({
      target: parsed.value,
      observed: {
        kind: "absent",
        accountId: "account-1",
        workersDevRegistered: true,
        collisions: [],
      },
      requested: {
        redirectDomain: "go.example.com",
        administratorEmail: "owner@example.com",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        operation: "install",
        accountId: "account-1",
        sourceRelease: "fresh",
        targetRelease: "1.0.0",
        destructive: false,
        actions: [
          { kind: "create-d1", resource: "shortflare" },
          { kind: "write-deployment-marker" },
          { kind: "create-queue", resource: "shortflare-events-dlq", role: "dead-letter" },
          { kind: "create-queue", resource: "shortflare-events", role: "primary" },
          { kind: "configure-analytics-secret" },
          { kind: "upload-worker", worker: "management" },
          { kind: "activate-worker", worker: "management" },
          { kind: "verify-worker", worker: "management" },
          { kind: "upload-worker", worker: "redirect" },
          { kind: "activate-worker", worker: "redirect" },
          { kind: "verify-worker", worker: "redirect" },
          { kind: "record-coherent-release", release: "1.0.0" },
          { kind: "create-setup-handoff", administratorEmail: "owner@example.com" },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("setupToken");
  });

  it("stops before adopting a same-named unmarked resource", () => {
    const parsed = parseReleaseManifest(releaseManifest());
    if (!parsed.ok) {
      throw new Error("test manifest must be valid");
    }

    const result = createDeploymentPlan({
      target: parsed.value,
      observed: {
        kind: "absent",
        accountId: "account-1",
        workersDevRegistered: true,
        collisions: ["d1:shortflare"],
      },
      requested: {
        redirectDomain: "go.example.com",
        administratorEmail: "owner@example.com",
      },
    });

    expect(result).toEqual({
      ok: false,
      kind: "resource-collision",
      collisions: ["d1:shortflare"],
      recovery: "recover-orphan",
    });
  });

  it("requires a Management Domain when workers.dev is unavailable", () => {
    const parsed = parseReleaseManifest(releaseManifest());
    if (!parsed.ok) {
      throw new Error("test manifest must be valid");
    }

    const result = createDeploymentPlan({
      target: parsed.value,
      observed: {
        kind: "absent",
        accountId: "account-1",
        workersDevRegistered: false,
        collisions: [],
      },
      requested: {
        redirectDomain: "go.example.com",
        administratorEmail: "owner@example.com",
      },
    });

    expect(result).toEqual({
      ok: false,
      kind: "management-address-required",
      recovery: "provide-management-domain-or-register-workers-dev",
    });
  });

  it("backs up and migrates before activating an ordered upgrade", () => {
    const parsed = parseReleaseManifest(releaseManifest());
    if (!parsed.ok) {
      throw new Error("test manifest must be valid");
    }

    const result = createDeploymentPlan({
      target: parsed.value,
      observed: {
        kind: "present",
        accountId: "account-1",
        instanceId: "instance-1",
        coherentRelease: "0.9.0",
        schemaVersion: 4,
        pendingMigrations: ["0005_deployment_control.sql"],
        analyticsSecret: "present",
        drift: [],
      },
      requested: {
        redirectDomain: "go.example.com",
        administratorEmail: "owner@example.com",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        operation: "upgrade",
        sourceRelease: "0.9.0",
        targetRelease: "1.0.0",
        actions: [
          { kind: "export-d1" },
          { kind: "verify-backup" },
          { kind: "apply-migrations", migrations: ["0005_deployment_control.sql"] },
          { kind: "upload-worker", worker: "management" },
          { kind: "activate-worker", worker: "management" },
          { kind: "verify-worker", worker: "management" },
          { kind: "upload-worker", worker: "redirect" },
          { kind: "activate-worker", worker: "redirect" },
          { kind: "verify-worker", worker: "redirect" },
          { kind: "record-coherent-release", release: "1.0.0" },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("create-setup-handoff");
  });

  it("stops an existing Instance when its analytics secret is missing", () => {
    const parsed = parseReleaseManifest(releaseManifest());
    if (!parsed.ok) {
      throw new Error("test manifest must be valid");
    }

    const result = createDeploymentPlan({
      target: parsed.value,
      observed: {
        kind: "present",
        accountId: "account-1",
        instanceId: "instance-1",
        coherentRelease: "0.9.0",
        schemaVersion: 4,
        pendingMigrations: ["0005_deployment_control.sql"],
        analyticsSecret: "missing",
        drift: [],
      },
      requested: {
        redirectDomain: "go.example.com",
        administratorEmail: "owner@example.com",
      },
    });

    expect(result).toEqual({
      ok: false,
      kind: "analytics-secret-missing",
      recovery: "restore-or-rotate-analytics-secret",
    });
  });

  it("rejects an undeclared source release before backup or mutation", () => {
    const parsed = parseReleaseManifest(releaseManifest());
    if (!parsed.ok) {
      throw new Error("test manifest must be valid");
    }

    const result = createDeploymentPlan({
      target: parsed.value,
      observed: {
        kind: "present",
        accountId: "account-1",
        instanceId: "instance-1",
        coherentRelease: "0.8.0",
        schemaVersion: 3,
        pendingMigrations: ["0004_previous.sql", "0005_deployment_control.sql"],
        analyticsSecret: "present",
        drift: [],
      },
      requested: {
        redirectDomain: "go.example.com",
        administratorEmail: "owner@example.com",
      },
    });

    expect(result).toEqual({
      ok: false,
      kind: "unsupported-upgrade",
      sourceRelease: "0.8.0",
      targetRelease: "1.0.0",
      supportedSources: ["fresh", "0.9.0"],
    });
  });

  it("leaves critical Deployment Drift for explicit recovery", () => {
    const parsed = parseReleaseManifest(releaseManifest());
    if (!parsed.ok) {
      throw new Error("test manifest must be valid");
    }

    const result = createDeploymentPlan({
      target: parsed.value,
      observed: {
        kind: "present",
        accountId: "account-1",
        instanceId: "instance-1",
        coherentRelease: "0.9.0",
        schemaVersion: 4,
        pendingMigrations: ["0005_deployment_control.sql"],
        analyticsSecret: "present",
        drift: [{ kind: "critical", field: "management.artifactSha256" }],
      },
      requested: {
        redirectDomain: "go.example.com",
        administratorEmail: "owner@example.com",
      },
    });

    expect(result).toEqual({
      ok: false,
      kind: "critical-drift",
      fields: ["management.artifactSha256"],
      recovery: "diagnose-and-recover",
    });
  });

  it("returns a no-op plan for an already coherent target release", () => {
    const parsed = parseReleaseManifest(releaseManifest());
    if (!parsed.ok) {
      throw new Error("test manifest must be valid");
    }

    const result = createDeploymentPlan({
      target: parsed.value,
      observed: {
        kind: "present",
        accountId: "account-1",
        instanceId: "instance-1",
        coherentRelease: "1.0.0",
        schemaVersion: 5,
        pendingMigrations: [],
        analyticsSecret: "present",
        drift: [],
      },
      requested: {
        redirectDomain: "go.example.com",
        administratorEmail: "owner@example.com",
      },
    });

    expect(result).toEqual({
      ok: true,
      plan: {
        operation: "noop",
        accountId: "account-1",
        sourceRelease: "1.0.0",
        targetRelease: "1.0.0",
        destructive: false,
        actions: [],
      },
    });
  });
});

function releaseManifest() {
  return {
    formatVersion: 1,
    release: "1.0.0",
    schema: {
      version: 5,
      journalSha256: "1".repeat(64),
    },
    supportedSources: ["fresh", "0.9.0"],
    rollbackSafeFrom: ["0.9.0"],
    artifacts: {
      management: {
        path: "artifacts/management/index.js",
        sha256: "2".repeat(64),
      },
      redirect: {
        path: "artifacts/redirect/index.js",
        sha256: "3".repeat(64),
      },
      migrations: {
        path: "artifacts/migrations",
        sha256: "4".repeat(64),
      },
    },
  } as const;
}
