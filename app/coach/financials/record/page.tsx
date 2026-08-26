import { redirect } from "next/navigation"

import { FinancialsRapidDesk } from "@/components/coach/financials/financials-rapid-desk"
import { toRapidFinancialWorkspaceView } from "@/components/coach/financials/view-model"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { initializeDatabase } from "@/lib/db/client"
import { academyCurrentMonth } from "@/lib/clock"
import { getCoachFinanceRapidDesk, getFinanceActivation } from "@/lib/finance/service"
import type { FinanceRapidScope } from "@/lib/finance/types"

export const metadata = {
  title: "Record payment",
}

type SearchParams = {
  player?: string | string[]
  query?: string | string[]
  scope?: string | string[]
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function neutralRapidDeskHref({
  query,
  requestedScope,
}: {
  query: string
  requestedScope: string | undefined
}) {
  const search = new URLSearchParams()
  if (requestedScope === "all") search.set("scope", requestedScope)
  if (query) search.set("query", query)
  const serialized = search.toString()
  return `/coach/financials/record${serialized ? `?${serialized}` : ""}`
}

export default async function FinancialsRapidDeskPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { identity } = await requireHeadAdminPage()

  const database = initializeDatabase()
  if (!getFinanceActivation({ database })) redirect("/coach/financials")

  const params = await searchParams
  const query = (firstValue(params.query) ?? "").trim().slice(0, 120)
  const requestedPlayer = firstValue(params.player)
  const playerId = requestedPlayer?.trim() || undefined
  const requestedScope = firstValue(params.scope)
  const scope: FinanceRapidScope = requestedScope === "all" ? "all" : "outstanding"
  const workspace = getCoachFinanceRapidDesk({
    period: academyCurrentMonth(),
    playerId,
    query,
    scope,
  }, {
    coachId: identity.subjectId,
    database,
  })

  if (requestedPlayer !== undefined && (!playerId || !workspace.selectedLedger)) {
    redirect(neutralRapidDeskHref({ query, requestedScope }))
  }

  return (
    <FinancialsRapidDesk
      initialQuery={query}
      workspace={toRapidFinancialWorkspaceView(workspace)}
    />
  )
}
