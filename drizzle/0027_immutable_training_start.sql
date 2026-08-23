PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_player_enrollments` (
	`account_id` text PRIMARY KEY NOT NULL,
	`age_group` text,
	`level` text,
	`batch` text,
	`academy_plan` text,
	`status` text DEFAULT 'unassigned' NOT NULL,
	`training_start_on` text NOT NULL,
	`training_start_confirmed_at` integer,
	`training_start_confirmed_by_account_id` text,
	`onboarding_completed_at` integer,
	`onboarding_completed_by_account_id` text,
	`primary_contact_name` text,
	`primary_contact_relationship` text,
	`primary_contact_phone` text,
	`record_revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`training_start_confirmed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`onboarding_completed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `player_enrollments_training_start_on_check` CHECK (`training_start_on` glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date(`training_start_on`) = `training_start_on`)
);--> statement-breakpoint
INSERT INTO `__new_player_enrollments` (
	`account_id`,
	`age_group`,
	`level`,
	`batch`,
	`academy_plan`,
	`status`,
	`training_start_on`,
	`training_start_confirmed_at`,
	`training_start_confirmed_by_account_id`,
	`onboarding_completed_at`,
	`onboarding_completed_by_account_id`,
	`primary_contact_name`,
	`primary_contact_relationship`,
	`primary_contact_phone`,
	`record_revision`,
	`updated_at`
)
SELECT
	`enrollment`.`account_id`,
	`enrollment`.`age_group`,
	`enrollment`.`level`,
	`enrollment`.`batch`,
	`enrollment`.`academy_plan`,
	`enrollment`.`status`,
	date(`enrollment`.`joined_at` / 1000, 'unixepoch', '+5 hours', '+30 minutes'),
	COALESCE(`account`.`approved_at`, `enrollment`.`updated_at`, `account`.`created_at`),
	`account`.`approved_by_account_id`,
	CASE WHEN EXISTS (
		SELECT 1
		FROM `session_assignments` AS `assignment`
		INNER JOIN `session_series` AS `series`
			ON `series`.`id` = `assignment`.`series_id`
		INNER JOIN `fee_agreements` AS `agreement`
			ON `agreement`.`player_account_id` = `enrollment`.`account_id`
			AND `agreement`.`level` = `series`.`programme`
			AND `agreement`.`batch` = `series`.`batch`
			AND `agreement`.`academy_plan` = `enrollment`.`academy_plan`
		WHERE `assignment`.`account_id` = `enrollment`.`account_id`
			AND (`assignment`.`effective_to` IS NULL OR `agreement`.`effective_from` <= `assignment`.`effective_to`)
			AND (`series`.`ends_on` IS NULL OR `agreement`.`effective_from` <= `series`.`ends_on`)
			AND (`agreement`.`effective_to` IS NULL OR max(`assignment`.`effective_from`, `series`.`starts_on`) <= `agreement`.`effective_to`)
	) THEN (
		SELECT min(`agreement`.`created_at`)
		FROM `fee_agreements` AS `agreement`
		WHERE `agreement`.`player_account_id` = `enrollment`.`account_id`
	) ELSE NULL END,
	CASE WHEN EXISTS (
		SELECT 1
		FROM `session_assignments` AS `assignment`
		INNER JOIN `session_series` AS `series`
			ON `series`.`id` = `assignment`.`series_id`
		INNER JOIN `fee_agreements` AS `agreement`
			ON `agreement`.`player_account_id` = `enrollment`.`account_id`
			AND `agreement`.`level` = `series`.`programme`
			AND `agreement`.`batch` = `series`.`batch`
			AND `agreement`.`academy_plan` = `enrollment`.`academy_plan`
		WHERE `assignment`.`account_id` = `enrollment`.`account_id`
			AND (`assignment`.`effective_to` IS NULL OR `agreement`.`effective_from` <= `assignment`.`effective_to`)
			AND (`series`.`ends_on` IS NULL OR `agreement`.`effective_from` <= `series`.`ends_on`)
			AND (`agreement`.`effective_to` IS NULL OR max(`assignment`.`effective_from`, `series`.`starts_on`) <= `agreement`.`effective_to`)
	) THEN (
		SELECT `agreement`.`created_by_account_id`
		FROM `fee_agreements` AS `agreement`
		WHERE `agreement`.`player_account_id` = `enrollment`.`account_id`
		ORDER BY `agreement`.`created_at`, `agreement`.`id`
		LIMIT 1
	) ELSE NULL END,
	`enrollment`.`primary_contact_name`,
	`enrollment`.`primary_contact_relationship`,
	`enrollment`.`primary_contact_phone`,
	`enrollment`.`record_revision`,
	`enrollment`.`updated_at`
FROM `player_enrollments` AS `enrollment`
INNER JOIN `accounts` AS `account` ON `account`.`id` = `enrollment`.`account_id`;--> statement-breakpoint
DROP TABLE `player_enrollments`;--> statement-breakpoint
ALTER TABLE `__new_player_enrollments` RENAME TO `player_enrollments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
