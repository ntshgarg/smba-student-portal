import { ArrowLeft } from "lucide-react"
import Link from "next/link"

import styles from "@/components/assessments/assessments.module.css"
import type { AssessmentRecord } from "@/lib/assessments/contracts"
import { formatAssessmentDate } from "@/lib/assessments/display"
import { formatRating } from "@/lib/assessments/rubric"

export function AssessmentHistory({
  assessments,
  playerId,
  playerName,
}: {
  assessments: AssessmentRecord[]
  playerId: string
  playerName: string
}) {
  return (
    <div className={`${styles.page} page-shell`}>
      <div className={styles.backRow}>
        <Link href="/coach/assessments">
          <ArrowLeft aria-hidden="true" />
          All assessments
        </Link>
      </div>

      <header className={styles.header}>
        <div>
          <span className="eyebrow">Assessment history</span>
          <h1>{playerName}</h1>
        </div>
        <Link
          className={`${styles.button} ${styles.primary}`}
          href={`/coach/assessments/new?player=${encodeURIComponent(playerId)}`}
        >
          New assessment
        </Link>
      </header>

      <section className={styles.card} style={{ marginTop: 40 }} aria-label="Assessments">
        {assessments.length === 0
          ? <p className={styles.empty}>No assessments yet.</p>
          : (
            <ul className={styles.historyList}>
              {assessments.map((assessment) => (
                <li className={styles.historyRow} key={assessment.id}>
                  <div>
                    <strong>{formatAssessmentDate(assessment.assessedOn)}</strong>
                    <span className={styles.rowMeta}>
                      {assessment.status === "draft"
                        ? <span className={styles.tag}>Draft</span>
                        : assessment.revision > 1
                          ? `Published · updated ${assessment.revision - 1} ${assessment.revision === 2 ? "time" : "times"}`
                          : "Published"}
                    </span>
                  </div>
                  <span className={styles.score}>
                    {formatRating(assessment.overall)}<small> / 5</small>
                  </span>
                  <Link className={styles.button} href={`/coach/assessments/${assessment.id}`}>
                    {assessment.status === "draft" ? "Continue" : "Open"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}
