CREATE TABLE `auth_setup_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by_account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_at` integer,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auth_setup_claims_purpose_check" CHECK("auth_setup_claims"."purpose" = 'head_coach_setup')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_setup_claims_token_idx` ON `auth_setup_claims` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_setup_claims_one_active_idx` ON `auth_setup_claims` (`purpose`) WHERE "auth_setup_claims"."consumed_at" is null;--> statement-breakpoint
CREATE INDEX `auth_setup_claims_expiry_idx` ON `auth_setup_claims` (`expires_at`);