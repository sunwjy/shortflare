import { describe, expect, it } from "vitest";

import type { DeploymentPlan } from "../src/deployment-plan";
import { runDeploymentPlan } from "../src/deployment-runner";

describe("Deployment Plan runner", () => {
  it("revalidates before every effect and records progress for resumption", async () => {
    const calls: string[] = [];
    const plan = deploymentPlan();

    const result = await runDeploymentPlan({
      plan,
      approval: { kind: "non-destructive" },
      dryRun: false,
      journal: {
        async begin() {
          calls.push("begin");
          return { attemptId: "attempt-1", completedActionIndexes: [0], fencingToken: 7 };
        },
        async revalidateAndRenewLease(attemptId, fencingToken) {
          calls.push(`lease:${attemptId}:${fencingToken}`);
          return { ok: true };
        },
        async recordActionCompleted(attemptId, actionIndex) {
          calls.push(`record:${attemptId}:${actionIndex}`);
        },
        async complete(attemptId) {
          calls.push(`complete:${attemptId}`);
        },
        async fail() {
          throw new Error("not called");
        },
      },
      executor: {
        async revalidate(action) {
          calls.push(`check:${action.kind}`);
          return { ok: true };
        },
        async apply(action) {
          calls.push(`apply:${action.kind}`);
          return { ok: true };
        },
      },
    });

    expect(result).toEqual({
      ok: true,
      formatVersion: 1,
      attemptId: "attempt-1",
      planDigest: plan.digest,
      sourceRelease: "fresh",
      targetRelease: "1.0.0",
      completedStages: ["write-deployment-marker", "upload-worker", "record-coherent-release"],
      finalState: "coherent",
    });
    expect(calls).toEqual([
      "begin",
      "lease:attempt-1:7",
      "check:upload-worker",
      "apply:upload-worker",
      "record:attempt-1:1",
      "lease:attempt-1:7",
      "check:record-coherent-release",
      "apply:record-coherent-release",
      "record:attempt-1:2",
      "complete:attempt-1",
    ]);
  });

  it("does not record a coherent release after a failed Worker deployment", async () => {
    const applied: string[] = [];
    const failures: string[] = [];
    const plan = deploymentPlan();

    const result = await runDeploymentPlan({
      plan,
      approval: { kind: "non-destructive" },
      dryRun: false,
      journal: {
        async begin() {
          return { attemptId: "attempt-2", completedActionIndexes: [], fencingToken: 8 };
        },
        async revalidateAndRenewLease() {
          return { ok: true };
        },
        async recordActionCompleted() {},
        async complete() {},
        async fail(_attemptId, failure) {
          failures.push(failure.stage);
        },
      },
      executor: {
        async revalidate() {
          return { ok: true };
        },
        async apply(action) {
          applied.push(action.kind);
          return action.kind === "upload-worker"
            ? { ok: false, retryable: true, recovery: "rerun-deploy" as const }
            : { ok: true };
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      formatVersion: 1,
      exitCode: 5,
      error: {
        kind: "cloudflare-transient",
        failedStage: "upload-worker",
        retryable: true,
        recovery: "rerun-deploy",
      },
    });
    expect(applied).toEqual(["write-deployment-marker", "upload-worker"]);
    expect(applied).not.toContain("record-coherent-release");
    expect(failures).toEqual(["upload-worker"]);
  });

  it("stops before an external effect after losing the fencing token", async () => {
    let applied = false;
    const result = await runDeploymentPlan({
      plan: deploymentPlan(),
      approval: { kind: "non-destructive" },
      dryRun: false,
      journal: {
        async begin() {
          return { attemptId: "attempt-lost", completedActionIndexes: [], fencingToken: 9 };
        },
        async revalidateAndRenewLease() {
          return { ok: false };
        },
        async recordActionCompleted() {},
        async complete() {},
        async fail() {},
      },
      executor: {
        async revalidate() {
          return { ok: true };
        },
        async apply() {
          applied = true;
          return { ok: true };
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      exitCode: 3,
      error: { kind: "lease-lost", recovery: "regenerate-plan" },
    });
    expect(applied).toBe(false);
  });

  it("rejects stale or insufficient approval before opening an attempt", async () => {
    let began = false;
    const result = await runDeploymentPlan({
      plan: { ...deploymentPlan(), destructive: true },
      approval: { kind: "plan-digest", digest: "b".repeat(64) },
      dryRun: false,
      journal: {
        async begin() {
          began = true;
          return { attemptId: "never", completedActionIndexes: [], fencingToken: 1 };
        },
        async revalidateAndRenewLease() {
          return { ok: true };
        },
        async recordActionCompleted() {},
        async complete() {},
        async fail() {},
      },
      executor: {
        async revalidate() {
          return { ok: true };
        },
        async apply() {
          return { ok: true };
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      formatVersion: 1,
      exitCode: 4,
      error: {
        kind: "approval-required",
        failedStage: "approval",
        retryable: false,
        recovery: "approve-plan-digest",
      },
    });
    expect(began).toBe(false);
  });

  it("returns a dry-run result without opening an attempt or applying effects", async () => {
    let mutated = false;
    const plan = deploymentPlan();
    const result = await runDeploymentPlan({
      plan,
      approval: { kind: "none" },
      dryRun: true,
      journal: {
        async begin() {
          mutated = true;
          return { attemptId: "never", completedActionIndexes: [], fencingToken: 1 };
        },
        async revalidateAndRenewLease() {
          return { ok: true };
        },
        async recordActionCompleted() {},
        async complete() {},
        async fail() {},
      },
      executor: {
        async revalidate() {
          mutated = true;
          return { ok: true };
        },
        async apply() {
          mutated = true;
          return { ok: true };
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      formatVersion: 1,
      attemptId: null,
      planDigest: plan.digest,
      finalState: "planned",
    });
    expect(mutated).toBe(false);
  });
});

function deploymentPlan(): DeploymentPlan {
  return {
    operation: "install",
    accountId: "account-1",
    sourceRelease: "fresh",
    targetRelease: "1.0.0",
    destructive: false,
    actions: [
      { kind: "write-deployment-marker" },
      { kind: "upload-worker", worker: "management" },
      { kind: "record-coherent-release", release: "1.0.0" },
    ],
    digest: "a".repeat(64),
  };
}
