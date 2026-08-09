import { describe, expect, it } from "vitest";

import {
  createD1DeploymentJournal,
  DeploymentLeaseConflictError,
} from "../src/d1-deployment-journal";
import type { DeploymentPlan } from "../src/deployment-plan";

describe("D1 Deployment Attempt journal", () => {
  it("resumes completed actions and acquires a monotonically fenced lease", async () => {
    const calls: string[] = [];
    const journal = createD1DeploymentJournal({
      now: () => new Date(1_000),
      randomId: () => "new-attempt",
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes("FROM deployment_attempts")) {
          return [{ id: "attempt-1", completedActions: "[0,2]" }];
        }
        if (sql.includes("RETURNING fencing_token")) return [{ fencingToken: 4 }];
        return [];
      },
    });

    await expect(journal.begin(plan())).resolves.toEqual({
      attemptId: "attempt-1",
      completedActionIndexes: [0, 2],
      fencingToken: 4,
    });
    expect(calls.some((sql) => sql.includes("fencing_token + 1"))).toBe(true);
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
});

function plan(): DeploymentPlan {
  return {
    operation: "install",
    accountId: "account-1",
    sourceRelease: "fresh",
    targetRelease: "1.0.0",
    destructive: false,
    actions: [],
    digest: "a".repeat(64),
  };
}
