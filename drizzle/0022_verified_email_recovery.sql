CREATE TABLE `auth_email_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`subject_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`email` text NOT NULL,
	`secret_hash` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`verified_at` integer,
	`claimed_at` integer,
	`second_factor_verified_at` integer,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auth_email_challenges_purpose_check" CHECK("auth_email_challenges"."purpose" in ('verify_email', 'password_reset'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_email_challenges_secret_idx` ON `auth_email_challenges` (`secret_hash`);--> statement-breakpoint
CREATE INDEX `auth_email_challenges_account_purpose_idx` ON `auth_email_challenges` (`account_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `auth_email_challenges_subject_purpose_idx` ON `auth_email_challenges` (`subject_hash`,`purpose`);--> statement-breakpoint
CREATE INDEX `auth_email_challenges_expiry_idx` ON `auth_email_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_recovery_emails` (
	`account_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`verified_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_recovery_emails_email_idx` ON `auth_recovery_emails` (`email`);--> statement-breakpoint
CREATE INDEX `auth_recovery_emails_verified_idx` ON `auth_recovery_emails` (`verified_at`);--> statement-breakpoint
UPDATE `auth_access_codes`
SET `consumed_at` = unixepoch('subsec') * 1000
WHERE `purpose` = 'password_reset' AND `consumed_at` IS NULL;
