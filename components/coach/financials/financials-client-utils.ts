"use client"

import { useRef } from "react"

import type { FinanceActionResult } from "@/app/coach/financials/actions"
import type { ActionFeedback } from "@/components/inline-notice"
import { formatDateKey } from "@/lib/format"
import type { PaymentMethod } from "@/lib/finance/types"

import type { FinanceStatus } from "./types"

export const statusLabels: Record<FinanceStatus, string> = {
  setup_required: "Setup required",
  not_prepared: "Monthly fee not issued",
  pending: "Pending",
  partially_paid: "Partially paid",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
}

export const paymentMethods: Array<{ label: string; value: PaymentMethod }> = [
  { label: "UPI", value: "upi" },
  { label: "Cash", value: "cash" },
  { label: "Bank transfer", value: "bank_transfer" },
  { label: "Card", value: "card" },
  { label: "Cheque", value: "cheque" },
  { label: "Other", value: "other" },
]

export function useIdempotencyKey() {
  const keyRef = useRef<string | null>(null)
  return {
    current() {
      keyRef.current ??= window.crypto.randomUUID()
      return keyRef.current
    },
    reset() {
      keyRef.current = null
    },
  }
}

export function paymentMethodLabel(method: PaymentMethod | string) {
  if (method === "upi") return "UPI"
  return method.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase())
}

const periodFormat = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  timeZone: "UTC",
  year: "numeric",
})

export function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number)
  if (!year || !month) return period
  return periodFormat.format(new Date(Date.UTC(year, month - 1, 1)))
}

export function formatDueDate(value: string | null) {
  if (!value) return "No due date"
  return formatDateKey(value, { day: "numeric", month: "short", year: "numeric" })
}

export function resultFeedback(result: FinanceActionResult): ActionFeedback {
  return {
    message: result.message,
    tone: result.ok ? "success" : "error",
  }
}
