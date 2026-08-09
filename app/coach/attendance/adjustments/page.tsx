import { ArrowLeft } from "lucide-react"
import Link from "next/link"

import { AttendanceAdjustmentsWorkspace } from "@/components/coach/attendance-adjustments-workspace"
import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import { listAttendanceAdjustments } from "@/lib/attendance/adjustments"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { getCoachSessionSnapshot, listOperationalPlayerRecords } from "@/lib/coach/database"
import { listSessionAttendanceRecords } from "@/lib/sessions/database"

export const metadata = {
  title: "Reschedule attendance",
}

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AttendanceAdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    adjustment?: string | string[]
    player?: string | string[]
  }>
}) {
  await requireHeadAdminPage()
  const query = await searchParams
  const adjustment = firstSearchValue(query.adjustment)
  const player = firstSearchValue(query.player)
  const players = listOperationalPlayerRecords()
  const sessions = getCoachSessionSnapshot()

  return (
    <CoachPortalProvider
      initialAttendanceAdjustments={listAttendanceAdjustments({ includeVoided: true })}
      initialAttendanceRecords={listSessionAttendanceRecords()}
      initialMembers={players.members}
      initialPendingRegistrations={[]}
      initialReports={[]}
      initialSessionAssignments={[]}
      initialSessionOccurrences={sessions.sessionOccurrences}
      initialSessionSeries={sessions.sessionSeries}
      initialTrainingProfiles={players.trainingProfiles}
    >
      <div className="coach-calendar coach-attendance-workspace page-shell">
        <nav className="coach-calendar-back-row coach-route-nav" aria-label="Attendance navigation">
          <Link href="/coach#attendance">
            <ArrowLeft aria-hidden="true" /> Back to Attendance
          </Link>
        </nav>

        <header className="coach-calendar-header">
          <div>
            <span className="eyebrow">Attendance register</span>
            <h1 id="reschedule-attendance-title">Reschedule attendance</h1>
          </div>
        </header>

        <article className="coach-attendance-card is-workspace">
          <AttendanceAdjustmentsWorkspace
            id="attendance-adjustments-workspace"
            labelledBy="reschedule-attendance-title"
            initialAdjustmentId={adjustment}
            initialPlayerId={player}
          />
        </article>
      </div>
    </CoachPortalProvider>
  )
}
