CREATE INDEX `financial_charges_register_idx`
  ON `financial_charges` (`type`, `billing_period`, `lifecycle`, `player_account_id`, `due_date`);
--> statement-breakpoint
CREATE INDEX `payments_received_lifecycle_idx`
  ON `payments` (`received_on`, `lifecycle`);
--> statement-breakpoint
CREATE INDEX `refunds_date_lifecycle_idx`
  ON `refunds` (`refunded_on`, `lifecycle`);
--> statement-breakpoint
CREATE INDEX `financial_audit_type_occurred_idx`
  ON `financial_audit_events` (`event_type`, `occurred_at`);
