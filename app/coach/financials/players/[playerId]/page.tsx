import { notFound, redirect } from "next/navigation"

import { FinancialPlayerRecordWorkspace } from "@/components/coach/financials/financial-player-record-workspace"
import { toPlayerFinancialLedgerView } from "@/components/coach/financials/view-model"
import { isValidMonthKey } from "@/lib/attendance/domain"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { initializeDatabase } from "@/lib/db/client"
import { getCoachFinancePlayerRecord, getFinanceActivation } from "@/lib/finance/service"
import { academyCurrentMonth } from "@/lib/clock"

export const metadata = {
  title: "Player fee record",
}

type SearchParams = Record<string, string | string[] | undefined>

const REGISTER_MODES = ["monthly", "registration"] as const
const PLAYER_SCOPES = ["active", "archived", "all"] as const
const REGISTER_STATUSES = [
  "all",
  "setup_required",
  "pending",
  "partially_paid",
  "overdue",
  "paid",
  "not_prepared",
  "void",
] as const

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function allowedValue<const T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  fallback: T[number],
): T[number] {
  return value && allowed.includes(value) ? value as T[number] : fallback
}

function validCursorTrail(value: string | undefined) {
  if (!value || value.length > 4_020) return ""
  const values = value.split(",")
  return values.length <= 20 && values.every((item) => item.length > 0 && item.length <= 200)
    ? values.join(",")
    : ""
}

export default async function FinancialPlayerRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>
  searchParams: Promise<SearchParams>
}) {
  const { identity } = await requireHeadAdminPage()

  const database = initializeDatabase()
  if (!getFinanceActivation({ database })) redirect("/coach/financials")

  const [{ playerId }, query] = await Promise.all([params, searchParams])
  const requestedPeriod = firstValue(query.period)
  const paymentPeriod = academyCurrentMonth()
  const period = requestedPeriod && isValidMonthKey(requestedPeriod)
    ? requestedPeriod
    : paymentPeriod
  const mode = allowedValue(firstValue(query.mode), REGISTER_MODES, "monthly")
  const scope = allowedValue(firstValue(query.scope), PLAYER_SCOPES, "active")
  const status = allowedValue(firstValue(query.status), REGISTER_STATUSES, "all")
  const registerQuery = (firstValue(query.q) ?? "").trim().slice(0, 120)
  const cursors = validCursorTrail(firstValue(query.cursors))
  const record = getCoachFinancePlayerRecord(playerId, {
    coachId: identity.subjectId,
    database,
  })
  if (!record) notFound()
  const ledger = toPlayerFinancialLedgerView(record)

  const backSearch = new URLSearchParams({
    mode,
    period,
    scope,
    status,
    view: "fees",
  })
  if (registerQuery) backSearch.set("q", registerQuery)
  if (cursors) backSearch.set("cursors", cursors)

  return (
    <FinancialPlayerRecordWorkspace
      backHref={`/coach/financials/records?${backSearch.toString()}`}
      ledger={ledger}
      paymentPeriod={paymentPeriod}
      period={period}
    />
  )
}
