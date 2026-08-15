ALTER TABLE `refunds` ADD `purpose` text DEFAULT 'legacy_unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE `refunds` ADD `withdrawal_effective_on` text;--> statement-breakpoint
ALTER TABLE `refunds` ADD `charge_adjustment_id` text REFERENCES charge_adjustments(id);--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_charge_adjustment_idx` ON `refunds` (`charge_adjustment_id`) WHERE "refunds"."charge_adjustment_id" is not null;