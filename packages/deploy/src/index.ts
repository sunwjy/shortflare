export { parseCliArguments } from "./cli-contract.js";
export type {
  CliCommand,
  CliOutputMode,
  DeployCommand,
  DiagnoseCommand,
  ParseCliArgumentsResult,
  RecoverCommand,
  RecoveryAction,
} from "./cli-contract.js";
export { createDeploymentPlan } from "./deployment-plan.js";
export type {
  CreateDeploymentPlanResult,
  DeploymentAction,
  DeploymentPlan,
  DeploymentRequest,
  ExistingInstanceState,
  FreshAccountState,
  ObservedDeploymentDrift,
  ObservedDeploymentState,
} from "./deployment-plan.js";
export { runDeploymentPlan } from "./deployment-runner.js";
export type {
  DeploymentActionExecutor,
  DeploymentApproval,
  DeploymentAttemptJournal,
  DeploymentFailure,
  DeploymentRecovery,
  RunDeploymentPlanResult,
} from "./deployment-runner.js";
export {
  parseInstanceConfig,
  resolveShortflarePaths,
  writeInstanceConfig,
} from "./local-instance-config.js";
export type { InstanceConfig, ParseInstanceConfigResult } from "./local-instance-config.js";
export { hashReleaseArtifact, verifyReleaseBundle } from "./release-bundle.js";
export type { VerifyReleaseBundleResult } from "./release-bundle.js";
export { parseReleaseManifest } from "./release-manifest.js";
export type {
  ParseReleaseManifestResult,
  ReleaseManifest,
  ReleaseManifestIssue,
} from "./release-manifest.js";
