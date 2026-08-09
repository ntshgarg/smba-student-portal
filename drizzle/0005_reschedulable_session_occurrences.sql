DROP INDEX `session_occurrences_series_date_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `session_occurrences_series_date_idx` ON `session_occurrences` (`series_id`,`occurrence_date`) WHERE `status` = 'scheduled';
