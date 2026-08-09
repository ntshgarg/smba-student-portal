CREATE TABLE `charge_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`reason` text NOT NULL,
	`created_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`reversed_by_account_id` text,
	`reversed_at` integer,
	`reversal_reason` text,
	FOREIGN KEY (`charge_id`) REFERENCES `financial_charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "charge_adjustments_amount_positive_check" CHECK("charge_adjustments"."amount_paise" > 0),
	CONSTRAINT "charge_adjustments_reason_check" CHECK(length(trim("charge_adjustments"."reason")) > 0),
	CONSTRAINT "charge_adjustments_reversal_check" CHECK(("charge_adjustments"."reversed_at" is null and "charge_adjustments"."reversed_by_account_id" is null and "charge_adjustments"."reversal_reason" is null)
      or ("charge_adjustments"."reversed_at" is not null and "charge_adjustments"."reversed_by_account_id" is not null and length(trim("charge_adjustments"."reversal_reason")) > 0))
);
--> statement-breakpoint
CREATE INDEX `charge_adjustments_charge_idx` ON `charge_adjustments` (`charge_id`);--> statement-breakpoint
CREATE TABLE `fee_agreements` (
	`id` text PRIMARY KEY NOT NULL,
	`player_account_id` text NOT NULL,
	`academy_plan` text NOT NULL,
	`level` text NOT NULL,
	`batch` text NOT NULL,
	`agreed_monthly_fee_paise` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`monthly_due_day` integer DEFAULT 5 NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`status` text DEFAULT 'active' NOT NULL,
	`record_revision` integer DEFAULT 0 NOT NULL,
	`created_by_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by_account_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`player_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fee_agreements_amount_positive_check" CHECK("fee_agreements"."agreed_monthly_fee_paise" > 0),
	CONSTRAINT "fee_agreements_due_day_check" CHECK("fee_agreements"."monthly_due_day" between 1 and 28),
	CONSTRAINT "fee_agreements_currency_check" CHECK("fee_agreements"."currency" = 'INR'),
	CONSTRAINT "fee_agreements_dates_check" CHECK("fee_agreements"."effective_to" is null or "fee_agreements"."effective_to" >= "fee_agreements"."effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fee_agreements_one_active_player_idx` ON `fee_agreements` (`player_account_id`) WHERE "fee_agreements"."status" = 'active';--> statement-breakpoint
CREATE INDEX `fee_agreements_player_dates_idx` ON `fee_agreements` (`player_account_id`,`effective_from`,`effective_to`);--> statement-breakpoint
CREATE TABLE `financial_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_account_id` text NOT NULL,
	`event_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`idempotency_key` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_audit_idempotency_idx` ON `financial_audit_events` (`idempotency_key`) WHERE "financial_audit_events"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `financial_audit_one_activation_idx` ON `financial_audit_events` (`entity_id`) WHERE "financial_audit_events"."event_type" = 'finance_activated' and "financial_audit_events"."entity_type" = 'academy';--> statement-breakpoint
CREATE INDEX `financial_audit_entity_idx` ON `financial_audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `financial_audit_occurred_idx` ON `financial_audit_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `financial_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`fee_reference` text NOT NULL,
	`player_account_id` text NOT NULL,
	`fee_agreement_id` text,
	`type` text NOT NULL,
	`billing_period` text,
	`description` text NOT NULL,
	`original_amount_paise` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`due_date` text NOT NULL,
	`lifecycle` text DEFAULT 'issued' NOT NULL,
	`record_revision` integer DEFAULT 0 NOT NULL,
	`issued_by_account_id` text NOT NULL,
	`issued_at` integer NOT NULL,
	`voided_by_account_id` text,
	`voided_at` integer,
	`void_reason` text,
	FOREIGN KEY (`player_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fee_agreement_id`) REFERENCES `fee_agreements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issued_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "financial_charges_amount_positive_check" CHECK("financial_charges"."original_amount_paise" > 0),
	CONSTRAINT "financial_charges_currency_check" CHECK("financial_charges"."currency" = 'INR'),
	CONSTRAINT "financial_charges_period_check" CHECK(("financial_charges"."type" = 'registration' and "financial_charges"."billing_period" is null)
      or ("financial_charges"."type" = 'monthly_training' and "financial_charges"."billing_period" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]')),
	CONSTRAINT "financial_charges_void_check" CHECK(("financial_charges"."lifecycle" = 'issued' and "financial_charges"."voided_at" is null and "financial_charges"."voided_by_account_id" is null and "financial_charges"."void_reason" is null)
      or ("financial_charges"."lifecycle" = 'void' and "financial_charges"."voided_at" is not null and "financial_charges"."voided_by_account_id" is not null and length(trim("financial_charges"."void_reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_charges_fee_reference_ci_idx` ON `financial_charges` (lower("fee_reference"));--> statement-breakpoint
CREATE UNIQUE INDEX `financial_charges_one_registration_idx` ON `financial_charges` (`player_account_id`) WHERE "financial_charges"."type" = 'registration' and "financial_charges"."lifecycle" = 'issued';--> statement-breakpoint
CREATE UNIQUE INDEX `financial_charges_one_monthly_period_idx` ON `financial_charges` (`player_account_id`,`billing_period`) WHERE "financial_charges"."type" = 'monthly_training' and "financial_charges"."lifecycle" = 'issued';--> statement-breakpoint
CREATE INDEX `financial_charges_player_due_idx` ON `financial_charges` (`player_account_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `financial_charges_billing_period_idx` ON `financial_charges` (`billing_period`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text NOT NULL,
	`player_account_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`received_on` text NOT NULL,
	`method` text NOT NULL,
	`external_reference` text,
	`internal_note` text,
	`lifecycle` text DEFAULT 'recorded' NOT NULL,
	`idempotency_key` text NOT NULL,
	`recorded_by_account_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`reversed_by_account_id` text,
	`reversed_at` integer,
	`reversal_reason` text,
	FOREIGN KEY (`charge_id`) REFERENCES `financial_charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_amount_positive_check" CHECK("payments"."amount_paise" > 0),
	CONSTRAINT "payments_currency_check" CHECK("payments"."currency" = 'INR'),
	CONSTRAINT "payments_reversal_check" CHECK(("payments"."lifecycle" = 'recorded' and "payments"."reversed_at" is null and "payments"."reversed_by_account_id" is null and "payments"."reversal_reason" is null)
      or ("payments"."lifecycle" = 'reversed' and "payments"."reversed_at" is not null and "payments"."reversed_by_account_id" is not null and length(trim("payments"."reversal_reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_idempotency_key_idx` ON `payments` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `payments_charge_idx` ON `payments` (`charge_id`);--> statement-breakpoint
CREATE INDEX `payments_player_idx` ON `payments` (`player_account_id`);