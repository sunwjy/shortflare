CREATE TABLE `coherent_release` (
	`singleton_key` integer PRIMARY KEY NOT NULL,
	`release` text NOT NULL,
	`schema_version` integer NOT NULL,
	`management_worker_version` text NOT NULL,
	`redirect_worker_version` text NOT NULL,
	`manifest_sha256` text NOT NULL,
	`recorded_at` integer NOT NULL,
	CONSTRAINT "coherent_release_singleton_key_check" CHECK(typeof("coherent_release"."singleton_key") = 'integer' AND "coherent_release"."singleton_key" = 1),
	CONSTRAINT "coherent_release_release_check" CHECK(length("coherent_release"."release") BETWEEN 1 AND 128),
	CONSTRAINT "coherent_release_schema_version_check" CHECK(typeof("coherent_release"."schema_version") = 'integer' AND "coherent_release"."schema_version" >= 0),
	CONSTRAINT "coherent_release_management_worker_version_check" CHECK(length("coherent_release"."management_worker_version") BETWEEN 1 AND 256),
	CONSTRAINT "coherent_release_redirect_worker_version_check" CHECK(length("coherent_release"."redirect_worker_version") BETWEEN 1 AND 256),
	CONSTRAINT "coherent_release_manifest_sha256_check" CHECK(length("coherent_release"."manifest_sha256") = 64 AND "coherent_release"."manifest_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "coherent_release_recorded_at_check" CHECK(typeof("coherent_release"."recorded_at") = 'integer' AND "coherent_release"."recorded_at" >= 0)
);
--> statement-breakpoint
CREATE TABLE `deployment_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_digest` text NOT NULL,
	`source_release` text NOT NULL,
	`target_release` text NOT NULL,
	`status` text NOT NULL,
	`completed_actions` text NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`failure_kind` text,
	`failed_stage` text,
	CONSTRAINT "deployment_attempts_id_check" CHECK(length("deployment_attempts"."id") BETWEEN 1 AND 128),
	CONSTRAINT "deployment_attempts_plan_digest_check" CHECK(length("deployment_attempts"."plan_digest") = 64 AND "deployment_attempts"."plan_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "deployment_attempts_source_release_check" CHECK(length("deployment_attempts"."source_release") BETWEEN 1 AND 128),
	CONSTRAINT "deployment_attempts_target_release_check" CHECK(length("deployment_attempts"."target_release") BETWEEN 1 AND 128),
	CONSTRAINT "deployment_attempts_status_check" CHECK("deployment_attempts"."status" IN ('running', 'failed', 'coherent')),
	CONSTRAINT "deployment_attempts_completed_actions_check" CHECK(json_valid("deployment_attempts"."completed_actions") AND json_type("deployment_attempts"."completed_actions") = 'array'),
	CONSTRAINT "deployment_attempts_started_at_check" CHECK(typeof("deployment_attempts"."started_at") = 'integer' AND "deployment_attempts"."started_at" >= 0),
	CONSTRAINT "deployment_attempts_updated_at_check" CHECK(typeof("deployment_attempts"."updated_at") = 'integer' AND "deployment_attempts"."updated_at" >= 0),
	CONSTRAINT "deployment_attempts_time_order_check" CHECK("deployment_attempts"."updated_at" >= "deployment_attempts"."started_at"),
	CONSTRAINT "deployment_attempts_failure_check" CHECK(("deployment_attempts"."status" = 'failed' AND "deployment_attempts"."failure_kind" IS NOT NULL AND "deployment_attempts"."failed_stage" IS NOT NULL)
          OR ("deployment_attempts"."status" != 'failed' AND "deployment_attempts"."failure_kind" IS NULL AND "deployment_attempts"."failed_stage" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `deployment_attempts_status_idx` ON `deployment_attempts` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `deployment_lease` (
	`singleton_key` integer PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`fencing_token` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `deployment_attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "deployment_lease_singleton_key_check" CHECK(typeof("deployment_lease"."singleton_key") = 'integer' AND "deployment_lease"."singleton_key" = 1),
	CONSTRAINT "deployment_lease_expires_at_check" CHECK(typeof("deployment_lease"."expires_at") = 'integer' AND "deployment_lease"."expires_at" >= 0),
	CONSTRAINT "deployment_lease_fencing_token_check" CHECK(typeof("deployment_lease"."fencing_token") = 'integer' AND "deployment_lease"."fencing_token" > 0)
);
--> statement-breakpoint
CREATE TABLE `deployment_marker` (
	`singleton_key` integer PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`installation_release` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "deployment_marker_singleton_key_check" CHECK(typeof("deployment_marker"."singleton_key") = 'integer' AND "deployment_marker"."singleton_key" = 1),
	CONSTRAINT "deployment_marker_instance_id_check" CHECK(length("deployment_marker"."instance_id") BETWEEN 1 AND 128),
	CONSTRAINT "deployment_marker_installation_release_check" CHECK(length("deployment_marker"."installation_release") BETWEEN 1 AND 128),
	CONSTRAINT "deployment_marker_created_at_check" CHECK(typeof("deployment_marker"."created_at") = 'integer' AND "deployment_marker"."created_at" >= 0)
);
--> statement-breakpoint
CREATE TRIGGER `deployment_marker_immutable`
BEFORE UPDATE ON `deployment_marker`
BEGIN
	SELECT RAISE(ABORT, 'deployment marker is immutable');
END;
