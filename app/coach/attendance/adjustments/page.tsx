import { ArrowLeft } from "lucide-react"
import Link from "next/link"

import { AttendanceAdjustmentsWorkspace } from "@/components/coach/attendance-adjustments-workspace"
import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { getCoachAttendanceAdjustmentsSnapshot } from "@/lib/coach/session-read-models"

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
    history?: string | string[]
    player?: string | string[]
  }>
}) {
  await requireHeadAdminPage()
  const query = await searchParams
  const adjustment = firstSearchValue(query.adjustment)
  const historyOpen = firstSearchValue(query.history) === "open"
  const player = firstSearchValue(query.player)
  const snapshot = getCoachAttendanceAdjustmentsSnapshot({ adjustmentId: adjustment, playerId: player })

  return (
    <CoachPortalProvider
      initialAttendanceAdjustments={snapshot.attendanceAdjustments}
      initialAttendanceRecords={snapshot.attendanceRecords}
      initialMembers={snapshot.members}
      initialReports={[]}
      initialSessionAssignments={snapshot.sessionAssignments}
      initialSessionOccurrences={snapshot.sessionOccurrences}
      initialSessionSeries={snapshot.sessionSeries}
      initialTrainingProfiles={snapshot.trainingProfiles}
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
            key={`${snapshot.selectedPlayerId ?? "none"}:${adjustment ?? "none"}`}
            id="attendance-adjustments-workspace"
            labelledBy="reschedule-attendance-title"
            initialAdjustmentId={adjustment}
            initialHistoryOpen={historyOpen}
            initialPlayerId={snapshot.selectedPlayerId ?? undefined}
          />
        </article>
      </div>
    </CoachPortalProvider>
  )
}
