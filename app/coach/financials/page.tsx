import { redirect } from "next/navigation"

import { FinancialsActivation } from "@/components/coach/financials/financials-activation"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { initializeDatabase } from "@/lib/db/client"
import { getFinanceActivation } from "@/lib/finance/service"
import { academyCurrentMonth } from "@/lib/clock"

export const metadata = {
  title: "Financials",
}

type SearchParams = {
  period?: string | string[]
  player?: string | string[]
  q?: string | string[]
  query?: string | string[]
  view?: string | string[]
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function validPeriod(value: string | undefined) {
  return value && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value) ? value : academyCurrentMonth()
}

function legacyQuery(params: SearchParams) {
  return (firstValue(params.q) ?? firstValue(params.query) ?? "").trim().slice(0, 120)
}

export default async function CoachFinancialsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await requireHeadAdminPage()

  const queryParams = await searchParams
  const period = validPeriod(firstValue(queryParams.period))
  const query = legacyQuery(queryParams)
  const database = initializeDatabase()
  const activation = getFinanceActivation({ database })

  if (!activation) return <FinancialsActivation initialPeriod={period} />

  const playerId = firstValue(queryParams.player)?.trim()
  if (playerId) {
    const playerQuery = new URLSearchParams({
      mode: "monthly",
      period,
      scope: "active",
      status: "all",
    })
    if (query) playerQuery.set("q", query)
    redirect(`/coach/financials/players/${encodeURIComponent(playerId)}?${playerQuery.toString()}`)
  }

  const recordsQuery = new URLSearchParams({
    view: "fees",
    mode: "monthly",
    period,
  })
  if (query) recordsQuery.set("q", query)
  redirect(`/coach/financials/records?${recordsQuery.toString()}`)
}
