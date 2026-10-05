import { CoachPortalProvider } from "@/components/coach/coach-portal-provider"
import { MemberTrainingProvider } from "@/components/coach/members/directory/member-training-context"
import { MemberDirectory } from "@/components/coach/members/member-directory"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import {
  getCoachSessionSnapshot,
  listApprovedPlayerRecords,
  listApprovedStaffRecords,
} from "@/lib/coach/database"
import { listMemberTrainingSummaries } from "@/lib/training/member-summaries"

export const metadata = {
  title: "Member Directory",
}

export default async function CoachMembersPage() {
  await requireHeadAdminPage()
  const players = listApprovedPlayerRecords()
  const sessions = getCoachSessionSnapshot()
  const staff = listApprovedStaffRecords()
  const training = listMemberTrainingSummaries(players.members.map((member) => member.id))

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
