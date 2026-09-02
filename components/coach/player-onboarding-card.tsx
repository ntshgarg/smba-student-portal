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

function displayCount(value: number) {
  return String(value).padStart(2, "0")
}

export function PlayerOnboardingCard({
  summary,
}: {
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
      status={summary.total
        ? { count: summary.total, unit: "in progress" }
        : notStarted ? { state: "Setup" } : { state: "Clear" }}
      title="Academy onboarding"
      titleId="player-onboarding-card-title"
    >
      <div className={styles.layout}>
        <CoachDashboardSummary
          detail={notStarted
            ? "Players and assistant coaches request access themselves. Their requests arrive here for approval, assessment, session and Fee Plan."
            : "Approve staff access and move players through assessment, session and Fee Plan."}
        >
          {summary.total
            ? `${summary.total} ${accountLabel} a next step`
            : notStarted ? "No one to onboard yet" : "Academy onboarding is complete"}
        </CoachDashboardSummary>

        <dl className={styles.stages} aria-label="Academy onboarding stages">
          {stages.map(({ key, label }) => (
            <div key={key} className={styles.stage}>
              <dt>{label}</dt>
              <dd aria-label={`${summary[key]} ${label.toLowerCase()}`}>
                {displayCount(summary[key])}
              </dd>
            </div>
          ))}
        </dl>

        <CoachDashboardActions ariaLabel="Academy onboarding actions">
          <CoachDashboardAction href="/coach/onboarding">Open onboarding</CoachDashboardAction>
        </CoachDashboardActions>
      </div>
    </CoachDashboardCard>
  )
}
