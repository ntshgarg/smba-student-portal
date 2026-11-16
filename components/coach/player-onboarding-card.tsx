import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"
import type { PlayerOnboardingSummary } from "@/lib/coach/onboarding"

import styles from "./player-onboarding-card.module.css"

const stages = [
  { key: "newRequests", label: "New requests" },
  { key: "assessment", label: "Assessment" },
  { key: "session", label: "Session" },
  { key: "feePlan", label: "Fee Plan" },
] as const

export function PlayerOnboardingCard({
  expiringRequests = 0,
  summary,
}: {
  /** Undecided or rejected requests deleted within a week (lib/telemetry/retention.ts). */
  expiringRequests?: number
  summary: PlayerOnboardingSummary
}) {
  const accountLabel = summary.total === 1 ? "person needs" : "people need"
  /*
   * Three states, not two. `total === 0` means "nothing outstanding", which is
   * true of an academy that has cleared its queue *and* of one that opened this
   * morning — and those deserve opposite words. Reporting the finished state to
   * a head coach on day one congratulates them for work nobody has started, on
   * the one card that should be pointing them at their first action, while
   * Sessions, Financials and Members all correctly read `Setup` on the same
   * screen.
   *
   * `onboarded` is what separates them: it counts players who have finished
   * every stage, so it is zero only before anyone has been through.
   */
  const notStarted = summary.total === 0 && summary.onboarded === 0

  return (
    <CoachDashboardCard
      area="onboarding"
      id="onboarding"
      // New requests are people waiting on the head coach, so they lead the stamp in the alert tone
      status={summary.newRequests
        ? { count: summary.newRequests, unit: "waiting", tone: "attention" }
        : summary.total
          ? { count: summary.total, unit: "in progress" }
          : notStarted ? { state: "Setup" } : undefined}
      title="Onboarding"
      titleId="player-onboarding-card-title"
    >
      <div className={styles.layout}>
        <div className={styles.queue}>
          <CoachDashboardSummary
            detail={notStarted
              ? "Players and assistant coaches request access themselves; their requests land here."
              : `${summary.onboarded} onboarded so far`}
          >
            {summary.total
              ? `${summary.total} ${accountLabel} a next step`
              : notStarted ? "No one to onboard yet" : "Everyone is onboarded"}
          </CoachDashboardSummary>

          {summary.total ? (
            <dl className={styles.stages} aria-label="Onboarding stages">
              {stages.map(({ key, label }) => (
                <div
                  key={key}
                  data-tone={summary[key] === 0 ? "zero" : key === "newRequests" ? "attention" : undefined}
                >
                  <dt>{label}</dt>
                  <dd aria-label={`${summary[key]} ${label.toLowerCase()}`}>{summary[key]}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {expiringRequests ? (
            <p className={styles.expiring}>
              {expiringRequests} join {expiringRequests === 1 ? "request" : "requests"} will be removed in 7 days.
              Decide {expiringRequests === 1 ? "it" : "them"}, or undo a rejection.
            </p>
          ) : null}
        </div>

        <CoachDashboardActions ariaLabel="Onboarding actions">
          <CoachDashboardAction href="/coach/onboarding" primary={summary.newRequests > 0 || expiringRequests > 0}>
            Open onboarding
          </CoachDashboardAction>
        </CoachDashboardActions>
      </div>
    </CoachDashboardCard>
  )
}
