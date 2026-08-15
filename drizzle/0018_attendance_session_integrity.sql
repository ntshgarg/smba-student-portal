UPDATE `session_attendance_records`
SET `choice` = 'cleared'
WHERE `choice` NOT IN ('present', 'absent', 'cleared');--> statement-breakpoint
UPDATE `attendance_adjustments` AS `current`
SET `completion_occurrence_id` = (
	SELECT `occurrence`.`id`
	FROM `session_attendance_records` AS `attendance`
	INNER JOIN `session_occurrences` AS `occurrence`
		ON `occurrence`.`id` = `attendance`.`occurrence_id`
	WHERE `attendance`.`account_id` = `current`.`player_account_id`
		AND `attendance`.`choice` = 'present'
		AND `occurrence`.`status` = 'scheduled'
		AND `occurrence`.`occurrence_date` = `current`.`completed_on`
	ORDER BY `occurrence`.`starts_at`, `occurrence`.`id`
	LIMIT 1
)
WHERE `current`.`completion_occurrence_id` IS NULL
	AND `current`.`voided_at` IS NULL
	AND (
		SELECT COUNT(*)
		FROM `session_attendance_records` AS `attendance`
		INNER JOIN `session_occurrences` AS `occurrence`
			ON `occurrence`.`id` = `attendance`.`occurrence_id`
		WHERE `attendance`.`account_id` = `current`.`player_account_id`
			AND `attendance`.`choice` = 'present'
			AND `occurrence`.`status` = 'scheduled'
			AND `occurrence`.`occurrence_date` = `current`.`completed_on`
	) = 1;--> statement-breakpoint
UPDATE `attendance_adjustments`
SET `review_required_at` = COALESCE(`review_required_at`, `published_at`)
WHERE `completion_occurrence_id` IS NULL
	AND `voided_at` IS NULL;--> statement-breakpoint
UPDATE `attendance_adjustments` AS `current`
SET `review_required_at` = COALESCE(`current`.`review_required_at`, `current`.`published_at`)
WHERE `current`.`completion_occurrence_id` IS NOT NULL
	AND `current`.`voided_at` IS NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `session_attendance_records` AS `attendance`
		INNER JOIN `session_occurrences` AS `occurrence`
			ON `occurrence`.`id` = `attendance`.`occurrence_id`
		WHERE `attendance`.`account_id` = `current`.`player_account_id`
			AND `attendance`.`occurrence_id` = `current`.`completion_occurrence_id`
			AND `attendance`.`choice` = 'present'
			AND `occurrence`.`status` = 'scheduled'
			AND `occurrence`.`occurrence_date` = `current`.`completed_on`
	);--> statement-breakpoint
UPDATE `attendance_adjustments` AS `current`
SET
	`voided_by_account_id` = `current`.`published_by_account_id`,
	`voided_at` = `current`.`published_at`
WHERE `current`.`completion_occurrence_id` IS NOT NULL
	AND `current`.`voided_at` IS NULL
	AND EXISTS (
		SELECT 1
		FROM `attendance_adjustments` AS `earlier`
		WHERE `earlier`.`player_account_id` = `current`.`player_account_id`
			AND `earlier`.`completion_occurrence_id` = `current`.`completion_occurrence_id`
			AND `earlier`.`voided_at` IS NULL
			AND (
				`earlier`.`published_at` < `current`.`published_at`
				OR (
					`earlier`.`published_at` = `current`.`published_at`
					AND `earlier`.`id` < `current`.`id`
				)
			)
	);--> statement-breakpoint
UPDATE `session_occurrences` AS `current`
SET `status` = 'cancelled'
WHERE `current`.`replacement_for_occurrence_id` IS NOT NULL
	AND `current`.`status` = 'scheduled'
	AND EXISTS (
		SELECT 1
		FROM `session_occurrences` AS `earlier`
		WHERE `earlier`.`replacement_for_occurrence_id` = `current`.`replacement_for_occurrence_id`
			AND `earlier`.`status` = 'scheduled'
			AND (
				`earlier`.`created_at` < `current`.`created_at`
				OR (
					`earlier`.`created_at` = `current`.`created_at`
					AND `earlier`.`id` < `current`.`id`
				)
			)
	);--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_adjustments_active_completion_idx` ON `attendance_adjustments` (`player_account_id`,`completion_occurrence_id`) WHERE "attendance_adjustments"."voided_at" is null and "attendance_adjustments"."completion_occurrence_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `session_occurrences_active_replacement_idx` ON `session_occurrences` (`replacement_for_occurrence_id`) WHERE "session_occurrences"."replacement_for_occurrence_id" is not null and "session_occurrences"."status" = 'scheduled';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_attendance_records` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`occurrence_id` text NOT NULL,
	`choice` text NOT NULL,
	`marked_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`occurrence_id`) REFERENCES `session_occurrences`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`marked_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "session_attendance_choice_check" CHECK("__new_session_attendance_records"."choice" in ('present', 'absent', 'cleared'))
);
--> statement-breakpoint
INSERT INTO `__new_session_attendance_records`("id", "account_id", "occurrence_id", "choice", "marked_by_account_id", "created_at", "updated_at") SELECT "id", "account_id", "occurrence_id", "choice", "marked_by_account_id", "created_at", "updated_at" FROM `session_attendance_records`;--> statement-breakpoint
DROP TABLE `session_attendance_records`;--> statement-breakpoint
ALTER TABLE `__new_session_attendance_records` RENAME TO `session_attendance_records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `session_attendance_account_occurrence_idx` ON `session_attendance_records` (`account_id`,`occurrence_id`);--> statement-breakpoint
CREATE INDEX `session_attendance_occurrence_idx` ON `session_attendance_records` (`occurrence_id`);
