PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_auth_provider_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`issuer` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_auth_provider_accounts`("id", "account_id", "issuer", "provider_id", "user_id", "access_token", "refresh_token", "id_token", "access_token_expires_at", "refresh_token_expires_at", "scope", "password", "created_at", "updated_at")
SELECT "id", "account_id",
  CASE "provider_id" WHEN 'credential' THEN 'local:credential' END,
  "provider_id", "user_id", "access_token", "refresh_token", "id_token",
  "access_token_expires_at", "refresh_token_expires_at", "scope", "password",
  "created_at", "updated_at"
FROM `auth_provider_accounts`;--> statement-breakpoint
DROP TABLE `auth_provider_accounts`;--> statement-breakpoint
ALTER TABLE `__new_auth_provider_accounts` RENAME TO `auth_provider_accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `auth_provider_accounts_issuer_account_idx` ON `auth_provider_accounts` (`issuer`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_provider_accounts_provider_account_idx` ON `auth_provider_accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `auth_provider_accounts_user_idx` ON `auth_provider_accounts` (`user_id`);
