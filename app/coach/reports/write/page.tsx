import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import { ReportWritingWorkspace } from "@/components/coach/reports/report-workspace"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyNow } from "@/lib/clock"
import {
  getCurrentIndiaMonth,
  getLatestCompletedReportMonth,
} from "@/lib/coach/report-utils"
import { getCoachReportWritingSnapshot } from "@/lib/coach/session-read-models"

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
  const now = academyNow()
  const selectedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month ?? "")
    && (query.month as string) < getCurrentIndiaMonth(now)
    ? query.month as string
    : getLatestCompletedReportMonth(now)
  const snapshot = getCoachReportWritingSnapshot(selectedMonth)

  return (
    <CoachPortalProvider
      initialAttendanceAdjustments={snapshot.attendanceAdjustments}
      initialAttendanceRecords={snapshot.attendanceRecords}
      initialMembers={snapshot.members}
      initialReports={snapshot.reports}
      initialSessionAssignments={snapshot.sessionAssignments}
      initialSessionOccurrences={snapshot.sessionOccurrences}
      initialTrainingProfiles={snapshot.trainingProfiles}
    >
      <ReportWritingWorkspace
        key={selectedMonth}
        coach={{
          id: identity.subjectId,
          firstName: identity.firstName,
          fullName: identity.fullName,
          initials: identity.initials,
        }}
        initialMonth={selectedMonth}
        initialPlayerId={query.player}
      />
    </CoachPortalProvider>
  )
}
