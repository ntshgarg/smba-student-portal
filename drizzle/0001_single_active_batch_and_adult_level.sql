WITH `ranked_current_memberships` AS (
	SELECT
		`id`,
		ROW_NUMBER() OVER (
			PARTITION BY `account_id`
			ORDER BY `started_at` ASC, `batch_id` ASC, `id` ASC
		) AS `membership_position`
	FROM `batch_memberships`
	WHERE `ended_at` IS NULL
)
UPDATE `batch_memberships`
SET `ended_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE `id` IN (
	SELECT `id`
	FROM `ranked_current_memberships`
	WHERE `membership_position` > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `batch_memberships_one_current_per_account_idx` ON `batch_memberships` (`account_id`) WHERE "batch_memberships"."ended_at" is null;
