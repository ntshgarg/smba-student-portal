DROP TABLE IF EXISTS `__attendance_adjustment_backfill_candidates`;--> statement-breakpoint
CREATE TABLE `__attendance_adjustment_backfill_candidates` (
	`adjustment_id` text PRIMARY KEY NOT NULL,
	`player_account_id` text NOT NULL,
	`completion_occurrence_id` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__attendance_adjustment_backfill_candidates` (
	`adjustment_id`,
	`player_account_id`,
	`completion_occurrence_id`
)
SELECT
	`current`.`id`,
	`current`.`player_account_id`,
	MIN(`occurrence`.`id`)
FROM `attendance_adjustments` AS `current`
INNER JOIN `session_attendance_records` AS `attendance`
	ON `attendance`.`account_id` = `current`.`player_account_id`
	AND `attendance`.`choice` = 'present'
INNER JOIN `session_occurrences` AS `occurrence`
	ON `occurrence`.`id` = `attendance`.`occurrence_id`
	AND `occurrence`.`status` = 'scheduled'
	AND `occurrence`.`occurrence_date` = `current`.`completed_on`
WHERE `current`.`completion_occurrence_id` IS NULL
	AND `current`.`voided_at` IS NULL
GROUP BY `current`.`id`, `current`.`player_account_id`
HAVING COUNT(*) = 1;--> statement-breakpoint
DELETE FROM `__attendance_adjustment_backfill_candidates` AS `candidate`
WHERE EXISTS (
	SELECT 1
	FROM `attendance_adjustments` AS `used`
	WHERE `used`.`player_account_id` = `candidate`.`player_account_id`
		AND `used`.`completion_occurrence_id` = `candidate`.`completion_occurrence_id`
		AND `used`.`voided_at` IS NULL
);--> statement-breakpoint
DELETE FROM `__attendance_adjustment_backfill_candidates` AS `candidate`
WHERE EXISTS (
	SELECT 1
	FROM `__attendance_adjustment_backfill_candidates` AS `earlier_candidate`
	INNER JOIN `attendance_adjustments` AS `earlier`
		ON `earlier`.`id` = `earlier_candidate`.`adjustment_id`
	INNER JOIN `attendance_adjustments` AS `current`
		ON `current`.`id` = `candidate`.`adjustment_id`
	WHERE `earlier_candidate`.`player_account_id` = `candidate`.`player_account_id`
		AND `earlier_candidate`.`completion_occurrence_id` = `candidate`.`completion_occurrence_id`
		AND (
			`earlier`.`published_at` < `current`.`published_at`
			OR (
				`earlier`.`published_at` = `current`.`published_at`
				AND `earlier`.`id` < `current`.`id`
			)
		)
);--> statement-breakpoint
UPDATE `attendance_adjustments` AS `current`
SET `completion_occurrence_id` = (
	SELECT `candidate`.`completion_occurrence_id`
	FROM `__attendance_adjustment_backfill_candidates` AS `candidate`
	WHERE `candidate`.`adjustment_id` = `current`.`id`
)
WHERE `current`.`completion_occurrence_id` IS NULL
	AND `current`.`voided_at` IS NULL
	AND EXISTS (
		SELECT 1
		FROM `__attendance_adjustment_backfill_candidates` AS `candidate`
		WHERE `candidate`.`adjustment_id` = `current`.`id`
	);--> statement-breakpoint
DROP TABLE `__attendance_adjustment_backfill_candidates`;--> statement-breakpoint
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
	);
