DROP INDEX `auth_provider_accounts_issuer_account_idx`;--> statement-breakpoint
ALTER TABLE `auth_provider_accounts` DROP COLUMN `issuer`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_auth_rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_auth_rate_limits`("id", "key", "count", "last_request") SELECT "key", "key", "count", "last_request" FROM `auth_rate_limits`;--> statement-breakpoint
DROP TABLE `auth_rate_limits`;--> statement-breakpoint
ALTER TABLE `__new_auth_rate_limits` RENAME TO `auth_rate_limits`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `auth_rate_limits_key_idx` ON `auth_rate_limits` (`key`);