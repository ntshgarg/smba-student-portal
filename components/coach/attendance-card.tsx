import {
  CoachDashboardAction,
  CoachDashboardActions,
  CoachDashboardCard,
  CoachDashboardGroup,
  CoachDashboardGroups,
  CoachDashboardSecondaryAction,
  CoachDashboardSummary,
} from "@/components/coach/dashboard-card"

const playerAttendanceLinks = [
  { href: "/coach/attendance/players/register", label: "Attendance register" },
  { href: "/coach/attendance/players/record", label: "Record attendance" },
  { href: "/coach/attendance/adjustments", label: "Reschedule attendance" },
]

const staffAttendanceLinks = [
  { href: "/coach/attendance/staff/register", label: "Attendance register" },
  { href: "/coach/attendance/staff/record", label: "Staff roll call" },
]

export function AttendanceCard({ scheduleCount }: { scheduleCount: number }) {
  return (
    <CoachDashboardCard
      area="attendance"
      status={{
        count: scheduleCount,
        unit: scheduleCount === 1 ? "schedule" : "schedules",
      }}
      title="Attendance"
      titleId="attendance-card-title"
    >
      <CoachDashboardSummary detail="Current truth for every scheduled session and academy day.">
        Player &amp; staff registers
      </CoachDashboardSummary>

      <CoachDashboardGroups>
        <CoachDashboardGroup label="Players">
          <CoachDashboardActions ariaLabel="Player attendance actions">
            {playerAttendanceLinks.map((link) => (
              <CoachDashboardAction key={link.href} href={link.href}>
                {link.label}
              </CoachDashboardAction>
            ))}
          </CoachDashboardActions>
        </CoachDashboardGroup>

        <CoachDashboardGroup label="Staff">
          <CoachDashboardActions ariaLabel="Staff attendance actions">
            {staffAttendanceLinks.map((link) => (
              <CoachDashboardSecondaryAction key={link.href} href={link.href}>
                {link.label}
              </CoachDashboardSecondaryAction>
            ))}
          </CoachDashboardActions>
        </CoachDashboardGroup>
      </CoachDashboardGroups>
    </CoachDashboardCard>
  )
}
