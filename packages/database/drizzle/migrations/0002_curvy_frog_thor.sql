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
        'operator-recovery'
      )),
	CONSTRAINT "audit_events_subject_id_check" CHECK(length("__new_audit_events"."subject_id") BETWEEN 1 AND 128),
	CONSTRAINT "audit_events_occurred_at_check" CHECK(typeof("__new_audit_events"."occurred_at") = 'integer' AND "__new_audit_events"."occurred_at" >= 0),
	CONSTRAINT "audit_events_metadata_check" CHECK(json_valid("__new_audit_events"."metadata")
          AND length("__new_audit_events"."metadata") <= 2048)
);
--> statement-breakpoint
INSERT INTO `__new_audit_events`("id", "actor_id", "action", "subject_id", "occurred_at", "metadata")
SELECT "id", "actor_id", "action", "subject_id", "occurred_at", "metadata"
FROM `audit_events`;--> statement-breakpoint
DROP TABLE `audit_events`;--> statement-breakpoint
ALTER TABLE `__new_audit_events` RENAME TO `audit_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_events_occurred_at_idx` ON `audit_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_subject_idx` ON `audit_events` (`subject_id`,`occurred_at`);
--> statement-breakpoint
DROP INDEX `links_list_order_idx`;--> statement-breakpoint
CREATE INDEX `links_list_order_idx` ON `links` (`created_at` DESC,`id` ASC);--> statement-breakpoint
CREATE INDEX `aliases_reserved_order_idx` ON `aliases` (`reserved_at` DESC,`alias` ASC);
