import { createHash, randomBytes } from "node:crypto"

import { isValidDateKey, isValidMonthKey } from "@/lib/attendance/domain"
import type {
  AdjustmentKind,
  ChargeLifecycle,
  FinanceStatus,
  PaymentLifecycle,
} from "@/lib/finance/types"

const FEE_REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u

export type LedgerAdjustmentFact = {
  // Kept here, and only here, so old databases remain financially readable.
  kind: AdjustmentKind | "legacy_settlement"
  amountPaise: number
  reversedAt: Date | null
}

export type LedgerPaymentFact = {
  amountPaise: number
  lifecycle: PaymentLifecycle
}

export type LedgerRefundFact = {
  amountPaise: number
  lifecycle: PaymentLifecycle
}

export type LedgerChargeFact = {
  originalAmountPaise: number
  dueDate: string
  lifecycle: ChargeLifecycle
  adjustments: LedgerAdjustmentFact[]
  payments: LedgerPaymentFact[]
  refunds?: LedgerRefundFact[]
}

export function createOpaqueFeeReference() {
  const bytes = randomBytes(8)
  let token = ""
  for (let index = 0; index < 8; index += 1) {
    token += FEE_REFERENCE_ALPHABET[bytes[index] % FEE_REFERENCE_ALPHABET.length]
  }
  return `SMBA-${token}`
}

export function isValidFeeReference(value: string) {
  return /^SMBA-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/u.test(value)
}

export function isValidIdempotencyKey(value: string) {
  return IDEMPOTENCY_KEY_PATTERN.test(value)
}

export function addCalendarDays(dateKey: string, days: number) {
  if (!isValidDateKey(dateKey) || !Number.isInteger(days)) throw new Error("Invalid date.")
  const value = new Date(`${dateKey}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function monthStart(period: string) {
  if (!isValidMonthKey(period)) throw new Error("Invalid month.")
  return `${period}-01`
}

export function monthEnd(period: string) {
  if (!isValidMonthKey(period)) throw new Error("Invalid month.")
  const [year, month] = period.split("-").map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

export function calculateUnusedMonthRefundLimit(
  effectiveAmountPaise: number,
  billingPeriod: string,
  withdrawalEffectiveOn: string,
) {
  if (!Number.isInteger(effectiveAmountPaise) || effectiveAmountPaise <= 0
    || !isValidMonthKey(billingPeriod)
    || !isValidDateKey(withdrawalEffectiveOn)
    || withdrawalEffectiveOn.slice(0, 7) !== billingPeriod) {
    throw new Error("Invalid withdrawal refund period.")
  }
  const daysInMonth = Number(monthEnd(billingPeriod).slice(8, 10))
  const withdrawalDay = Number(withdrawalEffectiveOn.slice(8, 10))
  const unusedDays = daysInMonth - withdrawalDay
  if (unusedDays <= 0 || unusedDays >= daysInMonth) {
    throw new Error("A withdrawal refund requires a mid-month date.")
  }
  // Round down to the nearest paise so the refund never exceeds the
  // calendar-day value of the unused training period.
  return Math.floor((effectiveAmountPaise * unusedDays) / daysInMonth)
}

export function calculateProratedSessionFee(
  agreedMonthlyFeePaise: number,
  remainingSessions: number,
  totalSessions: number,
) {
  if (!Number.isInteger(agreedMonthlyFeePaise) || agreedMonthlyFeePaise <= 0
    || !Number.isInteger(totalSessions) || totalSessions <= 0
    || !Number.isInteger(remainingSessions) || remainingSessions < 0
    || remainingSessions > totalSessions) {
    throw new Error("Invalid session fee proration.")
  }
  if (remainingSessions === 0) return 0
  if (remainingSessions === totalSessions) return agreedMonthlyFeePaise

  const exactPaise = (agreedMonthlyFeePaise * remainingSessions) / totalSessions
  const fiftyRupeesPaise = 5_000
  // Offline academy collections use simple denominations. Round a partial
  // joining-month fee once to the nearest INR 50 (ties round upward), then
  // keep the resulting Charge immutable. A full month retains its exact fee.
  return Math.round(exactPaise / fiftyRupeesPaise) * fiftyRupeesPaise
}

export function dateInMonth(period: string, day: number) {
  if (!isValidMonthKey(period) || !Number.isInteger(day) || day < 1 || day > 28) {
    throw new Error("Invalid billing due date.")
  }
  return `${period}-${String(day).padStart(2, "0")}`
}

export function calculateChargeLedger(charge: LedgerChargeFact) {
  const adjustments = charge.adjustments.filter((item) => item.reversedAt === null)
  const debits = adjustments
    .filter((item) => item.kind === "manual_debit")
    .reduce((total, item) => total + item.amountPaise, 0)
  const credits = adjustments
    .filter((item) => item.kind !== "manual_debit")
    .reduce((total, item) => total + item.amountPaise, 0)
  const allocatedPaise = charge.payments
    .filter((item) => item.lifecycle === "recorded")
    .reduce((total, item) => total + item.amountPaise, 0)
  const refundedPaise = (charge.refunds ?? [])
    .filter((item) => item.lifecycle === "recorded")
    .reduce((total, item) => total + item.amountPaise, 0)
  const receivedPaise = Math.max(0, allocatedPaise - refundedPaise)
  const effectiveAmountPaise = charge.lifecycle === "void"
    ? 0
    : Math.max(0, charge.originalAmountPaise + debits - credits)

  return {
    effectiveAmountPaise,
    receivedPaise,
    outstandingPaise: Math.max(0, effectiveAmountPaise - receivedPaise),
  }
}

export function formatFinancialSequenceReference(
  kind: "receipt" | "refund",
  year: number,
  sequence: number,
) {
  if (!Number.isInteger(year) || year < 2000 || year > 9999
    || !Number.isInteger(sequence) || sequence < 1 || sequence > 99_999) {
    throw new Error("Invalid financial reference sequence.")
  }
  return `SMBA-${kind === "receipt" ? "R" : "RF"}-${year}-${String(sequence).padStart(5, "0")}`
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

export function financialPayloadFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")
}

export function isValidMutationId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(value)
}

export function calculateConcessionAmount({
  originalAmountPaise,
  outstandingPaise,
  value,
  valueKind,
}: {
  originalAmountPaise: number
  outstandingPaise: number
  value: number
  valueKind: "fixed" | "percentage"
}) {
  const requested = valueKind === "percentage"
    ? Math.floor((originalAmountPaise * value + 5_000) / 10_000)
    : value
  return Math.min(Math.max(0, requested), Math.max(0, outstandingPaise))
}

export function deriveFinanceStatus(
  charge: LedgerChargeFact,
  referenceDate: string,
): FinanceStatus {
  if (!isValidDateKey(referenceDate)) throw new Error("Invalid finance reference date.")
  if (charge.lifecycle === "void") return "void"
  const ledger = calculateChargeLedger(charge)
  if (ledger.outstandingPaise === 0) return "paid"
  if (ledger.receivedPaise > 0) return "partially_paid"
  return charge.dueDate < referenceDate ? "overdue" : "pending"
}

export function combineFinanceStatuses(statuses: FinanceStatus[]): FinanceStatus {
  const active = statuses.filter((status) => status !== "void")
  if (!active.length) return "setup_required"
  if (active.includes("overdue")) return "overdue"
  if (active.includes("not_prepared")) return "not_prepared"
  if (active.includes("partially_paid")) return "partially_paid"
  if (active.includes("pending")) return "pending"
  return "paid"
}
