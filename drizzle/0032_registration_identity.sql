ALTER TABLE `accounts` ADD `registration_identity_key` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `contact_email` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `contact_phone` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `date_of_birth` text;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_registration_identity_key_idx` ON `accounts` (`registration_identity_key`) WHERE "accounts"."registration_identity_key" is not null;