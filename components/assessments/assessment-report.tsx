import { ArrowLeft } from "lucide-react"
import Link from "next/link"

import styles from "@/components/assessments/assessments.module.css"
import type { AssessmentRecord } from "@/lib/assessments/contracts"
import { formatAssessmentDate, formatChange, sectionTone } from "@/lib/assessments/display"
import type { PreviousAssessment } from "@/lib/assessments/queries"
import {
  ASSESSMENT_RATING_LABELS,
  ASSESSMENT_RATING_MAX,
  ASSESSMENT_SECTIONS,
  formatRating,
  sectionRating,
} from "@/lib/assessments/rubric"

function changeClass(change: number) {
  if (Math.abs(change) < 0.05) return styles.deltaFlat
  return change < 0 ? styles.deltaDown : ""
}

/** The player's list of published assessments, newest first, on their reports page. */
export function PlayerAssessmentList({ assessments }: { assessments: AssessmentRecord[] }) {
  return (
    <section className={`${styles.card} ${styles.assessmentsBlock}`} aria-label="Coach assessments">
      <span className={styles.label}>Coach assessments</span>
      <ul className={styles.assessmentList} style={{ marginTop: 8 }}>
        {assessments.map((assessment) => (
          <li className={styles.assessmentItem} key={assessment.id}>
            <div>
              <strong>{formatAssessmentDate(assessment.assessedOn)}</strong>
              <span className={styles.rowMeta}>Coach assessment</span>
            </div>
            <span className={styles.score}>
              {formatRating(assessment.overall)}<small> / 5</small>
            </span>
            <Link className={styles.textLink} href={`/player/reports/assessments/${assessment.id}`}>
              Open
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One published assessment as the player reads it: the score, how it moved, and the coach's words. */
export function PlayerAssessmentReport({
  assessment,
  previous,
}: {
  assessment: AssessmentRecord
  previous: PreviousAssessment | null
}) {
  const overallChange = previous && previous.overall !== null && assessment.overall !== null
    ? assessment.overall - previous.overall
    : null
  const feedback = [
    ["Strengths", assessment.strengths],
    ["To work on", assessment.improvements],
    ["From your coach", assessment.comments],
  ].filter(([, text]) => text.trim().length > 0)

  return (
    <div className={`${styles.page} page-shell`}>
      <div className={styles.backRow}>
        <Link href="/player/reports">
          <ArrowLeft aria-hidden="true" />
          Back to reports
        </Link>
      </div>

      <header className={styles.header}>
        <div>
          <span className="eyebrow">Coach assessment</span>
          <h1>{formatAssessmentDate(assessment.assessedOn)}</h1>
        </div>
      </header>

      <section className={`${styles.card} ${styles.reportHero}`} aria-label="Overall rating">
        <div>
          <span className={styles.label}>Overall rating</span>
          <div className={styles.bigNumber}>
            <span>{formatRating(assessment.overall)}</span><small>/ 5.0</small>
          </div>
        </div>
        <div className={styles.heroBar}>
          <div className={styles.meter} aria-hidden="true">
            <i style={{ width: `${((assessment.overall ?? 0) / ASSESSMENT_RATING_MAX) * 100}%` }} />
          </div>
          <p className={`${styles.delta} ${overallChange === null ? styles.deltaFlat : changeClass(overallChange)}`}>
            {previous && overallChange !== null
              ? `${formatChange(overallChange)} since ${formatAssessmentDate(previous.assessedOn)}`
              : "Your first assessment. Next time you will see how you have moved."}
          </p>
        </div>
      </section>

      {ASSESSMENT_SECTIONS.map((section) => {
        const rated = section.skills.filter((skill) => assessment.ratings[skill.key] !== undefined)
        if (rated.length === 0) return null
        return (
          <section
            className={`${styles.card} ${styles.readSection}`}
            key={section.id}
            style={{ "--tone": sectionTone(section) } as React.CSSProperties}
          >
            <h2>
              <i aria-hidden="true" />
              {section.title}
              <span>{formatRating(sectionRating(section, assessment.ratings))}</span>
            </h2>
            {rated.map((skill) => {
              const score = assessment.ratings[skill.key]
              const before = previous?.ratings[skill.key]
              const change = before === undefined ? null : score - before
              return (
                <div className={styles.readSkill} key={skill.key}>
                  <div>
                    <b>{skill.label}</b>
                    <small>
                      {ASSESSMENT_RATING_LABELS[score]}
                      {change !== null ? ` · ${formatChange(change)}` : ""}
                    </small>
                  </div>
                  <span className={styles.readScore}>{score} / {ASSESSMENT_RATING_MAX}</span>
                  <div className={styles.meter} aria-hidden="true">
                    <i style={{ width: `${(score / ASSESSMENT_RATING_MAX) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}

      {feedback.length > 0
        ? (
          <section className={`${styles.card} ${styles.readSection}`} aria-label="Coach feedback">
            <h2>From Coach Sathiya</h2>
            {feedback.map(([title, text]) => (
              <div className={styles.readText} key={title}>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </section>
        )
        : null}
    </div>
  )
}
