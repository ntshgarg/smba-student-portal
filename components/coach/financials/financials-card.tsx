import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"
import { formatInr } from "@/lib/format"

const periodFormat = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  timeZone: "UTC",
})

function formatPeriod(period: string) {
  const [year, month] = period.split("-").map(Number)
  return periodFormat.format(new Date(Date.UTC(year, month - 1, 1)))
}

/**
 * The heading sums up the month (head coach, 15 Nov 2026): a grey count of fees still to issue and a red
 * count of late payers. The broader attention count also held fees not yet due and fees not yet issued, so
 * 31 of 39 players looked late; red is now for overdue only, and players with no fee plan are named in the
 * detail line.
 */
export function FinancialsCard({
  active,
  attentionCount,
  outstandingPaise,
  overdueCount,
  period,
  preparation,
  setupRequiredCount,
}: {
  active: boolean
  attentionCount: number
  outstandingPaise: number
  overdueCount: number
  period: string
  preparation: {
    ready: number
    alreadyPrepared: number
  }
  setupRequiredCount: number
}) {
  const summary = attentionCount === 0
    ? "Fee records are ready to review"
    : outstandingPaise > 0
      ? `${formatInr(outstandingPaise)} outstanding`
      : "Some players need a fee plan or this month’s fee"
  const month = formatPeriod(period)
  const preparationState = preparation.ready > 0
    ? `${month} fees ready to issue`
    : preparation.alreadyPrepared > 0
      ? `${month} fees issued`
      : "No monthly fees to issue"
  const detail = setupRequiredCount > 0
    ? `${preparationState} · ${setupRequiredCount} ${setupRequiredCount === 1 ? "player" : "players"} without a fee plan`
    : preparationState
  const stamps = [
    ...preparation.ready > 0 ? [{ count: preparation.ready, unit: "to issue" }] : [],
    ...overdueCount > 0 ? [{ count: overdueCount, unit: "overdue", tone: "attention" as const }] : [],
  ]

  return (
    <CoachDashboardCard
      area="financials"
      status={active ? stamps : { state: "Setup" }}
      title="Financials"
      titleId="coach-financials-card-title"
    >
      {active ? (
        <>
          <CoachDashboardSummary detail={detail}>
            {summary}
          </CoachDashboardSummary>
          <CoachDashboardActions ariaLabel="Financial actions">
            <CoachDashboardAction href="/coach/financials/record" primary>
              Record payment
            </CoachDashboardAction>
            <CoachDashboardAction href={`/coach/financials/records?view=fees&mode=monthly&period=${period}`}>
              Fee records
            </CoachDashboardAction>
          </CoachDashboardActions>
        </>
      ) : (
        <>
          <CoachDashboardSummary detail="Set up Financials to begin the academy fee record.">
            Financial records are not set up
          </CoachDashboardSummary>
          <CoachDashboardActions ariaLabel="Financial actions">
            <CoachDashboardAction href={`/coach/financials?period=${period}`}>
              Set up Financials
            </CoachDashboardAction>
          </CoachDashboardActions>
        </>
      )}
    </CoachDashboardCard>
  )
}
