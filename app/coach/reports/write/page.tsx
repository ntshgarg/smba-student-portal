import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import { ReportWritingWorkspace } from "@/components/coach/reports/report-workspace"
import { listAttendanceAdjustments } from "@/lib/attendance/adjustments"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import {
  getCoachSessionSnapshot,
  listOperationalPlayerRecords,
  listCoachMonthlyReports,
} from "@/lib/coach/database"
import { listSessionAttendanceRecords } from "@/lib/sessions/database"

export const metadata = {
  title: "Write reports",
}

export default async function CoachReportWritingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; player?: string }>
}) {
  const query = await searchParams
  const { identity } = await requireHeadAdminPage()
  const players = listOperationalPlayerRecords()
  const sessions = getCoachSessionSnapshot()

  return (
    <CoachPortalProvider
      initialAttendanceAdjustments={listAttendanceAdjustments({ includeVoided: true })}
      initialAttendanceRecords={listSessionAttendanceRecords()}
      initialMembers={players.members}
      initialReports={listCoachMonthlyReports()}
      initialSessionAssignments={sessions.sessionAssignments}
      initialSessionOccurrences={sessions.sessionOccurrences}
      initialTrainingProfiles={players.trainingProfiles}
    >
      <ReportWritingWorkspace
        coach={{
          id: identity.subjectId,
          firstName: identity.firstName,
          fullName: identity.fullName,
          initials: identity.initials,
        }}
        initialMonth={query.month}
        initialPlayerId={query.player}
      />
    </CoachPortalProvider>
  )
}
