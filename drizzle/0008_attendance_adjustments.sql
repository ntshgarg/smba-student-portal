CREATE TABLE `attendance_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`player_account_id` text NOT NULL,
	`source_occurrence_id` text NOT NULL,
	`completed_on` text NOT NULL,
	`completion_occurrence_id` text,
	`reason` text,
	`published_by_account_id` text NOT NULL,
	`published_at` integer NOT NULL,
	`review_required_at` integer,
	`voided_by_account_id` text,
	`voided_at` integer,
	FOREIGN KEY (`player_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_occurrence_id`) REFERENCES `session_occurrences`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completion_occurrence_id`) REFERENCES `session_occurrences`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attendance_adjustments_player_idx` ON `attendance_adjustments` (`player_account_id`);--> statement-breakpoint
CREATE INDEX `attendance_adjustments_completed_on_idx` ON `attendance_adjustments` (`completed_on`);--> statement-breakpoint
CREATE INDEX `attendance_adjustments_review_idx` ON `attendance_adjustments` (`review_required_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_adjustments_active_source_idx` ON `attendance_adjustments` (`player_account_id`,`source_occurrence_id`) WHERE "attendance_adjustments"."voided_at" is null;