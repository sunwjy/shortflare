CREATE TABLE `aliases` (
	`alias` text PRIMARY KEY NOT NULL,
	`search_alias` text NOT NULL,
	`link_id` text,
	`deleted_link_id` text,
	`reserved_at` integer,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "aliases_value_check" CHECK(length("aliases"."alias") BETWEEN 1 AND 64
          AND "aliases"."alias" NOT GLOB '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "aliases_shape_check" CHECK((
        "aliases"."link_id" IS NOT NULL
        AND "aliases"."deleted_link_id" IS NULL
        AND "aliases"."reserved_at" IS NULL
      ) OR (
        "aliases"."link_id" IS NULL
        AND "aliases"."deleted_link_id" IS NOT NULL
        AND "aliases"."reserved_at" IS NOT NULL
      )),
	CONSTRAINT "aliases_search_value_check" CHECK(length("aliases"."search_alias") BETWEEN 1 AND 64),
	CONSTRAINT "aliases_deleted_link_id_check" CHECK("aliases"."deleted_link_id" IS NULL
          OR length("aliases"."deleted_link_id") BETWEEN 1 AND 128),
	CONSTRAINT "aliases_reserved_at_check" CHECK("aliases"."reserved_at" IS NULL
          OR (
            typeof("aliases"."reserved_at") = 'integer'
            AND "aliases"."reserved_at" >= 0
          ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aliases_link_id_unique` ON `aliases` (`link_id`);--> statement-breakpoint
CREATE INDEX `aliases_search_alias_idx` ON `aliases` (`search_alias`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`subject_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	CONSTRAINT "audit_events_id_check" CHECK(length("audit_events"."id") BETWEEN 1 AND 128),
	CONSTRAINT "audit_events_actor_id_check" CHECK(length("audit_events"."actor_id") BETWEEN 1 AND 128),
	CONSTRAINT "audit_events_action_check" CHECK("audit_events"."action" IN (
        'create',
        'update-destination',
        'update-title',
        'activate',
        'disable',
        'archive',
        'restore',
        'permanently-delete',
        'release-alias'
      )),
	CONSTRAINT "audit_events_subject_id_check" CHECK(length("audit_events"."subject_id") BETWEEN 1 AND 128),
	CONSTRAINT "audit_events_occurred_at_check" CHECK(typeof("audit_events"."occurred_at") = 'integer' AND "audit_events"."occurred_at" >= 0),
	CONSTRAINT "audit_events_metadata_check" CHECK(json_valid("audit_events"."metadata")
          AND length("audit_events"."metadata") <= 2048)
);
--> statement-breakpoint
CREATE INDEX `audit_events_occurred_at_idx` ON `audit_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_subject_idx` ON `audit_events` (`subject_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `destination_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`destination` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "destination_versions_id_check" CHECK(length("destination_versions"."id") BETWEEN 1 AND 128),
	CONSTRAINT "destination_versions_number_check" CHECK(typeof("destination_versions"."version_number") = 'integer'
          AND "destination_versions"."version_number" > 0),
	CONSTRAINT "destination_versions_destination_check" CHECK(length("destination_versions"."destination") BETWEEN 1 AND 8192),
	CONSTRAINT "destination_versions_created_at_check" CHECK(typeof("destination_versions"."created_at") = 'integer' AND "destination_versions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `destination_versions_link_number_unique` ON `destination_versions` (`link_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `destination_versions_latest_idx` ON `destination_versions` (`link_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `instances` (
	`singleton_key` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "instances_singleton_key_check" CHECK(typeof("instances"."singleton_key") = 'integer'
          AND "instances"."singleton_key" = 1),
	CONSTRAINT "instances_created_at_check" CHECK(typeof("instances"."created_at") = 'integer' AND "instances"."created_at" >= 0)
);
--> statement-breakpoint
INSERT INTO `instances` (`singleton_key`, `created_at`)
VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`search_title` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "links_id_check" CHECK(length("links"."id") BETWEEN 1 AND 128),
	CONSTRAINT "links_title_check" CHECK(length("links"."title") BETWEEN 1 AND 200),
	CONSTRAINT "links_search_title_check" CHECK(length("links"."search_title") BETWEEN 1 AND 2048),
	CONSTRAINT "links_state_check" CHECK("links"."state" IN ('active', 'disabled', 'archived')),
	CONSTRAINT "links_revision_check" CHECK(typeof("links"."revision") = 'integer' AND "links"."revision" >= 0),
	CONSTRAINT "links_created_at_check" CHECK(typeof("links"."created_at") = 'integer' AND "links"."created_at" >= 0),
	CONSTRAINT "links_updated_at_check" CHECK(typeof("links"."updated_at") = 'integer' AND "links"."updated_at" >= 0),
	CONSTRAINT "links_timestamp_order_check" CHECK("links"."updated_at" >= "links"."created_at")
);
--> statement-breakpoint
CREATE INDEX `links_list_order_idx` ON `links` (`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `links_search_title_idx` ON `links` (`search_title`);
