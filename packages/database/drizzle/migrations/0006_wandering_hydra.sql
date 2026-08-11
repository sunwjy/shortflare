PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_coherent_release` (
	`singleton_key` integer PRIMARY KEY NOT NULL,
	`release` text NOT NULL,
	`schema_version` integer NOT NULL,
	`management_worker_version` text NOT NULL,
	`redirect_worker_version` text NOT NULL,
	`management_artifact_sha256` text,
	`redirect_artifact_sha256` text,
	`manifest_sha256` text NOT NULL,
	`recorded_at` integer NOT NULL,
	CONSTRAINT "coherent_release_singleton_key_check" CHECK(typeof("__new_coherent_release"."singleton_key") = 'integer' AND "__new_coherent_release"."singleton_key" = 1),
	CONSTRAINT "coherent_release_release_check" CHECK(length("__new_coherent_release"."release") BETWEEN 1 AND 128),
	CONSTRAINT "coherent_release_schema_version_check" CHECK(typeof("__new_coherent_release"."schema_version") = 'integer' AND "__new_coherent_release"."schema_version" >= 0),
	CONSTRAINT "coherent_release_management_worker_version_check" CHECK(length("__new_coherent_release"."management_worker_version") BETWEEN 1 AND 256),
	CONSTRAINT "coherent_release_redirect_worker_version_check" CHECK(length("__new_coherent_release"."redirect_worker_version") BETWEEN 1 AND 256),
	CONSTRAINT "coherent_release_management_artifact_sha256_check" CHECK(length("__new_coherent_release"."management_artifact_sha256") = 64 AND "__new_coherent_release"."management_artifact_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "coherent_release_redirect_artifact_sha256_check" CHECK(length("__new_coherent_release"."redirect_artifact_sha256") = 64 AND "__new_coherent_release"."redirect_artifact_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "coherent_release_manifest_sha256_check" CHECK(length("__new_coherent_release"."manifest_sha256") = 64 AND "__new_coherent_release"."manifest_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "coherent_release_recorded_at_check" CHECK(typeof("__new_coherent_release"."recorded_at") = 'integer' AND "__new_coherent_release"."recorded_at" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_coherent_release`("singleton_key", "release", "schema_version", "management_worker_version", "redirect_worker_version", "manifest_sha256", "recorded_at") SELECT "singleton_key", "release", "schema_version", "management_worker_version", "redirect_worker_version", "manifest_sha256", "recorded_at" FROM `coherent_release`;--> statement-breakpoint
DROP TABLE `coherent_release`;--> statement-breakpoint
ALTER TABLE `__new_coherent_release` RENAME TO `coherent_release`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
