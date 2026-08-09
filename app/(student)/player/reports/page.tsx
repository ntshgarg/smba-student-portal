import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, FileText } from "lucide-react"

import { PageIntro } from "@/components/page-intro"
import { Reveal } from "@/components/reveal"
import { ReportAccordion } from "@/components/reports/report-accordion"
import { portalRepository } from "@/lib/data"
import { getCurrentStudent } from "@/lib/student/current-student"

export const metadata = {
  title: "Monthly reports",
}

export default async function ReportsPage() {
  const student = await getCurrentStudent()
  const reports = student
    ? await portalRepository.listReports(student.identity.playerId)
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
        eyebrow="Monthly reports"
        title="Your progress, month by month."
      />

      {reports.length === 0 ? (
        <section className="empty-state">
          <FileText aria-hidden="true" />
          <h2>No reports yet.</h2>
          <p>Your coach’s first monthly feedback will appear here once it is published.</p>
        </section>
      ) : (
        <section className="reports-ledger" aria-label="Report archive">
          <Reveal>
            <ReportAccordion playerName={student.identity.fullName} reports={reports} />
          </Reveal>
        </section>
      )}
    </div>
  )
}
