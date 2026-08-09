CREATE TABLE `session_series` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`programme` text NOT NULL,
	`venue` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text,
	`status` text DEFAULT 'active' NOT NULL,
	`replaced_series_id` text,
	`created_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`replaced_series_id`) REFERENCES `session_series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_series_status_idx` ON `session_series` (`status`);
--> statement-breakpoint
CREATE INDEX `session_series_dates_idx` ON `session_series` (`starts_on`,`ends_on`);
--> statement-breakpoint
CREATE TABLE `session_recurrence_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `session_series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_recurrence_series_weekday_idx` ON `session_recurrence_rules` (`series_id`,`weekday`);
--> statement-breakpoint
CREATE INDEX `session_recurrence_series_idx` ON `session_recurrence_rules` (`series_id`);
--> statement-breakpoint
CREATE TABLE `session_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`occurrence_date` text NOT NULL,
	`starts_at` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`venue` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`replacement_for_occurrence_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `session_series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`replacement_for_occurrence_id`) REFERENCES `session_occurrences`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_occurrences_series_date_idx` ON `session_occurrences` (`series_id`,`occurrence_date`);
--> statement-breakpoint
CREATE INDEX `session_occurrences_date_idx` ON `session_occurrences` (`occurrence_date`);
--> statement-breakpoint
CREATE INDEX `session_occurrences_series_idx` ON `session_occurrences` (`series_id`);
--> statement-breakpoint
CREATE TABLE `session_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`series_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`assigned_by_account_id` text NOT NULL,
	`assigned_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `session_series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_assignments_account_idx` ON `session_assignments` (`account_id`);
--> statement-breakpoint
CREATE INDEX `session_assignments_series_idx` ON `session_assignments` (`series_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_assignments_one_primary_idx` ON `session_assignments` (`account_id`) WHERE `effective_to` is null;
--> statement-breakpoint
CREATE TABLE `session_attendance_records` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`occurrence_id` text NOT NULL,
	`choice` text NOT NULL,
	`marked_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`occurrence_id`) REFERENCES `session_occurrences`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`marked_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_attendance_account_occurrence_idx` ON `session_attendance_records` (`account_id`,`occurrence_id`);
--> statement-breakpoint
CREATE INDEX `session_attendance_occurrence_idx` ON `session_attendance_records` (`occurrence_id`);
--> statement-breakpoint
UPDATE `player_enrollments` SET `status` = 'unassigned' WHERE `status` = 'active';
