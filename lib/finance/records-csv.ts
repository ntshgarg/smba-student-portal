import type { FinanceActivityItem, FinanceRegisterRow } from "@/lib/finance/types"
import { formatAcademyTime, getAcademyDateKey } from "@/lib/format"

function neutralizeSpreadsheetFormula(value: string) {
  return /^\s*[=+\-@]/u.test(value) || /^[\t\r]/u.test(value) ? `'${value}` : value
}

function csvCell(value: string) {
  const safeValue = neutralizeSpreadsheetFormula(value)
  return /[",\r\n]/u.test(safeValue)
    ? `"${safeValue.replaceAll('"', '""')}"`
    : safeValue
}

function formatPaise(amountPaise: number | null) {
  if (amountPaise === null) return ""
  if (!Number.isSafeInteger(amountPaise)) {
    throw new Error("Financial record export contains an invalid amount.")
  }
  const sign = amountPaise < 0 ? "-" : ""
  const absolute = Math.abs(amountPaise)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`
}

function createCsvStream(lines: Iterator<string>) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = lines.next()
      if (next.done) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(next.value))
    },
  })
}

const REGISTER_HEADERS = [
  "Player",
  "Academy ID",
  "Fee type",
  "Billing period",
  "Fee reference",
  "Original amount (INR)",
  "Credits (INR)",
  "Debits (INR)",
  "Effective amount (INR)",
  "Received (INR)",
  "Outstanding (INR)",
  "Due date",
  "Status",
  "Player record",
] as const

export function feeRegisterCsvLines(rows: Iterable<FinanceRegisterRow>) {
  return (function* generateLines() {
    yield `${REGISTER_HEADERS.map(csvCell).join(",")}\r\n`
    for (const row of rows) {
      yield `${[
        row.fullName,
        row.academyId,
        row.type === "registration" ? "Registration" : "Monthly training",
        row.billingPeriod ?? "",
        row.feeReference ?? "",
        formatPaise(row.originalAmountPaise),
        formatPaise(row.creditAdjustmentsPaise),
        formatPaise(row.debitAdjustmentsPaise),
        formatPaise(row.effectiveAmountPaise),
        formatPaise(row.receivedPaise),
        formatPaise(row.outstandingPaise),
        row.dueDate ?? "",
        row.status.replaceAll("_", " "),
        row.archived ? "Archived" : "Active",
      ].map(csvCell).join(",")}\r\n`
    }
  })()
}

export function createFeeRegisterCsvStream(rows: Iterable<FinanceRegisterRow>) {
  return createCsvStream(feeRegisterCsvLines(rows))
}

const ACTIVITY_HEADERS = [
  "Occurred at (Asia/Kolkata)",
  "Action",
  "Coach",
  "Player",
  "Academy ID",
  "Reference",
  "Amount (INR)",
  "Reason",
] as const

export function activityCsvLines(items: Iterable<FinanceActivityItem>) {
  return (function* generateLines() {
    yield `${ACTIVITY_HEADERS.map(csvCell).join(",")}\r\n`
    for (const item of items) {
      yield `${[
        `${getAcademyDateKey(item.occurredAt)} ${formatAcademyTime(item.occurredAt)} IST`,
        item.action,
        item.actorName,
        item.playerName ?? "",
        item.academyId ?? "",
        item.reference ?? "",
        formatPaise(item.amountPaise),
        item.reason ?? "",
      ].map(csvCell).join(",")}\r\n`
    }
  })()
}

export function createActivityCsvStream(items: Iterable<FinanceActivityItem>) {
  return createCsvStream(activityCsvLines(items))
}
