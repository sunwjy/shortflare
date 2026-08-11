import { describe, expect, it } from "vitest";

import {
  createD1DeploymentJournal,
  DeploymentLeaseConflictError,
} from "../src/d1-deployment-journal";
import type { DeploymentPlan } from "../src/deployment-plan";

describe("D1 Deployment Attempt journal", () => {
  it("copies progress into a new attempt without reopening a sealed failure", async () => {
    const calls: string[] = [];
    const journal = createD1DeploymentJournal({
      now: () => new Date(1_000),
      randomId: () => "new-attempt",
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes("status = 'running'")) return [];
        if (sql.includes("status = 'failed'")) {
          return [{ id: "attempt-1", completedActions: "[0,2]" }];
        }
        if (sql.includes("RETURNING fencing_token")) return [{ fencingToken: 4 }];
        return [];
      },
    });

    await expect(journal.begin(plan())).resolves.toEqual({
      attemptId: "new-attempt",
      completedActionIndexes: [0, 2],
      fencingToken: 4,
    });
    expect(calls.some((sql) => sql.includes("fencing_token + 1"))).toBe(true);
    expect(
      calls.some((sql) => sql.includes("UPDATE deployment_attempts\n           SET status")),
    ).toBe(false);
  });

  it("rejects an active competing lease", async () => {
    const journal = createD1DeploymentJournal({
      now: () => new Date(1_000),
      randomId: () => "attempt-2",
      query: async (sql) => {
        if (sql.includes("FROM deployment_attempts")) return [];
        return [];
      },
    });

    await expect(journal.begin(plan())).rejects.toBeInstanceOf(DeploymentLeaseConflictError);
  });

  it("renews only the holder's unexpired fencing token", async () => {
    const journal = createD1DeploymentJournal({
      now: () => new Date(1_000),
      randomId: () => "attempt-1",
      query: async (sql) => (sql.includes("RETURNING fencing_token") ? [] : []),
    });
    await expect(journal.revalidateAndRenewLease("attempt-1", 7)).resolves.toEqual({ ok: false });
  });

  it("records stage time, release identity, backup metadata, and recovery name", async () => {
    const updates: Array<{ sql: string; parameters: readonly (string | null)[] }> = [];
    const journal = createD1DeploymentJournal({
      now: () => new Date(1_000),
      randomId: () => "attempt-detailed",
      query: async (sql, parameters) => {
        if (sql.startsWith("PRAGMA")) return [{ name: "stage_outcomes" }];
        if (sql.includes("FROM deployment_attempts")) return [];
        if (sql.includes("RETURNING fencing_token")) return [{ fencingToken: 1 }];
        if (sql.includes("stage_outcomes =")) updates.push({ sql, parameters });
        return [];
      },
    });
    const deploymentPlan = plan();
    const attempt = await journal.begin(deploymentPlan);

    await journal.recordActionCompleted(
      attempt.attemptId,
      0,
      { kind: "recover", action: "orphan-resources", target: "primary-queue" },
      {
        backup: {
          bookmark: "bookmark-1",
          path: "/backups/upgrade.sql",
          sha256: "1".repeat(64),
        },
      },
    );

    expect(updates[0]?.parameters).toEqual(
      expect.arrayContaining([
        "bookmark-1",
        "/backups/upgrade.sql",
        "1".repeat(64),
        "orphan-resources",
        deploymentPlan.targetManifestDigest,
        deploymentPlan.sourceStateDigest,
      ]),
    );
    expect(updates[0]?.parameters.join(" ")).toContain('"completedAt":1000');
  });

  it("seals a failure before the extended failure-detail migration is applied", async () => {
    const failureUpdates: Array<{ sql: string; parameters: readonly (string | null)[] }> = [];
    const journal = createD1DeploymentJournal({
      now: () => new Date(2_000),
      randomId: () => "attempt-schema-8",
      query: async (sql, parameters) => {
        if (sql.startsWith("PRAGMA")) return [{ name: "stage_outcomes" }];
        if (sql.includes("FROM deployment_attempts")) return [];
        if (sql.includes("RETURNING fencing_token")) return [{ fencingToken: 1 }];
        if (sql.includes("SET status = 'failed'")) failureUpdates.push({ sql, parameters });
        return [];
      },
    });
    const attempt = await journal.begin(plan());

    await journal.fail(attempt.attemptId, {
      kind: "cloudflare-authorization",
      stage: "migration",
      retryable: false,
      recovery: "fix-cloudflare-access",
      resource: "D1 database shortflare",
      requiredPermission: "D1: Edit",
    });

    expect(failureUpdates).toHaveLength(1);
    expect(failureUpdates[0]?.sql).not.toContain("failure_resource");
    expect(failureUpdates[0]?.sql).not.toContain("required_permission");
    expect(failureUpdates[0]?.parameters).toEqual(
      expect.arrayContaining(["cloudflare-authorization", "migration", "fix-cloudflare-access"]),
    );
  });
});

function plan(): DeploymentPlan {
  return {
    operation: "install",
    accountId: "account-1",
    sourceRelease: "fresh",
    targetRelease: "1.0.0",
    targetManifestDigest: "b".repeat(64),
    sourceStateDigest: "c".repeat(64),
    targetSchemaVersion: 5,
    targetArtifactDigests: {
      management: "d".repeat(64),
      redirect: "e".repeat(64),
      migrations: "f".repeat(64),
    },
    destructive: false,
    actions: [],
    digest: "a".repeat(64),
  };
}
