import { redirect } from "next/navigation"

import { AttendanceShell } from "@/components/coach/attendance/attendance-shell"
import { PlayerAttendanceRecorder } from "@/components/coach/attendance/player-attendance-recorder"
import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import {
  playerAttendanceRecordHref,
  resolvePlayerAttendanceSelection,
  type PlayerAttendanceQuery,
} from "@/lib/attendance/recording-workspace"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyNow } from "@/lib/clock"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import { getCoachAttendanceRecorderSnapshot } from "@/lib/coach/session-read-models"
import {
  listJuniorCoachProfiles,
  listStaffAttendanceRecordsByCoach,
} from "@/lib/coach/staff-attendance"
import { listAcademyHolidaysInWindow } from "@/lib/sessions/database"

export const metadata = {
  title: "Mark attendance",
}

export default async function RecordPlayerAttendancePage({
  searchParams,
}: {
  searchParams: Promise<PlayerAttendanceQuery>
}) {
  const { identity } = await requireHeadAdminPage()
  const query = await searchParams
  const now = academyNow()
  const today = getIndiaDateKey(now)
  const requestedDate = Array.isArray(query.date) ? query.date[0] : query.date
  const referenceDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/u.test(requestedDate)
    ? requestedDate
    : today
  const snapshot = getCoachAttendanceRecorderSnapshot(referenceDate)
  const selection = resolvePlayerAttendanceSelection({
    occurrences: snapshot.sessionOccurrences,
    query,
    today,
  })

  if (selection.requiresCanonicalRedirect) {
    redirect(playerAttendanceRecordHref(selection))
  }

  // The day's staff roll call, the first card on the list.
  const juniorCoaches = listJuniorCoachProfiles({
    requesterAccountId: identity.subjectId,
  })
  const staffRecordsByCoach = listStaffAttendanceRecordsByCoach({
    requesterAccountId: identity.subjectId,
    coachAccountIds: juniorCoaches.map((coach) => coach.accountId),
    from: selection.dateKey,
    to: selection.dateKey,
  })

  return (
    <CoachPortalProvider
      initialAttendanceAdjustments={snapshot.attendanceAdjustments}
      initialAttendanceRecords={snapshot.attendanceRecords}
      initialMembers={snapshot.members}
      initialSessionAssignments={snapshot.sessionAssignments}
      initialSessionOccurrences={snapshot.sessionOccurrences}
      initialSessionSeries={snapshot.sessionSeries}
      initialTrainingProfiles={snapshot.trainingProfiles}
    >
      <AttendanceShell
        activeTab="mark"
        backHref={selection.fromCalendar
          ? `/coach/calendar?date=${encodeURIComponent(selection.dateKey)}`
          : undefined}
        backLabel={selection.fromCalendar ? "Back to calendar" : undefined}
      >
        <PlayerAttendanceRecorder
          key={`${selection.dateKey}:${selection.occurrenceId ?? "none"}:${selection.staffOpen ? "staff" : "sessions"}:${selection.fromCalendar ? "calendar" : "dashboard"}`}
          initialDate={selection.dateKey}
          initialFromCalendar={selection.fromCalendar}
          initialOccurrenceId={selection.occurrenceId}
          initialReferenceInstant={now.getTime()}
          initialStaffOpen={selection.staffOpen}
          staff={{
            closedFor: listAcademyHolidaysInWindow(selection.dateKey, selection.dateKey)[0]?.label
              ?? null,
            juniorCoaches: juniorCoaches.map((coach) => ({
              accountId: coach.accountId,
              fullName: coach.fullName,
              initials: coach.initials,
              joinedOn: coach.joinedOn,
            })),
            records: juniorCoaches.flatMap((coach) => (
              staffRecordsByCoach.get(coach.accountId) ?? []
            )).map((record) => ({
              choice: record.choice,
              coachAccountId: record.coachAccountId,
            })),
            referenceDate: today,
          }}
        />
      </AttendanceShell>
    </CoachPortalProvider>
  )
}
