ALTER TABLE `player_enrollments` ADD `academy_plan` text;
--> statement-breakpoint
UPDATE `player_enrollments`
SET `academy_plan` = CASE
  WHEN `batch` = 'Weekend' THEN 'weekend-standard'
  WHEN `batch` = 'Weekday' AND `level` = 'Advanced' THEN 'weekday-5-day'
  ELSE NULL
END;
--> statement-breakpoint
CREATE TABLE `session_assignment_weekdays` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`weekday` integer NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `session_assignments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_assignment_weekdays_assignment_day_idx`
ON `session_assignment_weekdays` (`assignment_id`,`weekday`);
--> statement-breakpoint
CREATE INDEX `session_assignment_weekdays_assignment_idx`
ON `session_assignment_weekdays` (`assignment_id`);
--> statement-breakpoint
INSERT INTO `session_assignment_weekdays` (`id`, `assignment_id`, `weekday`)
SELECT
  `session_assignments`.`id` || ':' || `session_recurrence_rules`.`weekday`,
  `session_assignments`.`id`,
  `session_recurrence_rules`.`weekday`
FROM `session_assignments`
INNER JOIN `session_recurrence_rules`
  ON `session_recurrence_rules`.`series_id` = `session_assignments`.`series_id`;
