ALTER TABLE `deployment_attempts` ADD `target_manifest_digest` text NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' CHECK(length(`target_manifest_digest`) = 64 AND `target_manifest_digest` NOT GLOB '*[^0-9a-f]*');--> statement-breakpoint
ALTER TABLE `deployment_attempts` ADD `source_state_digest` text NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' CHECK(length(`source_state_digest`) = 64 AND `source_state_digest` NOT GLOB '*[^0-9a-f]*');--> statement-breakpoint
ALTER TABLE `deployment_attempts` ADD `target_schema_version` integer NOT NULL DEFAULT 0 CHECK(typeof(`target_schema_version`) = 'integer' AND `target_schema_version` >= 0);--> statement-breakpoint
ALTER TABLE `deployment_attempts` ADD `target_artifact_digests` text NOT NULL DEFAULT '{}' CHECK(json_valid(`target_artifact_digests`) AND json_type(`target_artifact_digests`) = 'object');--> statement-breakpoint
ALTER TABLE `deployment_attempts` ADD `stage_outcomes` text NOT NULL DEFAULT '[]' CHECK(json_valid(`stage_outcomes`) AND json_type(`stage_outcomes`) = 'array');--> statement-breakpoint
ALTER TABLE `deployment_attempts` ADD `backup_bookmark` text;--> statement-breakpoint
ALTER TABLE `deployment_attempts` ADD `backup_path` text;--> statement-breakpoint
ALTER TABLE `deployment_attempts` ADD `backup_sha256` text CHECK(`backup_sha256` IS NULL OR (length(`backup_sha256`) = 64 AND `backup_sha256` NOT GLOB '*[^0-9a-f]*'));--> statement-breakpoint
ALTER TABLE `deployment_attempts` ADD `recovery_action` text;
