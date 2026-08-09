import { describe, expect, it } from "vitest";

import { createDeploymentApplication } from "../src/deployment-application";
import type { DeploymentActionExecutor, DeploymentAttemptJournal } from "../src/deployment-runner";

describe("Deployment application", () => {
  it("bootstraps fresh D1 before starting the durable resumable attempt", async () => {
    const applied: string[] = [];
    const completed: number[] = [];
    let journalDatabaseId: string | undefined;
    const executor: DeploymentActionExecutor & { getDatabaseId(): string | undefined } = {
      getDatabaseId: () => "database-1",
      revalidate: async () => ({ ok: true }),
      apply: async (action) => {
        applied.push(action.kind);
        return { ok: true };
      },
    };
    const journal: DeploymentAttemptJournal = {
      begin: async () => ({ attemptId: "attempt-1", completedActionIndexes: [], fencingToken: 1 }),
      revalidateAndRenewLease: async () => ({ ok: true }),
      recordActionCompleted: async (_attempt, index) => {
        completed.push(index);
      },
      complete: async () => undefined,
      fail: async () => undefined,
    };
    const application = createDeploymentApplication({
      manifest: releaseManifest(),
      observe: async () => ({
        kind: "absent",
        accountId: "account-1",
        workersDevRegistered: true,
        collisions: [],
      }),
      createExecutor: () => executor,
      createJournal: (databaseId) => {
        journalDatabaseId = databaseId;
        return journal;
      },
      writeConfig: async () => undefined,
    });

    const result = await application.deploy({
      kind: "deploy",
      mode: "json",
      approval: { kind: "non-destructive" },
      dryRun: false,
      setupTokenFromStdin: true,
      accountId: "account-1",
      redirectDomain: "go.example.com",
      administratorEmail: "owner@example.com",
    });

    expect(result.ok).toBe(true);
    expect(journalDatabaseId).toBe("database-1");
    expect(applied.slice(0, 3)).toEqual([
      "create-d1",
      "write-deployment-marker",
      "apply-migrations",
    ]);
    expect(applied.filter((stage) => stage === "create-d1")).toHaveLength(1);
    expect(completed[0]).toBe(2);
  });

  it("returns the exact dry-run plan without creating mutation adapters", async () => {
    const application = createDeploymentApplication({
      manifest: releaseManifest(),
      observe: async () => ({
        kind: "absent",
        accountId: "account-1",
        workersDevRegistered: true,
        collisions: [],
      }),
      createExecutor: () => {
        throw new Error("must not create executor");
      },
      createJournal: () => {
        throw new Error("must not create journal");
      },
      writeConfig: async () => undefined,
    });
    const result = await application.deploy({
      kind: "deploy",
      mode: "json",
      approval: { kind: "none" },
      dryRun: true,
      setupTokenFromStdin: false,
      accountId: "account-1",
      redirectDomain: "go.example.com",
      administratorEmail: "owner@example.com",
    });

    expect(result.ok).toBe(true);
    expect(result.finalState).toBe("planned");
    expect(result.plan).toMatchObject({ operation: "install", sourceRelease: "fresh" });
  });
});

function releaseManifest() {
  return {
    formatVersion: 1 as const,
    release: "1.0.0",
    schema: {
      version: 5,
      journalSha256: "1".repeat(64),
      migrations: ["0005_deployment_control.sql"],
    },
    supportedSources: ["fresh" as const],
    rollbackSafeFrom: [],
    artifacts: {
      management: { path: "release/management", sha256: "2".repeat(64) },
      redirect: { path: "release/redirect", sha256: "3".repeat(64) },
      migrations: { path: "release/migrations", sha256: "4".repeat(64) },
    },
  };
}
