DROP INDEX `audit_events_occurred_at_idx`;--> statement-breakpoint
DROP INDEX `audit_events_subject_idx`;--> statement-breakpoint
CREATE INDEX `audit_events_actor_idx` ON `audit_events` (`actor_id`,"occurred_at" DESC,"id" ASC);--> statement-breakpoint
CREATE INDEX `audit_events_action_idx` ON `audit_events` (`action`,"occurred_at" DESC,"id" ASC);--> statement-breakpoint
CREATE INDEX `audit_events_occurred_at_idx` ON `audit_events` ("occurred_at" DESC,"id" ASC);--> statement-breakpoint
CREATE INDEX `audit_events_subject_idx` ON `audit_events` (`subject_id`,"occurred_at" DESC,"id" ASC);