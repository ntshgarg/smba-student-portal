import { redirect } from "next/navigation"

import { SessionCalendar } from "@/components/coach/calendar/session-calendar"
import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import { isValidDateKey } from "@/lib/attendance/domain"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyNow } from "@/lib/clock"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import { getCoachCalendarMonthSnapshot } from "@/lib/coach/session-read-models"

export const metadata = { title: "Training calendar" }

export default async function CoachCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>
}) {
  await requireHeadAdminPage()
  const query = await searchParams
  const now = academyNow()
  const today = getIndiaDateKey(now)
  const requestedDate = Array.isArray(query.date) ? query.date[0] : query.date
  if (!requestedDate || !isValidDateKey(requestedDate)) {
    redirect(`/coach/calendar?date=${encodeURIComponent(today)}`)
  }
  const selectedMonth = requestedDate.slice(0, 7)
  const snapshot = getCoachCalendarMonthSnapshot(selectedMonth)

  return (
    <CoachPortalProvider
      key={selectedMonth}
      initialAttendanceAdjustments={[]}
      initialAttendanceRecords={{}}
      initialMembers={snapshot.members}
      initialReports={[]}
      initialSessionAssignments={snapshot.sessionAssignments}
      initialSessionOccurrences={snapshot.sessionOccurrences}
      initialSessionSeries={snapshot.sessionSeries}
      initialTrainingProfiles={snapshot.trainingProfiles}
    >
      <SessionCalendar
        referenceDate={today}
        referenceInstant={now.getTime()}
        selectedDate={requestedDate}
      />
    </CoachPortalProvider>
  )
}
