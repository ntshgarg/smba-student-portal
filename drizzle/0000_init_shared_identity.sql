CREATE TABLE `academy_id_allocations` (
	`serial` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academy_id_allocations_account_idx` ON `academy_id_allocations` (`account_id`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`requested_role` text NOT NULL,
	`role` text,
	`approval_status` text DEFAULT 'pending' NOT NULL,
	`approved_at` integer,
	`approved_by_account_id` text,
	`rejected_at` integer,
	`rejected_by_account_id` text,
	`archived_at` integer,
	`archived_by_account_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`approved_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rejected_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`archived_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `accounts_approval_status_idx` ON `accounts` (`approval_status`);--> statement-breakpoint
CREATE INDEX `accounts_role_idx` ON `accounts` (`role`);--> statement-breakpoint
CREATE INDEX `accounts_normalized_name_idx` ON `accounts` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `attendance_records` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`date_key` text NOT NULL,
	`choice` text NOT NULL,
	`marked_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`marked_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_account_batch_date_idx` ON `attendance_records` (`account_id`,`batch_id`,`date_key`);--> statement-breakpoint
CREATE INDEX `attendance_date_idx` ON `attendance_records` (`date_key`);--> statement-breakpoint
CREATE TABLE `auth_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`method` text NOT NULL,
	`identifier` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_methods_identifier_idx` ON `auth_methods` (`identifier`);--> statement-breakpoint
CREATE INDEX `auth_methods_account_idx` ON `auth_methods` (`account_id`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_account_idx` ON `auth_sessions` (`account_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `batch_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `batch_memberships_account_idx` ON `batch_memberships` (`account_id`);--> statement-breakpoint
CREATE INDEX `batch_memberships_batch_idx` ON `batch_memberships` (`batch_id`);--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule` text NOT NULL,
	`programme` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monthly_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`month` text NOT NULL,
	`draft_text` text DEFAULT '' NOT NULL,
	`updated_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_reports_account_month_idx` ON `monthly_reports` (`account_id`,`month`);--> statement-breakpoint
CREATE TABLE `player_enrollments` (
	`account_id` text PRIMARY KEY NOT NULL,
	`age_group` text,
	`level` text,
	`status` text DEFAULT 'unassigned' NOT NULL,
	`joined_at` integer NOT NULL,
	`primary_contact_name` text,
	`primary_contact_relationship` text,
	`primary_contact_phone` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `report_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`revision` integer NOT NULL,
	`report_text` text NOT NULL,
	`published_by_account_id` text NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `monthly_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_publications_report_revision_idx` ON `report_publications` (`report_id`,`revision`);--> statement-breakpoint
CREATE INDEX `report_publications_report_idx` ON `report_publications` (`report_id`);