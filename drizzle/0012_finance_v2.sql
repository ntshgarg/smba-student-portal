CREATE TABLE `concession_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`concession_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`charge_adjustment_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`applied_on` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_fingerprint` text NOT NULL,
	`created_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`reversed_by_account_id` text,
	`reversed_at` integer,
	`reversal_reason` text,
	FOREIGN KEY (`concession_id`) REFERENCES `concessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`charge_id`) REFERENCES `financial_charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`charge_adjustment_id`) REFERENCES `charge_adjustments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "concession_applications_amount_positive_check" CHECK("concession_applications"."amount_paise" > 0),
	CONSTRAINT "concession_applications_reversal_check" CHECK(("concession_applications"."reversed_at" is null and "concession_applications"."reversed_by_account_id" is null and "concession_applications"."reversal_reason" is null)
      or ("concession_applications"."reversed_at" is not null and "concession_applications"."reversed_by_account_id" is not null and length(trim("concession_applications"."reversal_reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concession_applications_idempotency_idx` ON `concession_applications` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `concession_applications_adjustment_idx` ON `concession_applications` (`charge_adjustment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `concession_applications_active_charge_idx` ON `concession_applications` (`concession_id`,`charge_id`) WHERE "concession_applications"."reversed_at" is null;--> statement-breakpoint
CREATE INDEX `concession_applications_charge_idx` ON `concession_applications` (`charge_id`);--> statement-breakpoint
CREATE TABLE `concessions` (
	`id` text PRIMARY KEY NOT NULL,
	`player_account_id` text NOT NULL,
	`mode` text NOT NULL,
	`value_kind` text NOT NULL,
	`value` integer NOT NULL,
	`starts_period` text,
	`ends_period` text,
	`reason` text NOT NULL,
	`lifecycle` text DEFAULT 'active' NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_fingerprint` text NOT NULL,
	`record_revision` integer DEFAULT 0 NOT NULL,
	`created_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`reversed_by_account_id` text,
	`reversed_at` integer,
	`reversal_reason` text,
	FOREIGN KEY (`player_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "concessions_value_positive_check" CHECK("concessions"."value" > 0),
	CONSTRAINT "concessions_value_kind_check" CHECK("concessions"."value_kind" = 'fixed' or ("concessions"."value_kind" = 'percentage' and "concessions"."value" <= 10000)),
	CONSTRAINT "concessions_period_check" CHECK(("concessions"."mode" = 'one_off' and "concessions"."starts_period" is null and "concessions"."ends_period" is null)
      or ("concessions"."mode" = 'recurring' and "concessions"."starts_period" is not null
        and ("concessions"."ends_period" is null or "concessions"."ends_period" >= "concessions"."starts_period"))),
	CONSTRAINT "concessions_reversal_check" CHECK(("concessions"."lifecycle" = 'active' and "concessions"."reversed_at" is null and "concessions"."reversed_by_account_id" is null and "concessions"."reversal_reason" is null)
      or ("concessions"."lifecycle" = 'reversed' and "concessions"."reversed_at" is not null and "concessions"."reversed_by_account_id" is not null and length(trim("concessions"."reversal_reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concessions_idempotency_key_idx` ON `concessions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `concessions_player_period_idx` ON `concessions` (`player_account_id`,`starts_period`,`ends_period`);--> statement-breakpoint
CREATE TABLE `finance_reference_sequences` (
	`kind` text NOT NULL,
	`year` integer NOT NULL,
	`last_value` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `year`),
	CONSTRAINT "finance_reference_sequences_year_check" CHECK("finance_reference_sequences"."year" between 2000 and 9999),
	CONSTRAINT "finance_reference_sequences_value_check" CHECK("finance_reference_sequences"."last_value" > 0)
);
--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`created_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`charge_id`) REFERENCES `financial_charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_allocations_amount_positive_check" CHECK("payment_allocations"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_allocations_payment_charge_idx` ON `payment_allocations` (`payment_id`,`charge_id`);--> statement-breakpoint
CREATE INDEX `payment_allocations_charge_idx` ON `payment_allocations` (`charge_id`);--> statement-breakpoint
CREATE TABLE `refund_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`refund_id` text NOT NULL,
	`payment_allocation_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_allocation_id`) REFERENCES `payment_allocations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "refund_allocations_amount_positive_check" CHECK("refund_allocations"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refund_allocations_refund_payment_allocation_idx` ON `refund_allocations` (`refund_id`,`payment_allocation_id`);--> statement-breakpoint
CREATE INDEX `refund_allocations_payment_allocation_idx` ON `refund_allocations` (`payment_allocation_id`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`refund_reference` text NOT NULL,
	`payment_id` text NOT NULL,
	`player_account_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`refunded_on` text NOT NULL,
	`method` text NOT NULL,
	`external_reference` text,
	`internal_note` text,
	`lifecycle` text DEFAULT 'recorded' NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_fingerprint` text NOT NULL,
	`record_revision` integer DEFAULT 0 NOT NULL,
	`recorded_by_account_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`reversed_by_account_id` text,
	`reversed_at` integer,
	`reversal_reason` text,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "refunds_amount_positive_check" CHECK("refunds"."amount_paise" > 0),
	CONSTRAINT "refunds_currency_check" CHECK("refunds"."currency" = 'INR'),
	CONSTRAINT "refunds_reversal_check" CHECK(("refunds"."lifecycle" = 'recorded' and "refunds"."reversed_at" is null and "refunds"."reversed_by_account_id" is null and "refunds"."reversal_reason" is null)
      or ("refunds"."lifecycle" = 'reversed' and "refunds"."reversed_at" is not null and "refunds"."reversed_by_account_id" is not null and length(trim("refunds"."reversal_reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_reference_idx` ON `refunds` (`refund_reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_idempotency_key_idx` ON `refunds` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `refunds_payment_idx` ON `refunds` (`payment_id`);--> statement-breakpoint
CREATE INDEX `refunds_player_date_idx` ON `refunds` (`player_account_id`,`refunded_on`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text,
	`player_account_id` text NOT NULL,
	`receipt_reference` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`received_on` text NOT NULL,
	`method` text NOT NULL,
	`external_reference` text,
	`internal_note` text,
	`lifecycle` text DEFAULT 'recorded' NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_fingerprint` text NOT NULL,
	`record_revision` integer DEFAULT 0 NOT NULL,
	`recorded_by_account_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`reversed_by_account_id` text,
	`reversed_at` integer,
	`reversal_reason` text,
	FOREIGN KEY (`charge_id`) REFERENCES `financial_charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_amount_positive_check" CHECK("amount_paise" > 0),
	CONSTRAINT "payments_currency_check" CHECK("currency" = 'INR'),
	CONSTRAINT "payments_reversal_check" CHECK(("lifecycle" = 'recorded' and "reversed_at" is null and "reversed_by_account_id" is null and "reversal_reason" is null)
      or ("lifecycle" = 'reversed' and "reversed_at" is not null and "reversed_by_account_id" is not null and length(trim("reversal_reason")) > 0))
);
--> statement-breakpoint
INSERT INTO `__new_payments`("id", "charge_id", "player_account_id", "receipt_reference", "amount_paise", "currency", "received_on", "method", "external_reference", "internal_note", "lifecycle", "idempotency_key", "payload_fingerprint", "record_revision", "recorded_by_account_id", "recorded_at", "reversed_by_account_id", "reversed_at", "reversal_reason")
SELECT "id", "charge_id", "player_account_id",
  'SMBA-R-' || substr("received_on", 1, 4) || '-' || printf('%05d',
    row_number() over (
      partition by substr("received_on", 1, 4)
      order by "received_on", "recorded_at", "id"
    )
  ),
  "amount_paise", "currency", "received_on", "method", "external_reference", "internal_note",
  "lifecycle", "idempotency_key", 'phase1:' || "id", 0, "recorded_by_account_id", "recorded_at",
  "reversed_by_account_id", "reversed_at", "reversal_reason"
FROM `payments`;--> statement-breakpoint
DROP TABLE `payments`;--> statement-breakpoint
ALTER TABLE `__new_payments` RENAME TO `payments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_idempotency_key_idx` ON `payments` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_receipt_reference_idx` ON `payments` (`receipt_reference`);--> statement-breakpoint
CREATE INDEX `payments_charge_idx` ON `payments` (`charge_id`);--> statement-breakpoint
CREATE INDEX `payments_player_idx` ON `payments` (`player_account_id`);
--> statement-breakpoint
INSERT INTO `payment_allocations` (
  "id", "payment_id", "charge_id", "amount_paise", "created_by_account_id", "created_at"
)
SELECT 'phase1-allocation-' || "id", "id", "charge_id", "amount_paise",
  "recorded_by_account_id", "recorded_at"
FROM `payments`
WHERE "charge_id" is not null;
--> statement-breakpoint
INSERT INTO `finance_reference_sequences` ("kind", "year", "last_value", "updated_at")
SELECT 'receipt', cast(substr("received_on", 1, 4) as integer), count(*), max("recorded_at")
FROM `payments`
GROUP BY substr("received_on", 1, 4);
