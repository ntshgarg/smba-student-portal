ALTER TABLE `training_changes` ADD `failed_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `training_changes` ADD `last_failed_at` integer;