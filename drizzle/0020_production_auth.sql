CREATE TABLE `auth_access_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`purpose` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_by_account_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auth_access_codes_purpose_check" CHECK("auth_access_codes"."purpose" in ('activation', 'password_reset'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_access_codes_hash_idx` ON `auth_access_codes` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_access_codes_one_active_idx` ON `auth_access_codes` (`account_id`,`purpose`) WHERE "auth_access_codes"."consumed_at" is null;--> statement-breakpoint
CREATE INDEX `auth_access_codes_account_idx` ON `auth_access_codes` (`account_id`);--> statement-breakpoint
CREATE INDEX `auth_access_codes_expiry_idx` ON `auth_access_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_credential_states` (
	`account_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`activated_at` integer,
	`password_changed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auth_credential_states_status_check" CHECK("auth_credential_states"."status" in ('pending', 'active', 'reset_required', 'revoked'))
);
--> statement-breakpoint
CREATE INDEX `auth_credential_states_status_idx` ON `auth_credential_states` (`status`);--> statement-breakpoint
CREATE TABLE `auth_login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`window_started_at` integer NOT NULL,
	`blocked_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_login_attempts_blocked_idx` ON `auth_login_attempts` (`blocked_until`);--> statement-breakpoint
CREATE TABLE `auth_provider_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
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
CREATE UNIQUE INDEX `auth_provider_accounts_provider_account_idx` ON `auth_provider_accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `auth_provider_accounts_user_idx` ON `auth_provider_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_runtime_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_runtime_sessions_token_idx` ON `auth_runtime_sessions` (`token`);--> statement-breakpoint
CREATE INDEX `auth_runtime_sessions_user_idx` ON `auth_runtime_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_runtime_sessions_expiry_idx` ON `auth_runtime_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`actor_account_id` text,
	`event_type` text NOT NULL,
	`outcome` text NOT NULL,
	`subject_hash` text,
	`ip_hash` text,
	`user_agent` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_security_events_account_idx` ON `auth_security_events` (`account_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `auth_security_events_type_idx` ON `auth_security_events` (`event_type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `auth_security_events_occurred_idx` ON `auth_security_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `auth_two_factors` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`failed_verification_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_two_factors_user_idx` ON `auth_two_factors` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_two_factors_secret_idx` ON `auth_two_factors` (`secret`);--> statement-breakpoint
CREATE TABLE `auth_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT true NOT NULL,
	`image` text,
	`username` text,
	`display_username` text,
	`two_factor_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_email_idx` ON `auth_users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_username_idx` ON `auth_users` (`username`);--> statement-breakpoint
CREATE TABLE `auth_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_verifications_identifier_idx` ON `auth_verifications` (`identifier`);--> statement-breakpoint
CREATE INDEX `auth_verifications_expiry_idx` ON `auth_verifications` (`expires_at`);