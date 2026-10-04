import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, FileText } from "lucide-react"

import { PageIntro } from "@/components/page-intro"
import { Reveal } from "@/components/reveal"
import { PlayerAssessmentList } from "@/components/assessments/assessment-report"
import { ReportAccordion } from "@/components/reports/report-accordion"
import { listPublishedAssessmentsForPlayer } from "@/lib/assessments/queries"
import { portalRepository } from "@/lib/data"
import { getCurrentStudent } from "@/lib/student/current-student"

export const metadata = {
  title: "Reports",
}

export default async function ReportsPage() {
  const student = await getCurrentStudent()
  const reports = student
    ? await portalRepository.listReports(student.identity.playerId)
    : []
  const assessments = student
    ? listPublishedAssessmentsForPlayer(student.identity.playerId)
    : []

  if (!student) redirect("/login")

  return (
    <div className="reports-page interior-page page-shell">
      <div className="reports-toolbar">
        <Link className="back-link" href="/player">
          <ArrowLeft aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>

      <PageIntro
        eyebrow="Reports"
        title="Your progress."
      />

      {assessments.length > 0 ? (
        <Reveal>
          <PlayerAssessmentList assessments={assessments} />
        </Reveal>
      ) : null}

      {reports.length === 0 && assessments.length === 0 ? (
        <section className="empty-state">
          <FileText aria-hidden="true" />
          <h2>No reports yet.</h2>
          <p>Your coach’s first assessment will appear here once it is published.</p>
        </section>
      ) : reports.length === 0 ? null : (
        <section className="reports-ledger" aria-label="Report archive">
          <Reveal>
            <ReportAccordion playerName={student.identity.fullName} reports={reports} />
          </Reveal>
        </section>
      )}
    </div>
  )
}
