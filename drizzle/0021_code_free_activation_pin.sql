CREATE TABLE `auth_activation_claims` (
	`account_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_activation_claims_token_idx` ON `auth_activation_claims` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_activation_claims_expiry_idx` ON `auth_activation_claims` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_pin_credentials` (
	`account_id` text PRIMARY KEY NOT NULL,
	`pin_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_pin_credentials_updated_idx` ON `auth_pin_credentials` (`updated_at`);