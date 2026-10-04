import { AssessmentHome } from "@/components/assessments/assessment-home"
import { listAssessmentHome } from "@/lib/assessments/queries"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyNow } from "@/lib/clock"
import { getAcademyDateKey } from "@/lib/format"

export const metadata = {
  title: "Assessments",
}

export default async function CoachAssessmentsPage() {
  const { identity } = await requireHeadAdminPage()
  const { drafts, players } = listAssessmentHome(identity.subjectId)

  return (
    <AssessmentHome
      drafts={drafts}
      players={players}
      today={getAcademyDateKey(academyNow())}
    />
  )
}
