UPDATE `player_enrollments`
SET
	`level` = (
		SELECT `batches`.`programme`
		FROM `batch_memberships`
		INNER JOIN `batches` ON `batches`.`id` = `batch_memberships`.`batch_id`
		WHERE `batch_memberships`.`account_id` = `player_enrollments`.`account_id`
			AND `batch_memberships`.`ended_at` IS NULL
		LIMIT 1
	),
	`updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE EXISTS (
	SELECT 1
	FROM `batch_memberships`
	INNER JOIN `batches` ON `batches`.`id` = `batch_memberships`.`batch_id`
	WHERE `batch_memberships`.`account_id` = `player_enrollments`.`account_id`
		AND `batch_memberships`.`ended_at` IS NULL
		AND (
			`player_enrollments`.`level` IS NULL
			OR `player_enrollments`.`level` <> `batches`.`programme`
		)
);
