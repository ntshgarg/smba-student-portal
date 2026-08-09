ALTER TABLE `accounts` ADD `registration_request_fingerprint` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `registration_request_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_registration_request_key_idx` ON `accounts` (`registration_request_key`) WHERE "accounts"."registration_request_key" is not null;
