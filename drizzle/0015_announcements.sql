CREATE TABLE `broadcasts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`published_by_account_id` text NOT NULL,
	`published_at` integer NOT NULL,
	`expires_on` text,
	`publication_key` text NOT NULL,
	`payload_fingerprint` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`presentation_revision` integer DEFAULT 0 NOT NULL,
	`presentation_updated_by_account_id` text NOT NULL,
	`presentation_updated_at` integer NOT NULL,
	FOREIGN KEY (`published_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`presentation_updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `broadcasts_title_length_check` CHECK (length(trim(`title`)) between 1 and 120),
	CONSTRAINT `broadcasts_content_length_check` CHECK (length(trim(`content`)) between 1 and 5000),
	CONSTRAINT `broadcasts_expiry_check` CHECK (`expires_on` is null or (
		`expires_on` glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
		and date(`expires_on`) = `expires_on`
		and `expires_on` >= date(`published_at` / 1000, 'unixepoch', '+330 minutes')
	)),
	CONSTRAINT `broadcasts_presentation_revision_check` CHECK (`presentation_revision` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `broadcasts_publication_key_idx` ON `broadcasts` (`publication_key`);
--> statement-breakpoint
CREATE INDEX `broadcasts_published_at_idx` ON `broadcasts` (`published_at`);
--> statement-breakpoint
CREATE INDEX `broadcasts_expires_on_idx` ON `broadcasts` (`expires_on`);
--> statement-breakpoint
CREATE TABLE `broadcast_audience_targets` (
	`broadcast_id` text NOT NULL,
	`audience` text NOT NULL,
	PRIMARY KEY (`broadcast_id`, `audience`),
	FOREIGN KEY (`broadcast_id`) REFERENCES `broadcasts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `broadcast_audience_value_check` CHECK (`audience` = 'everyone')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `broadcast_audience_one_target_idx` ON `broadcast_audience_targets` (`broadcast_id`);
--> statement-breakpoint
CREATE TABLE `broadcast_channels` (
	`broadcast_id` text NOT NULL,
	`channel` text NOT NULL,
	PRIMARY KEY (`broadcast_id`, `channel`),
	FOREIGN KEY (`broadcast_id`) REFERENCES `broadcasts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `broadcast_channels_value_check` CHECK (`channel` in ('homepage', 'player_dashboard'))
);
--> statement-breakpoint
CREATE INDEX `broadcast_channels_channel_idx` ON `broadcast_channels` (`channel`,`broadcast_id`);
--> statement-breakpoint
CREATE TABLE `broadcast_withdrawals` (
	`id` text PRIMARY KEY NOT NULL,
	`broadcast_id` text NOT NULL,
	`reason` text NOT NULL,
	`withdrawn_by_account_id` text NOT NULL,
	`withdrawn_at` integer NOT NULL,
	FOREIGN KEY (`broadcast_id`) REFERENCES `broadcasts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`withdrawn_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `broadcast_withdrawals_reason_length_check` CHECK (length(trim(`reason`)) between 1 and 250)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `broadcast_withdrawals_broadcast_idx` ON `broadcast_withdrawals` (`broadcast_id`);
--> statement-breakpoint
CREATE INDEX `broadcast_withdrawals_withdrawn_at_idx` ON `broadcast_withdrawals` (`withdrawn_at`);
