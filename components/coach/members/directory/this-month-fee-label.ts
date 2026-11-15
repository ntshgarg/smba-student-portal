import type { FinanceStatus } from "@/lib/finance/types"
import { formatDateKey, formatInr } from "@/lib/format"

/** "Tue 10 Nov": how the record writes a day. */
export function dayName(dateKey: string) {
  return formatDateKey(dateKey, { day: "numeric", month: "short", weekday: "short", year: undefined })
}

/**
 * This month's fee on a player's record, in one line, by the status Financials
 * gives it (deriveFinanceStatus): a balance still owed after its due date is
 * overdue even when part of it was paid, so the two pages never disagree.
 */
export function thisMonthFeeLabel(fee: {
  amountPaise: number
  dueDate: string
  receivedPaise: number
  status: FinanceStatus
}) {
  const amount = formatInr(fee.amountPaise)
  switch (fee.status) {
    case "paid":
      return `${amount} · paid`
    case "overdue":
      return `${amount} · overdue, was due ${dayName(fee.dueDate)}${fee.receivedPaise > 0 ? ` · ${formatInr(fee.receivedPaise)} paid` : ""}`
    case "partially_paid":
      return `${amount} · ${formatInr(fee.receivedPaise)} paid`
    default:
      return `${amount} · due ${dayName(fee.dueDate)}`
  }
}
