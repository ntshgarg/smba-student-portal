import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"

function formatInr(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100)
}

function formatPeriod(period: string) {
  const [year, month] = period.split("-").map(Number)
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

export function FinancialsCard({
  active,
  attentionCount,
  outstandingPaise,
  period,
  preparation,
}: {
  active: boolean
  attentionCount: number
  outstandingPaise: number
  period: string
  preparation: {
    ready: number
    alreadyPrepared: number
  }
}) {
  const summary = attentionCount > 0
    ? `${formatInr(outstandingPaise)} outstanding`
    : "Fee records are ready to review"
  const month = formatPeriod(period)
  const preparationState = preparation.ready > 0
    ? `${month} fees ready to issue`
    : preparation.alreadyPrepared > 0
      ? `${month} fees issued`
      : "No monthly fees to issue"

  return (
    <CoachDashboardCard
      area="financials"
      status={active
        ? attentionCount > 0
          ? `${attentionCount} attention`
          : "Ready"
        : "Setup"}
      title="Financials"
      titleId="coach-financials-card-title"
    >
      {active ? (
        <>
          <CoachDashboardSummary
            ariaLabel={attentionCount > 0
              ? `${attentionCount} ${attentionCount === 1 ? "record needs" : "records need"} attention, ${summary}. ${preparationState}.`
              : `${summary}. ${preparationState}.`}
            detail={preparationState}
          >
            {summary}
          </CoachDashboardSummary>
          <CoachDashboardActions ariaLabel="Financial actions">
            <CoachDashboardAction href="/coach/financials/record">
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
