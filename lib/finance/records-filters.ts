import {
  isFinanceAuditEventType,
  type FinanceAuditEventType,
  type FinanceStatus,
} from "@/lib/finance/types"

/**
 * The fee register's status tiles. "Due" gathers the two states of a fee that is
 * issued and not yet late; every other tile is one status. A single status in
 * the address (from an older link) still filters on its own.
 */
export const REGISTER_STATUS_FILTERS = [
  { key: "due", label: "Due", statuses: ["pending", "partially_paid"] },
  { key: "overdue", label: "Overdue", statuses: ["overdue"] },
  { key: "paid", label: "Paid", statuses: ["paid"] },
  { key: "not_prepared", label: "To issue", statuses: ["not_prepared"] },
  { key: "setup_required", label: "No fee plan", statuses: ["setup_required"] },
  { key: "void", label: "Void", statuses: ["void"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; statuses: readonly FinanceStatus[] }>

const FINANCE_STATUSES: readonly FinanceStatus[] = [
  "pending", "partially_paid", "overdue", "paid", "not_prepared", "setup_required", "void",
]

export function registerStatusesFor(value: string | null | undefined): FinanceStatus[] | undefined {
  const tile = REGISTER_STATUS_FILTERS.find((filter) => filter.key === value)
  if (tile) return [...tile.statuses]
  return FINANCE_STATUSES.includes(value as FinanceStatus) ? [value as FinanceStatus] : undefined
}

/** The activity chips: each gathers the events a coach thinks of as one kind. */
export const ACTIVITY_GROUPS = [
  { key: "payments", label: "Payments", eventTypes: ["payment_recorded", "payment_reversed"] },
  { key: "fees", label: "Fees issued", eventTypes: ["charge_issued", "monthly_fees_prepared", "charge_voided"] },
  { key: "refunds", label: "Refunds", eventTypes: ["refund_recorded", "refund_reversed"] },
  {
    key: "plans",
    label: "Fee plans",
    eventTypes: [
      "fee_agreement_created",
      "fee_agreement_replaced",
      "fee_agreement_paused",
      "fee_agreement_ended",
      "fee_agreement_corrected",
      "training_start_redated",
      "historical_reconciled",
      "finance_activated",
    ],
  },
  {
    key: "concessions",
    label: "Concessions",
    eventTypes: ["concession_created", "concession_applied", "concession_application_reversed", "concession_reversed"],
  },
  { key: "corrections", label: "Corrections", eventTypes: ["adjustment_created", "adjustment_reversed"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; eventTypes: readonly FinanceAuditEventType[] }>

export function activityGroupFor(eventType: FinanceAuditEventType) {
  return ACTIVITY_GROUPS.find((group) => (group.eventTypes as readonly string[]).includes(eventType))
}

/**
 * The event types an `eventType` address value selects: a chip's group, or one
 * event type from an older link. Anything else is no filter.
 */
export function activityEventTypesFor(
  value: string | null | undefined,
): FinanceAuditEventType[] | undefined {
  const group = ACTIVITY_GROUPS.find((item) => item.key === value)
  if (group) return [...group.eventTypes]
  return isFinanceAuditEventType(value) ? [value] : undefined
}
