CREATE TABLE `operational_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`fingerprint` text NOT NULL,
	`route_path` text NOT NULL,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operational_events_type_occurred_idx` ON `operational_events` (`event_type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `operational_events_fingerprint_idx` ON `operational_events` (`fingerprint`,`occurred_at`);