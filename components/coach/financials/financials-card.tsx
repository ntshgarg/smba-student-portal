import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"
import { formatInr } from "@/lib/format"

import styles from "./financials-card.module.css"

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
    /** Fees held back until a booked training change happens. */
    waitingForChange: number
  }
  setupRequiredCount: number
}) {
  const summary = outstandingPaise > 0
    ? `${formatInr(outstandingPaise)} outstanding`
    : attentionCount === 0
      ? "Nothing outstanding"
      : "Some players need a fee plan or this month’s fee"
  const month = formatPeriod(period)
  const preparationState = preparation.ready > 0
    ? `${month} fees ready to issue`
    : preparation.alreadyPrepared > 0
      ? `${month} fees issued`
      : "No monthly fees to issue"
  const tiles = [
    { count: preparation.ready, label: "To issue" },
    { count: overdueCount, label: "Overdue", attention: true },
    { count: setupRequiredCount, label: "No fee plan" },
  ]
  // Each stamp opens the list behind its count: the month's fees not yet issued (where Issue fees sits),
  // and the Record payment list narrowed to late payers.
  const stamps = [
    ...preparation.ready > 0 ? [{
      count: preparation.ready,
      unit: "to issue",
      href: `/coach/financials/records?view=fees&mode=monthly&period=${period}&status=not_prepared`,
      linkLabel: `${preparation.ready} to issue: show the ${month} fees not yet issued`,
    }] : [],
    ...overdueCount > 0 ? [{
      count: overdueCount,
      unit: "overdue",
      tone: "attention" as const,
      href: "/coach/financials/record?scope=overdue",
      linkLabel: `${overdueCount} overdue: show ${overdueCount === 1 ? "this player" : "these players"}`,
    }] : [],
  ]

  return (
    <CoachDashboardCard
      area="financials"
      status={active ? stamps : { state: "Setup" }}
      title="Financials"
      titleId="coach-financials-card-title"
    >
      {active ? (
        <div className={styles.layout}>
          <div className={styles.figures}>
            <CoachDashboardSummary detail={preparationState}>
              {summary}
            </CoachDashboardSummary>
            <dl className={styles.tiles} aria-label="Fees needing attention">
              {tiles.map((tile) => (
                <div
                  key={tile.label}
                  data-tone={tile.count === 0 ? "zero" : tile.attention ? "attention" : undefined}
                >
                  <dt>{tile.label}</dt>
                  <dd aria-label={`${tile.count} ${tile.label.toLowerCase()}`}>{tile.count}</dd>
                </div>
              ))}
            </dl>
            {/* A fee waiting on a booked training change is not issued until the
                change happens, so it is named instead of silently missing from "to issue". */}
            {preparation.waitingForChange > 0 ? (
              <p className={styles.waiting}>
                {preparation.waitingForChange} {preparation.waitingForChange === 1 ? "fee waits" : "fees wait"} for a booked training change.
              </p>
            ) : null}
          </div>
          <div className={styles.spread}>
            <CoachDashboardActions ariaLabel="Financial actions">
              <CoachDashboardAction href="/coach/financials/record" primary>
                Record payment
              </CoachDashboardAction>
              <CoachDashboardAction href={`/coach/financials/records?view=fees&mode=monthly&period=${period}`}>
                Fees
              </CoachDashboardAction>
            </CoachDashboardActions>
          </div>
        </div>
      ) : (
        <>
          <CoachDashboardSummary detail="Choose the first month to start.">
            Fees aren’t tracked yet
          </CoachDashboardSummary>
          <CoachDashboardActions ariaLabel="Financial actions">
            <CoachDashboardAction href={`/coach/financials?period=${period}`} primary>
              Start tracking fees
            </CoachDashboardAction>
          </CoachDashboardActions>
        </>
      )}
    </CoachDashboardCard>
  )
}
