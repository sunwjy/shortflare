import { createHash } from "node:crypto";

import type { RecoverCommand } from "./cli-contract.js";
import type { DeploymentPlan } from "./deployment-plan.js";
import type { ReleaseManifest } from "./release-manifest.js";

export function createRecoveryPlan(
  accountId: string,
  release: string,
  command: RecoverCommand,
  observedState: unknown,
  manifest: ReleaseManifest,
): DeploymentPlan {
  const target = recoveryTarget(command);
  const unsigned = {
    operation: "upgrade" as const,
    accountId,
    sourceRelease: release,
    targetRelease: release,
    targetManifestDigest: createHash("sha256").update(JSON.stringify(observedState)).digest("hex"),
    sourceStateDigest: createHash("sha256").update(JSON.stringify(observedState)).digest("hex"),
    targetSchemaVersion: manifest.schema.version,
    targetArtifactDigests: {
      management: manifest.artifacts.management.sha256,
      redirect: manifest.artifacts.redirect.sha256,
      migrations: manifest.artifacts.migrations.sha256,
    },
    destructive: true,
    actions: [{ kind: "recover" as const, action: command.action, target }],
  };
  return {
    ...unsigned,
    digest: createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"),
  };
}

function recoveryTarget(command: RecoverCommand): string {
  if (command.action === "orphan-resources") return command.resource ?? "missing-resource";
  if (command.action === "setup-token") {
    return createHash("sha256")
      .update(command.administratorEmail ?? "")
      .digest("hex");
  }
  if (command.action === "worker-rollback") {
    return `${command.worker ?? "missing-worker"}:${command.versionTag ?? "missing-version"}`;
  }
  return command.secretFromStdin ? "restore" : "rotate";
}
