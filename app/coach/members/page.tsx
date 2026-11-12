import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import { MemberTrainingProvider } from "@/components/coach/members/directory/member-training-context"
import { MemberDirectory } from "@/components/coach/members/member-directory"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyNow } from "@/lib/clock"
import {
  getCoachSessionSnapshot,
  listApprovedPlayerRecords,
  listApprovedStaffRecords,
} from "@/lib/coach/database"
import { getAcademyDateKey } from "@/lib/format"
import { listMemberTrainingSummaries } from "@/lib/training/member-summaries"

export const metadata = {
  title: "Member Directory",
}

export default async function CoachMembersPage() {
  await requireHeadAdminPage()
  // One academy "now" for the whole page, so each player's status, the fee
  // lines and the labels on finished schedules all agree on what today is.
  const now = academyNow()
  const today = getAcademyDateKey(now)
  const players = listApprovedPlayerRecords(today)
  const sessions = getCoachSessionSnapshot(today)
  const staff = listApprovedStaffRecords()
  const training = listMemberTrainingSummaries(players.members.map((member) => member.id), { now })

  return (
    <CoachPortalProvider
      initialMembers={players.members}
      initialSessionAssignments={sessions.sessionAssignments}
      initialSessionSeries={sessions.sessionSeries}
      initialTrainingProfiles={players.trainingProfiles}
    >
      <MemberTrainingProvider value={training}>
        <MemberDirectory staff={staff} />
      </MemberTrainingProvider>
    </CoachPortalProvider>
  )
}
