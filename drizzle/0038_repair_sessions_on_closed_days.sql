-- One-off repair: before new schedules and moved sessions were kept off days
-- the academy had already closed, a session could be left live on a holiday.
-- Each one is now cancelled by that day's holiday, exactly as marking the
-- holiday would have done had the session existed first, so removing the
-- holiday brings it back. A make-up completed on such a day is flagged for
-- review with the holiday's own timestamp, as marking the holiday does, so
-- removing the holiday clears the flag again. Running it twice changes nothing.
UPDATE `attendance_adjustments`
SET `review_required_at` = (
	SELECT `holiday`.`created_at`
	FROM `academy_holidays` AS `holiday`
	WHERE `holiday`.`date_key` = `attendance_adjustments`.`completed_on`
)
WHERE `voided_at` IS NULL
	AND `review_required_at` IS NULL
	AND `completed_on` IN (
		SELECT `occurrence`.`occurrence_date`
		FROM `session_occurrences` AS `occurrence`
		INNER JOIN `academy_holidays` AS `holiday`
			ON `holiday`.`date_key` = `occurrence`.`occurrence_date`
		WHERE `occurrence`.`status` = 'scheduled'
	);--> statement-breakpoint
UPDATE `session_occurrences`
SET `status` = 'cancelled',
	`holiday_id` = (
		SELECT `holiday`.`id`
		FROM `academy_holidays` AS `holiday`
		WHERE `holiday`.`date_key` = `session_occurrences`.`occurrence_date`
	)
WHERE `status` = 'scheduled'
	AND `occurrence_date` IN (SELECT `date_key` FROM `academy_holidays`);
