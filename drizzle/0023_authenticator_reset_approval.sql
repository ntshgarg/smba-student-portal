CREATE TABLE `auth_authenticator_reset_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`recovery_email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by_account_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auth_authenticator_reset_requests_status_check" CHECK("auth_authenticator_reset_requests"."status" in ('pending', 'approved', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_authenticator_reset_requests_pending_idx` ON `auth_authenticator_reset_requests` (`account_id`) WHERE "auth_authenticator_reset_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `auth_authenticator_reset_requests_status_idx` ON `auth_authenticator_reset_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `auth_authenticator_reset_requests_expiry_idx` ON `auth_authenticator_reset_requests` (`expires_at`);