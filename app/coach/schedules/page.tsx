import { SessionSchedules } from "@/components/coach/calendar/session-schedules"
import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import type { ScheduleGroupKey } from "@/components/coach/calendar/session-schedule-index"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyToday } from "@/lib/clock"
import { listOperationalPlayerRecords } from "@/lib/coach/database"
import { getCoachScheduleRosterSnapshot } from "@/lib/coach/session-read-models"

export const metadata = { title: "Schedules & rosters" }

export default async function CoachSchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{
    player?: string
    programme?: string
    series?: string
  }>
}) {
  await requireHeadAdminPage()
  const params = await searchParams
  const groups: ScheduleGroupKey[] = ["Beginner", "Intermediate", "Advanced", "Adult", "Elite", "finished"]
  // Which schedules have run out is decided against the academy's today, the
  // same one each player's "Term finished" status is read with.
  const today = academyToday()
  const players = listOperationalPlayerRecords(undefined, today)
  const sessions = getCoachScheduleRosterSnapshot()
  return (
    <CoachPortalProvider
      initialAttendanceAdjustments={[]}
      initialAttendanceRecords={{}}
      initialMembers={players.members}
      initialSessionAssignments={sessions.sessionAssignments}
      initialSessionOccurrences={[]}
      initialSessionSeries={sessions.sessionSeries}
      initialTrainingProfiles={players.trainingProfiles}
    >
      <SessionSchedules
        initialPlayerId={params.player ?? null}
        initialProgramme={groups.find((group) => group === params.programme) ?? null}
        initialSeriesId={params.series ?? null}
        today={today}
      />
    </CoachPortalProvider>
  )
}
