import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"

import styles from "./attendance-card.module.css"

type Tally = { marked: number; total: number }

/**
 * Today at a glance. Mark, Register and Make-ups are the tabs of the one
 * Attendance page, so the card opens each of them rather than listing the old
 * player and staff screens one by one.
 */
export function AttendanceCard({
  dateLabel,
  makeupsToReview,
  sessions,
  staff,
}: {
  /** today, as the dashboard hero writes it ("Monday, 16 November") */
  dateLabel: string
  makeupsToReview: number
  sessions: Tally
  /** assistant coaches on today's roll call; none on a day the academy is closed */
  staff: Tally
}) {
  const sessionsLeft = sessions.total - sessions.marked
  const staffState = staff.total === 0
    ? null
    : staff.marked === staff.total ? "staff roll call done" : "staff not marked yet"

  return (
    <CoachDashboardCard
      area="attendance"
      status={sessions.total === 0
        ? undefined
        : sessionsLeft > 0
          ? {
            count: sessionsLeft,
            unit: sessionsLeft === 1 ? "session left today" : "sessions left today",
            tone: "attention",
          }
          : { state: "All marked" }}
      title="Attendance"
      titleId="attendance-card-title"
    >
      <div className={styles.layout}>
        <div className={styles.today}>
          <CoachDashboardSummary
            detail={staffState ? `${dateLabel} · ${staffState}` : dateLabel}
          >
            {sessions.total === 0
              ? "No sessions today"
              : `${sessions.marked} of ${sessions.total} sessions marked`}
          </CoachDashboardSummary>

          {sessions.total ? (
            <div className={styles.bar} aria-hidden="true">
              <i style={{ width: `${(sessions.marked / sessions.total) * 100}%` }} />
            </div>
          ) : null}

          <dl className={styles.counts} aria-label="Today's attendance">
            <div>
              <dt>Sessions</dt>
              <dd>{sessions.marked}/{sessions.total}</dd>
            </div>
            <div>
              <dt>Staff</dt>
              <dd>{staff.marked}/{staff.total}</dd>
            </div>
            <div>
              <dt>{makeupsToReview === 1 ? "Make-up to review" : "Make-ups to review"}</dt>
              <dd>{makeupsToReview}</dd>
            </div>
          </dl>
        </div>

        <CoachDashboardActions ariaLabel="Attendance actions">
          <CoachDashboardAction href="/coach/attendance/players/record" primary={sessionsLeft > 0}>
            Mark today&apos;s attendance
          </CoachDashboardAction>
          <CoachDashboardAction href="/coach/attendance/players/register">Register</CoachDashboardAction>
          <CoachDashboardAction href="/coach/attendance/adjustments">Make-ups</CoachDashboardAction>
        </CoachDashboardActions>
      </div>
    </CoachDashboardCard>
  )
}
