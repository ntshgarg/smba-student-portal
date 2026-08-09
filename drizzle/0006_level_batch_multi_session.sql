DELETE FROM `session_attendance_records`;
--> statement-breakpoint
DELETE FROM `session_assignments`;
--> statement-breakpoint
DELETE FROM `session_occurrences`;
--> statement-breakpoint
DELETE FROM `session_recurrence_rules`;
--> statement-breakpoint
DELETE FROM `session_series`;
--> statement-breakpoint
ALTER TABLE `player_enrollments` ADD `batch` text;
--> statement-breakpoint
UPDATE `player_enrollments`
SET `batch` = (
  SELECT `batches`.`schedule`
  FROM `batch_memberships`
  INNER JOIN `batches` ON `batches`.`id` = `batch_memberships`.`batch_id`
  WHERE `batch_memberships`.`account_id` = `player_enrollments`.`account_id`
    AND `batch_memberships`.`ended_at` IS NULL
  LIMIT 1
);
--> statement-breakpoint
ALTER TABLE `session_series` ADD `batch` text NOT NULL DEFAULT 'Weekday';
--> statement-breakpoint
DROP INDEX `session_assignments_one_primary_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `session_assignments_one_series_idx` ON `session_assignments` (`account_id`,`series_id`) WHERE `effective_to` is null;
--> statement-breakpoint
UPDATE `player_enrollments` SET `status` = 'unassigned' WHERE `status` = 'active';
