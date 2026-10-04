import { notFound } from "next/navigation"

import { AssessmentForm } from "@/components/assessments/assessment-form"
import { getCoachAssessment } from "@/lib/assessments/queries"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyNow } from "@/lib/clock"
import { getAcademyDateKey } from "@/lib/format"

export const metadata = {
  title: "Assessment",
}

export default async function CoachAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, { identity }] = await Promise.all([params, requireHeadAdminPage()])
  const loaded = getCoachAssessment(id, identity.subjectId)
  if (!loaded) notFound()

  return (
    <AssessmentForm
      // A different assessment is a different form, with its own slider positions.
      key={loaded.assessment.id}
      assessment={loaded.assessment}
      group={loaded.group}
      player={{
        group: loaded.group,
        name: loaded.assessment.playerName,
        playerId: loaded.assessment.playerId,
      }}
      previous={loaded.previous}
      today={getAcademyDateKey(academyNow())}
    />
  )
}
