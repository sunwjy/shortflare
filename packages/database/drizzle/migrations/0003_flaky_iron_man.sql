CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`classification_version` integer NOT NULL,
	`link_id` text NOT NULL,
	`destination_version_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`ingested_at` integer NOT NULL,
	`pseudonymous_visitor` text NOT NULL,
	`bot_classification` text NOT NULL,
	`referrer_domain` text NOT NULL,
	`country` text NOT NULL,
	`device_category` text NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_version_id`) REFERENCES `destination_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analytics_events_id_check" CHECK(length("analytics_events"."id") BETWEEN 1 AND 128),
	CONSTRAINT "analytics_events_schema_version_check" CHECK("analytics_events"."schema_version" = 1),
	CONSTRAINT "analytics_events_classification_version_check" CHECK("analytics_events"."classification_version" = 1),
	CONSTRAINT "analytics_events_occurred_at_check" CHECK(typeof("analytics_events"."occurred_at") = 'integer' AND "analytics_events"."occurred_at" >= 0),
	CONSTRAINT "analytics_events_ingested_at_check" CHECK(typeof("analytics_events"."ingested_at") = 'integer' AND "analytics_events"."ingested_at" >= 0),
	CONSTRAINT "analytics_events_pseudonym_check" CHECK(length("analytics_events"."pseudonymous_visitor") = 43),
	CONSTRAINT "analytics_events_bot_check" CHECK("analytics_events"."bot_classification" IN ('human', 'suspected-bot')),
	CONSTRAINT "analytics_events_referrer_check" CHECK(length("analytics_events"."referrer_domain") BETWEEN 1 AND 253),
	CONSTRAINT "analytics_events_country_check" CHECK("analytics_events"."country" = 'unknown' OR length("analytics_events"."country") = 2),
	CONSTRAINT "analytics_events_device_check" CHECK("analytics_events"."device_category" IN ('desktop', 'mobile', 'tablet', 'other', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX `analytics_events_link_time_idx` ON `analytics_events` (`link_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_destination_time_idx` ON `analytics_events` (`destination_version_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_retention_idx` ON `analytics_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `analytics_rollups` (
	`scope_kind` text NOT NULL,
	`scope_id` text NOT NULL,
	`link_id` text NOT NULL,
	`destination_version_id` text,
	`interval` text NOT NULL,
	`bucket` integer NOT NULL,
	`dimension` text NOT NULL,
	`dimension_value` text NOT NULL,
	`human_clicks` integer DEFAULT 0 NOT NULL,
	`unique_human_clicks` integer DEFAULT 0 NOT NULL,
	`suspected_bot_clicks` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`scope_kind`, `scope_id`, `interval`, `bucket`, `dimension`, `dimension_value`),
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_version_id`) REFERENCES `destination_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analytics_rollups_scope_check" CHECK(("analytics_rollups"."scope_kind" = 'link' AND "analytics_rollups"."destination_version_id" IS NULL)
          OR ("analytics_rollups"."scope_kind" = 'destination-version' AND "analytics_rollups"."destination_version_id" IS NOT NULL)),
	CONSTRAINT "analytics_rollups_scope_id_check" CHECK(length("analytics_rollups"."scope_id") BETWEEN 1 AND 128),
	CONSTRAINT "analytics_rollups_bucket_check" CHECK(typeof("analytics_rollups"."bucket") = 'integer' AND "analytics_rollups"."bucket" >= 0),
	CONSTRAINT "analytics_rollups_dimension_check" CHECK("analytics_rollups"."dimension" IN ('total', 'referrer', 'country', 'device', 'bot')),
	CONSTRAINT "analytics_rollups_dimension_value_check" CHECK(length("analytics_rollups"."dimension_value") BETWEEN 1 AND 253),
	CONSTRAINT "analytics_rollups_counts_check" CHECK("analytics_rollups"."human_clicks" >= 0
          AND "analytics_rollups"."unique_human_clicks" >= 0
          AND "analytics_rollups"."suspected_bot_clicks" >= 0)
);
--> statement-breakpoint
CREATE INDEX `analytics_rollups_query_idx` ON `analytics_rollups` (`scope_kind`,`scope_id`,`interval`,`bucket`);--> statement-breakpoint
CREATE INDEX `analytics_rollups_retention_idx` ON `analytics_rollups` (`interval`,`bucket`);--> statement-breakpoint
CREATE INDEX `analytics_rollups_link_idx` ON `analytics_rollups` (`link_id`);--> statement-breakpoint
CREATE TABLE `analytics_uniques` (
	`scope_kind` text NOT NULL,
	`scope_id` text NOT NULL,
	`link_id` text NOT NULL,
	`destination_version_id` text,
	`half_hour` integer NOT NULL,
	`dimension` text NOT NULL,
	`dimension_value` text NOT NULL,
	`pseudonymous_visitor` text NOT NULL,
	PRIMARY KEY(`scope_kind`, `scope_id`, `half_hour`, `dimension`, `dimension_value`, `pseudonymous_visitor`),
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_version_id`) REFERENCES `destination_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analytics_uniques_scope_check" CHECK(("analytics_uniques"."scope_kind" = 'link' AND "analytics_uniques"."destination_version_id" IS NULL)
          OR ("analytics_uniques"."scope_kind" = 'destination-version' AND "analytics_uniques"."destination_version_id" IS NOT NULL)),
	CONSTRAINT "analytics_uniques_scope_id_check" CHECK(length("analytics_uniques"."scope_id") BETWEEN 1 AND 128),
	CONSTRAINT "analytics_uniques_half_hour_check" CHECK(typeof("analytics_uniques"."half_hour") = 'integer' AND "analytics_uniques"."half_hour" >= 0),
	CONSTRAINT "analytics_uniques_dimension_check" CHECK("analytics_uniques"."dimension" IN ('total', 'referrer', 'country', 'device')),
	CONSTRAINT "analytics_uniques_dimension_value_check" CHECK(length("analytics_uniques"."dimension_value") BETWEEN 1 AND 253),
	CONSTRAINT "analytics_uniques_pseudonym_check" CHECK(length("analytics_uniques"."pseudonymous_visitor") = 43)
);
--> statement-breakpoint
CREATE INDEX `analytics_uniques_retention_idx` ON `analytics_uniques` (`half_hour`);--> statement-breakpoint
CREATE INDEX `analytics_uniques_link_idx` ON `analytics_uniques` (`link_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`subject_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	CONSTRAINT "audit_events_id_check" CHECK(length("__new_audit_events"."id") BETWEEN 1 AND 128),
	CONSTRAINT "audit_events_actor_id_check" CHECK(length("__new_audit_events"."actor_id") BETWEEN 1 AND 128),
	CONSTRAINT "audit_events_action_check" CHECK("__new_audit_events"."action" IN (
        'create',
        'edit',
        'update-title',
        'update-destination',
        'activate',
        'disable',
        'archive',
        'restore',
        'permanently-delete',
        'release-alias',
        'initial-administrator-activate',
        'invitation-issue',
        'invitation-reissue',
        'invitation-accept',
        'invitation-cancel',
        'role-change',
        'user-suspend',
        'user-reactivate',
        'password-reset-issue',
        'password-reset-use',
        'password-change',
        'operator-recovery',
        'analytics-erase',
        'analytics-recalculate'
      )),
	CONSTRAINT "audit_events_subject_id_check" CHECK(length("__new_audit_events"."subject_id") BETWEEN 1 AND 128),
	CONSTRAINT "audit_events_occurred_at_check" CHECK(typeof("__new_audit_events"."occurred_at") = 'integer' AND "__new_audit_events"."occurred_at" >= 0),
	CONSTRAINT "audit_events_metadata_check" CHECK(json_valid("__new_audit_events"."metadata")
          AND length("__new_audit_events"."metadata") <= 2048)
);
--> statement-breakpoint
INSERT INTO `__new_audit_events`("id", "actor_id", "action", "subject_id", "occurred_at", "metadata") SELECT "id", "actor_id", "action", "subject_id", "occurred_at", "metadata" FROM `audit_events`;--> statement-breakpoint
DROP TABLE `audit_events`;--> statement-breakpoint
ALTER TABLE `__new_audit_events` RENAME TO `audit_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_events_occurred_at_idx` ON `audit_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_subject_idx` ON `audit_events` (`subject_id`,`occurred_at`);