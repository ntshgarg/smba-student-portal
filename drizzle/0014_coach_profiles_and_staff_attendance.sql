CREATE TABLE `coach_profiles` (
	`account_id` text PRIMARY KEY NOT NULL,
	`access_level` text NOT NULL,
	`joined_on` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `coach_profiles_access_level_check` CHECK (`access_level` in ('head_admin', 'junior_coach')),
	CONSTRAINT `coach_profiles_joined_on_check` CHECK (`joined_on` glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date(`joined_on`) = `joined_on`)
);
--> statement-breakpoint
CREATE INDEX `coach_profiles_access_level_idx` ON `coach_profiles` (`access_level`);
--> statement-breakpoint
INSERT OR IGNORE INTO `coach_profiles` (
	`account_id`,
	`access_level`,
	`joined_on`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	'head_admin',
	date(coalesce(`approved_at`, `created_at`) / 1000, 'unixepoch', '+5 hours', '+30 minutes'),
	coalesce(`approved_at`, `created_at`),
	coalesce(`updated_at`, `approved_at`, `created_at`)
FROM `accounts`
WHERE `id` = '00000000-0000-4000-8000-000000000001'
	AND `role` = 'coach'
	AND `approval_status` = 'approved';
--> statement-breakpoint
CREATE TABLE `staff_attendance_records` (
	`id` text PRIMARY KEY NOT NULL,
	`coach_account_id` text NOT NULL,
	`date_key` text NOT NULL,
	`choice` text NOT NULL,
	`marked_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`coach_account_id`) REFERENCES `coach_profiles`(`account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`marked_by_account_id`) REFERENCES `coach_profiles`(`account_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `staff_attendance_choice_check` CHECK (`choice` in ('present', 'absent', 'cleared')),
	CONSTRAINT `staff_attendance_date_key_check` CHECK (`date_key` glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date(`date_key`) = `date_key`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_attendance_coach_date_idx` ON `staff_attendance_records` (`coach_account_id`,`date_key`);
--> statement-breakpoint
CREATE INDEX `staff_attendance_date_idx` ON `staff_attendance_records` (`date_key`);
