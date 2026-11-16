import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardFigures,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"

import styles from "./sessions-card.module.css"

export type SessionsCardNext = {
  /** "7:00 pm" */
  time: string
  /** "Adult · Weekday · SMBA Court", or "Tue 17 Nov · Intermediate · Weekday" for a later day */
  label: string
}

/**
 * Sessions on the dashboard (head coach, 16 Nov 2026), beside Financials and
 * built from the same parts so the pair matches: today's count, the next
 * session, three tiles and the two Sessions tabs. A brand-new academy with
 * nothing scheduled gets Setup and one way in, Create schedule.
 */
export function SessionsCard({
  cancelledThisWeek,
  leftToday,
  next,
  runningSchedules,
  todaySessionCount,
}: {
  cancelledThisWeek: number
  /** Today's sessions that have not started yet. */
  leftToday: number
  next: SessionsCardNext | null
  runningSchedules: number
  todaySessionCount: number
}) {
  const setup = !todaySessionCount && !next
  return (
    <CoachDashboardCard
      area="sessions"
      status={todaySessionCount
        ? { count: todaySessionCount, unit: "today" }
        : setup ? { state: "Setup" } : undefined}
      title="Sessions"
      titleId="coach-sessions-card-title"
    >
      {setup ? (
        <>
          <CoachDashboardSummary detail="Create the first recurring schedule.">
            No training scheduled yet
          </CoachDashboardSummary>
          <CoachDashboardActions ariaLabel="Session actions">
            <CoachDashboardAction href="/coach/schedules/new" primary>Create schedule</CoachDashboardAction>
          </CoachDashboardActions>
        </>
      ) : (
        <CoachDashboardFigures
          actions={(
            <CoachDashboardActions ariaLabel="Session actions">
              <CoachDashboardAction href="/coach/calendar">Calendar</CoachDashboardAction>
              <CoachDashboardAction href="/coach/schedules">Schedules</CoachDashboardAction>
            </CoachDashboardActions>
          )}
          label="This week's sessions"
          summary={(
            <CoachDashboardSummary
              detail={next ? (
                <>Next <span className={styles.time}>{next.time}</span> {next.label}</>
              ) : "No more sessions scheduled."}
            >
              {todaySessionCount
                ? `${todaySessionCount} ${todaySessionCount === 1 ? "session" : "sessions"} today`
                : "No sessions today"}
            </CoachDashboardSummary>
          )}
          tiles={[
            { count: leftToday, label: "Left today" },
            { count: runningSchedules, label: "Schedules" },
            { count: cancelledThisWeek, label: "Cancelled this week", attention: true },
          ]}
        />
      )}
    </CoachDashboardCard>
  )
}
