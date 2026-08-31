CREATE TABLE `academy_holidays` (
	`id` text PRIMARY KEY NOT NULL,
	`date_key` text NOT NULL,
	`label` text NOT NULL,
	`declared_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`declared_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academy_holidays_date_idx` ON `academy_holidays` (`date_key`);--> statement-breakpoint
ALTER TABLE `session_occurrences` ADD `holiday_id` text REFERENCES academy_holidays(id);--> statement-breakpoint
CREATE INDEX `session_occurrences_holiday_idx` ON `session_occurrences` (`holiday_id`);