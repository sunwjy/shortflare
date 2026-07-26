CREATE TABLE `credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`verifier` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "credentials_verifier_check" CHECK(length("credentials"."verifier") BETWEEN 1 AND 1024),
	CONSTRAINT "credentials_updated_at_check" CHECK(typeof("credentials"."updated_at") = 'integer' AND "credentials"."updated_at" >= 0)
);
--> statement-breakpoint
CREATE TABLE `initial_setup` (
	`singleton_key` integer PRIMARY KEY NOT NULL,
	`display_email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "initial_setup_singleton_key_check" CHECK(typeof("initial_setup"."singleton_key") = 'integer' AND "initial_setup"."singleton_key" = 1),
	CONSTRAINT "initial_setup_display_email_check" CHECK(length("initial_setup"."display_email") BETWEEN 3 AND 254),
	CONSTRAINT "initial_setup_normalized_email_check" CHECK(length("initial_setup"."normalized_email") BETWEEN 3 AND 254
          AND "initial_setup"."normalized_email" = lower("initial_setup"."normalized_email")),
	CONSTRAINT "initial_setup_token_hash_check" CHECK(length("initial_setup"."token_hash") = 64),
	CONSTRAINT "initial_setup_created_at_check" CHECK(typeof("initial_setup"."created_at") = 'integer' AND "initial_setup"."created_at" >= 0),
	CONSTRAINT "initial_setup_expires_at_check" CHECK(typeof("initial_setup"."expires_at") = 'integer' AND "initial_setup"."expires_at" >= 0),
	CONSTRAINT "initial_setup_expiry_order_check" CHECK("initial_setup"."expires_at" > "initial_setup"."created_at")
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invitations_id_check" CHECK(length("invitations"."id") BETWEEN 1 AND 128),
	CONSTRAINT "invitations_token_hash_check" CHECK(length("invitations"."token_hash") = 64),
	CONSTRAINT "invitations_issued_at_check" CHECK(typeof("invitations"."issued_at") = 'integer' AND "invitations"."issued_at" >= 0),
	CONSTRAINT "invitations_expires_at_check" CHECK(typeof("invitations"."expires_at") = 'integer' AND "invitations"."expires_at" >= 0),
	CONSTRAINT "invitations_expiry_order_check" CHECK("invitations"."expires_at" > "invitations"."issued_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_user_id_unique` ON `invitations` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE TABLE `operator_recovery` (
	`singleton_key` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "operator_recovery_singleton_key_check" CHECK(typeof("operator_recovery"."singleton_key") = 'integer' AND "operator_recovery"."singleton_key" = 1),
	CONSTRAINT "operator_recovery_token_hash_check" CHECK(length("operator_recovery"."token_hash") = 64),
	CONSTRAINT "operator_recovery_created_at_check" CHECK(typeof("operator_recovery"."created_at") = 'integer' AND "operator_recovery"."created_at" >= 0),
	CONSTRAINT "operator_recovery_expires_at_check" CHECK(typeof("operator_recovery"."expires_at") = 'integer' AND "operator_recovery"."expires_at" >= 0),
	CONSTRAINT "operator_recovery_expiry_order_check" CHECK("operator_recovery"."expires_at" > "operator_recovery"."created_at")
);
--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "password_resets_id_check" CHECK(length("password_resets"."id") BETWEEN 1 AND 128),
	CONSTRAINT "password_resets_token_hash_check" CHECK(length("password_resets"."token_hash") = 64),
	CONSTRAINT "password_resets_issued_at_check" CHECK(typeof("password_resets"."issued_at") = 'integer' AND "password_resets"."issued_at" >= 0),
	CONSTRAINT "password_resets_expires_at_check" CHECK(typeof("password_resets"."expires_at") = 'integer' AND "password_resets"."expires_at" >= 0),
	CONSTRAINT "password_resets_expiry_order_check" CHECK("password_resets"."expires_at" > "password_resets"."issued_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_user_id_unique` ON `password_resets` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_hash_unique` ON `password_resets` (`token_hash`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`recent_authentication_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessions_id_check" CHECK(length("sessions"."id") BETWEEN 1 AND 128),
	CONSTRAINT "sessions_token_hash_check" CHECK(length("sessions"."token_hash") = 64),
	CONSTRAINT "sessions_csrf_token_hash_check" CHECK(length("sessions"."csrf_token_hash") = 64),
	CONSTRAINT "sessions_created_at_check" CHECK(typeof("sessions"."created_at") = 'integer' AND "sessions"."created_at" >= 0),
	CONSTRAINT "sessions_last_seen_at_check" CHECK(typeof("sessions"."last_seen_at") = 'integer' AND "sessions"."last_seen_at" >= 0),
	CONSTRAINT "sessions_idle_expires_at_check" CHECK(typeof("sessions"."idle_expires_at") = 'integer' AND "sessions"."idle_expires_at" >= 0),
	CONSTRAINT "sessions_absolute_expires_at_check" CHECK(typeof("sessions"."absolute_expires_at") = 'integer' AND "sessions"."absolute_expires_at" >= 0),
	CONSTRAINT "sessions_recent_authentication_at_check" CHECK(typeof("sessions"."recent_authentication_at") = 'integer' AND "sessions"."recent_authentication_at" >= 0),
	CONSTRAINT "sessions_time_order_check" CHECK("sessions"."last_seen_at" >= "sessions"."created_at"
          AND "sessions"."idle_expires_at" > "sessions"."last_seen_at"
          AND "sessions"."absolute_expires_at" > "sessions"."created_at"
          AND "sessions"."recent_authentication_at" >= "sessions"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`idle_expires_at`,`absolute_expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`state` text NOT NULL,
	`role` text NOT NULL,
	`activated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_id_check" CHECK(length("users"."id") BETWEEN 1 AND 128),
	CONSTRAINT "users_display_email_check" CHECK(length("users"."display_email") BETWEEN 3 AND 254),
	CONSTRAINT "users_normalized_email_check" CHECK(length("users"."normalized_email") BETWEEN 3 AND 254
          AND "users"."normalized_email" = lower("users"."normalized_email")
          AND "users"."normalized_email" NOT GLOB '*[^ -~]*'),
	CONSTRAINT "users_state_check" CHECK("users"."state" IN ('invited', 'active', 'suspended')),
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('administrator', 'member', 'viewer')),
	CONSTRAINT "users_activation_check" CHECK(("users"."state" = 'invited' AND "users"."activated_at" IS NULL)
          OR (
            "users"."state" IN ('active', 'suspended')
            AND "users"."activated_at" IS NOT NULL
          )),
	CONSTRAINT "users_created_at_check" CHECK(typeof("users"."created_at") = 'integer' AND "users"."created_at" >= 0),
	CONSTRAINT "users_updated_at_check" CHECK(typeof("users"."updated_at") = 'integer' AND "users"."updated_at" >= 0),
	CONSTRAINT "users_timestamp_order_check" CHECK("users"."updated_at" >= "users"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_normalized_email_unique` ON `users` (`normalized_email`);--> statement-breakpoint
CREATE INDEX `users_state_role_idx` ON `users` (`state`,`role`);--> statement-breakpoint
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
        'update-destination',
        'update-title',
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
INSERT INTO `__new_audit_events`("id", "actor_id", "action", "subject_id", "occurred_at", "metadata") SELECT "id", "actor_id", "action", "subject_id", "occurred_at", "metadata" FROM `audit_events`;--> statement-breakpoint
DROP TABLE `audit_events`;--> statement-breakpoint
ALTER TABLE `__new_audit_events` RENAME TO `audit_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_events_occurred_at_idx` ON `audit_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_subject_idx` ON `audit_events` (`subject_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `__new_instances` (
	`singleton_key` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`setup_completed_at` integer,
	CONSTRAINT "instances_singleton_key_check" CHECK(typeof("__new_instances"."singleton_key") = 'integer'
          AND "__new_instances"."singleton_key" = 1),
	CONSTRAINT "instances_created_at_check" CHECK(typeof("__new_instances"."created_at") = 'integer' AND "__new_instances"."created_at" >= 0),
	CONSTRAINT "instances_setup_completed_at_check" CHECK("__new_instances"."setup_completed_at" IS NULL OR (typeof("__new_instances"."setup_completed_at") = 'integer' AND "__new_instances"."setup_completed_at" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_instances`("singleton_key", "created_at", "setup_completed_at") SELECT "singleton_key", "created_at", NULL FROM `instances`;--> statement-breakpoint
DROP TABLE `instances`;--> statement-breakpoint
ALTER TABLE `__new_instances` RENAME TO `instances`;
