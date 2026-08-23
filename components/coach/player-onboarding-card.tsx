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

  return (
    <CoachDashboardCard
      area="onboarding"
      id="onboarding"
      status={summary.total
        ? { count: summary.total, unit: "in progress" }
        : { state: "Clear" }}
      title="Academy onboarding"
      titleId="player-onboarding-card-title"
    >
      <div className={styles.layout}>
        <CoachDashboardSummary
          detail="Approve staff access and move players through assessment, session and Fee Plan."
        >
          {summary.total ? `${summary.total} ${accountLabel} a next step` : "Academy onboarding is complete"}
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
