CREATE TABLE `training_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`player_account_id` text NOT NULL,
	`kind` text NOT NULL,
	`effective_on` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`level` text,
	`batch` text,
	`academy_plan` text,
	`series_id` text,
	`weekdays` text DEFAULT '[]' NOT NULL,
	`monthly_fee_paise` integer,
	`stop_fees` integer DEFAULT false NOT NULL,
	`failure_reason` text,
	`created_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`player_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `session_series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "training_changes_kind_check" CHECK("training_changes"."kind" in ('change', 'end')),
	CONSTRAINT "training_changes_status_check" CHECK("training_changes"."status" in ('scheduled', 'applied', 'cancelled', 'failed')),
	CONSTRAINT "training_changes_effective_on_check" CHECK("training_changes"."effective_on" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-01' and date("training_changes"."effective_on") = "training_changes"."effective_on")
);
--> statement-breakpoint
CREATE INDEX `training_changes_due_idx` ON `training_changes` (`status`,`effective_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `training_changes_one_scheduled_idx` ON `training_changes` (`player_account_id`) WHERE "training_changes"."status" = 'scheduled';