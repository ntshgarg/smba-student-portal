CREATE TABLE `player_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`player_account_id` text NOT NULL,
	`assessed_on` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`ratings` text DEFAULT '{}' NOT NULL,
	`strengths` text DEFAULT '' NOT NULL,
	`improvements` text DEFAULT '' NOT NULL,
	`comments` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`published_at` integer,
	`published_by_account_id` text,
	`created_by_account_id` text NOT NULL,
	`updated_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`player_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "player_assessments_status_check" CHECK("player_assessments"."status" in ('draft', 'published')),
	CONSTRAINT "player_assessments_assessed_on_check" CHECK("player_assessments"."assessed_on" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date("player_assessments"."assessed_on") = "player_assessments"."assessed_on"),
	CONSTRAINT "player_assessments_published_check" CHECK(("player_assessments"."status" = 'published') = ("player_assessments"."published_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `player_assessments_player_date_idx` ON `player_assessments` (`player_account_id`,`assessed_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_assessments_one_draft_per_player_idx` ON `player_assessments` (`player_account_id`) WHERE "player_assessments"."status" = 'draft';