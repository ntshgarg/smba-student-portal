import { formatDateKey } from "@/lib/format"
import type {
  FinanceStatus,
  PlayerFinanceDashboardSummary,
  PaymentView,
  ChargeView,
} from "@/lib/finance/types"

const STATUS_LABELS: Record<FinanceStatus, string> = {
  setup_required: "Onboarding in progress",
  not_prepared: "Monthly fee not issued",
  pending: "Pending",
  partially_paid: "Partially paid",
  overdue: "Payment due",
  paid: "Paid",
  void: "Void",
}

const PAYMENT_METHOD_LABELS: Record<PaymentView["method"], string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
}

export function formatFinanceAmount(amountPaise: number) {
  const hasPaise = amountPaise % 100 !== 0
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amountPaise / 100)
}

export function formatFinanceDate(dateKey: string) {
  return formatDateKey(dateKey, {
    day: "numeric",
    month: "long",
    weekday: undefined,
    year: "numeric",
  })
}

export function formatBillingPeriod(period: string | null) {
  if (!period || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(period)) return "Monthly training fee"
  return formatDateKey(`${period}-01`, {
    day: undefined,
    month: "long",
    weekday: undefined,
    year: undefined,
  })
}

export function financeStatusLabel(status: FinanceStatus) {
  return STATUS_LABELS[status]
}

export function financeStatusTone(status: FinanceStatus) {
  if (status === "paid") return "settled"
  if (status === "partially_paid" || status === "pending" || status === "overdue") {
    return "attention"
  }
  return "neutral"
}

export function paymentMethodLabel(method: PaymentView["method"]) {
  return PAYMENT_METHOD_LABELS[method]
}

export function groupMonthlyChargesByYear(charges: ChargeView[]) {
  const groups = new Map<string, ChargeView[]>()

  charges.forEach((charge) => {
    const year = /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(charge.billingPeriod ?? "")
      ? charge.billingPeriod!.slice(0, 4)
      : charge.dueDate.slice(0, 4)
    const group = groups.get(year) ?? []
    group.push(charge)
    groups.set(year, group)
  })

  return [...groups.entries()]
    .sort(([first], [second]) => second.localeCompare(first))
    .map(([year, yearCharges]) => ({
      year,
      charges: [...yearCharges].sort((first, second) => (
        (second.billingPeriod ?? second.dueDate).localeCompare(
          first.billingPeriod ?? first.dueDate,
        ) || second.id.localeCompare(first.id)
      )),
    }))
}

export function dashboardFeeRecordCopy(
  summary: PlayerFinanceDashboardSummary | null,
) {
  if (!summary) {
    return {
      status: "Fee record unavailable",
      detail: "Your fee record could not be loaded just now.",
    }
  }

  if (summary.status === "setup_required") {
    return {
      status: "Player onboarding in progress",
      detail: "Your academy fees will appear here after onboarding is complete.",
    }
  }

  if (summary.status === "not_prepared") {
    return {
      status: "Monthly fee not issued",
      detail: "Your next monthly fee will appear after the academy issues it.",
    }
  }

  if (summary.currentBalancePaise === 0) {
    return {
      status: "No balance due",
      detail: "Your academy fee record is up to date.",
    }
  }

  const amount = formatFinanceAmount(summary.currentBalancePaise)
  const dueDate = summary.nextDueDate ? formatFinanceDate(summary.nextDueDate) : null

  if (summary.status === "partially_paid") {
    return {
      status: `${amount} remaining`,
      detail: dueDate
        ? `A payment is recorded. The remaining balance is due by ${dueDate}.`
        : "A payment is recorded against this fee.",
    }
  }

  return {
    status: summary.status === "overdue" ? `${amount} remains due` : `${amount} due`,
    detail: dueDate ? `Due by ${dueDate}.` : "Open your fee record for the full details.",
  }
}
