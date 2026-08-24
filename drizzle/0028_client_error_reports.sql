CREATE TABLE `client_error_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`boundary` text NOT NULL,
	`fingerprint` text NOT NULL,
	`route_path` text NOT NULL,
	`error_name` text NOT NULL,
	`digest` text,
	`account_id` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "client_error_reports_event_type_check" CHECK("client_error_reports"."event_type" in ('client_error', 'unhandled_rejection')),
	CONSTRAINT "client_error_reports_boundary_check" CHECK("client_error_reports"."boundary" in ('root', 'global', 'student', 'coach', 'coach_financials', 'player_financials', 'window'))
);
--> statement-breakpoint
CREATE INDEX `client_error_reports_type_occurred_idx` ON `client_error_reports` (`event_type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `client_error_reports_fingerprint_idx` ON `client_error_reports` (`fingerprint`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `client_error_reports_occurred_idx` ON `client_error_reports` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `client_error_reports_account_idx` ON `client_error_reports` (`account_id`);