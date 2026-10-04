"use client"

import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import {
  discardAssessmentDraftAction,
  publishAssessmentAction,
  saveAssessmentDraftAction,
} from "@/app/coach/assessments/actions"
import styles from "@/components/assessments/assessments.module.css"
import {
  InlineNotice,
  type ActionFeedback,
  type InlineNoticeAction,
} from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import type {
  AssessmentRecord,
  SaveAssessmentInput,
} from "@/lib/assessments/contracts"
import { formatAssessmentDate, sectionTone } from "@/lib/assessments/display"
import type { PreviousAssessment } from "@/lib/assessments/queries"
import {
  ASSESSMENT_RATING_LABELS,
  ASSESSMENT_SECTIONS,
  ASSESSMENT_SKILL_COUNT,
  ASSESSMENT_TEXT_MAX_LENGTH,
  countRated,
  formatRating,
  overallRating,
} from "@/lib/assessments/rubric"

type FormValues = {
  assessedOn: string
  comments: string
  improvements: string
  ratings: Record<string, number>
  strengths: string
}

type FormPlayer = {
  group: string | null
  name: string
  playerId: string
}

const SNAP_MILLISECONDS = 180

type Notice = ActionFeedback & { action?: InlineNoticeAction }

function fillFor(position: number) {
  // The thumb's centre travels from half a thumb in to half a thumb short of the
  // end, so the filled part of the track has to be measured the same way or it
  // visibly leads or trails the thumb at either extreme.
  return `calc(14px + (100% - 28px) * ${(position - 1) / 4})`
}

function serialise(values: FormValues) {
  return JSON.stringify({
    ...values,
    ratings: Object.fromEntries(Object.entries(values.ratings).sort(([a], [b]) => a.localeCompare(b))),
  })
}

/**
 * A 1 to 5 slider that follows the finger smoothly and settles on a whole score
 * when let go. The rating itself is always whole: only the thumb moves between
 * stops, and `onRate` is told the nearest score as it goes so the overall rating
 * and the label keep up with the drag.
 *
 * Until it is touched a slider is "Not logged", not 3: the thumb rests in the
 * middle but the coach has said nothing, and the template's overall rating must
 * only average what was actually rated.
 */
function RatingSlider({
  hint,
  label,
  skillKey,
  onClear,
  onRate,
  previous,
  tone,
  value,
}: {
  hint: string
  label: string
  skillKey: string
  onClear: () => void
  onRate: (rating: number) => void
  previous: number | undefined
  tone: string
  value: number | undefined
}) {
  const [position, setPosition] = useState(value ?? 3)
  const positionRef = useRef(position)
  const frameRef = useRef(0)
  const rated = value !== undefined

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  function move(next: number) {
    positionRef.current = next
    setPosition(next)
  }

  function snap() {
    cancelAnimationFrame(frameRef.current)
    const from = positionRef.current
    const to = Math.round(from)
    if (from === to) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      move(to)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / SNAP_MILLISECONDS)
      move(from + (to - from) * (1 - (1 - progress) ** 3))
      if (progress < 1) frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
  }

  function release() {
    // Letting go without having dragged still counts: tapping the thumb where
    // it rests is how a coach says "Good".
    if (!rated) onRate(Math.round(positionRef.current))
    snap()
  }

  const shown = Math.round(position)

  return (
    <div className={styles.skillRow}>
      <div>
        <span className={styles.skillName}>{label}</span>
        <span className={styles.skillHint}>{hint}</span>
      </div>
      <div className={`${styles.value} ${rated ? styles.valueSet : ""}`}>
        {rated ? `${shown} · ${ASSESSMENT_RATING_LABELS[shown]}` : "Not logged"}
        <em>
          {previous !== undefined ? `Last time: ${previous}` : " "}
          {rated
            ? (
              <>
                {previous !== undefined ? " · " : ""}
                <button className={styles.textLink} type="button" onClick={onClear}>Clear</button>
              </>
            )
            : null}
        </em>
      </div>
      <div className={styles.slide} style={{ "--tone": tone } as React.CSSProperties}>
        <input
          name={`rating-${skillKey}`}
          aria-label={label}
          aria-valuetext={rated ? `${shown} of 5, ${ASSESSMENT_RATING_LABELS[shown]}` : "Not logged"}
          className={`${styles.slider} ${rated ? styles.sliderSet : ""}`}
          max={5}
          min={1}
          onBlur={snap}
          onChange={(event) => {
            cancelAnimationFrame(frameRef.current)
            const next = Number(event.target.value)
            move(next)
            onRate(Math.round(next))
          }}
          onKeyDown={(event) => {
            const step = event.key === "ArrowRight" || event.key === "ArrowUp"
              ? 1
              : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0
            if (step === 0) return
            event.preventDefault()
            const next = Math.min(5, Math.max(1, Math.round(positionRef.current) + step))
            cancelAnimationFrame(frameRef.current)
            move(next)
            onRate(next)
          }}
          onPointerUp={release}
          step={0.01}
          style={{ "--fill": fillFor(position) } as React.CSSProperties}
          type="range"
          value={position}
        />
        <div className={styles.ticks} aria-hidden="true">
          {[1, 2, 3, 4, 5].map((tick) => <span key={tick}>{tick}</span>)}
        </div>
        <div className={styles.ends} aria-hidden="true">
          <span>{ASSESSMENT_RATING_LABELS[1]}</span>
          <span>{ASSESSMENT_RATING_LABELS[5]}</span>
        </div>
      </div>
    </div>
  )
}

export function AssessmentForm({
  assessment,
  group,
  player,
  previous,
  today,
}: {
  assessment: AssessmentRecord | null
  group: string | null
  player: FormPlayer
  previous: PreviousAssessment | null
  today: string
}) {
  const initial: FormValues = {
    assessedOn: assessment?.assessedOn ?? today,
    comments: assessment?.comments ?? "",
    improvements: assessment?.improvements ?? "",
    ratings: assessment?.ratings ?? {},
    strengths: assessment?.strengths ?? "",
  }
  const [values, setValues] = useState<FormValues>(initial)
  const [saved, setSaved] = useState(() => serialise(initial))
  const [assessmentId, setAssessmentId] = useState(assessment?.id ?? null)
  const [published, setPublished] = useState(assessment?.status === "published")
  const [pending, setPending] = useState<"discard" | "draft" | "publish" | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [discarded, setDiscarded] = useState(false)

  const isDirty = !discarded && serialise(values) !== saved
  const { navigateAfterCommit } = useUnsavedWorkGuard({
    isDirty,
    message: "These assessment changes have not been saved. Leave and discard them?",
    scope: "assessment-form",
  })

  const rated = countRated(values.ratings)
  const overall = overallRating(values.ratings)
  const busy = pending !== null
  const firstName = player.name.split(" ")[0]

  function change(patch: Partial<FormValues>) {
    setValues((current) => ({ ...current, ...patch }))
    setNotice(null)
  }

  function setRating(key: string, rating: number | null) {
    setValues((current) => {
      const ratings = { ...current.ratings }
      if (rating === null) delete ratings[key]
      else ratings[key] = rating
      return { ...current, ratings }
    })
    setNotice(null)
  }

  function payload(): SaveAssessmentInput {
    return {
      ...(assessmentId ? { assessmentId } : {}),
      ...values,
      playerId: player.playerId,
    }
  }

  async function submit(kind: "draft" | "publish") {
    if (busy) return
    setPending(kind)
    setNotice(null)
    // What was sent is what is now saved, even if the coach keeps typing while
    // the request is out: comparing against the later values would mark edits
    // made mid-save as already saved.
    const submitted = serialise(values)
    try {
      const result = await (kind === "publish"
        ? publishAssessmentAction(payload())
        : saveAssessmentDraftAction(payload()))
      if (!result.ok) {
        setNotice({ message: result.message, tone: "error" })
        return
      }
      if ("discarded" in result) return
      setAssessmentId(result.assessment.id)
      setPublished(result.assessment.status === "published")
      setSaved(submitted)
      setNotice({
        message: kind === "publish"
          ? `Published. ${firstName} can now see this assessment.`
          : "Draft saved. Nothing reaches the player until you publish.",
        tone: "success",
      })
    } catch {
      setNotice({
        action: { href: "/login", label: "Sign in again" },
        message: "This could not be saved. Check your connection, or sign in again if it keeps happening.",
        tone: "error",
      })
    } finally {
      setPending(null)
    }
  }

  async function discard() {
    if (!assessmentId || busy) return
    setPending("discard")
    try {
      const result = await discardAssessmentDraftAction({ assessmentId, playerId: player.playerId })
      if (!result.ok) {
        setNotice({ message: result.message, tone: "error" })
        setConfirmingDiscard(false)
        return
      }
      setDiscarded(true)
      navigateAfterCommit(() => window.location.replace("/coach/assessments"))
    } catch {
      setNotice({ message: "The draft could not be discarded. Try again.", tone: "error" })
    } finally {
      setPending(null)
    }
  }

  const publishLabel = published ? "Update assessment" : "Publish to player"
  const publishing = pending === "publish"
  const canPublish = rated > 0 && !busy && (!published || isDirty)

  const actions = (
    <>
      {!published
        ? (
          <button
            className={styles.button}
            disabled={busy}
            onClick={() => void submit("draft")}
            type="button"
          >
            {pending === "draft" ? "Saving…" : "Save draft"}
          </button>
        )
        : null}
      <button
        className={`${styles.button} ${styles.primary}`}
        disabled={!canPublish}
        onClick={() => void submit("publish")}
        type="button"
      >
        {publishing ? "Publishing…" : publishLabel}
      </button>
    </>
  )

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
          <span className="eyebrow">{published ? "Published assessment" : "New assessment"}</span>
          <h1>{player.name}</h1>
        </div>
      </header>

      <div className={`${styles.card} ${styles.meta}`}>
        <div>
          <span className={styles.label}>Level / batch</span>
          <strong>{group ?? "Not assigned"}</strong>
        </div>
        <label className={styles.metaField}>
          <span className={styles.label}>Assessment date</span>
          <input
            name="assessedOn"
            max={today}
            onChange={(event) => change({ assessedOn: event.target.value })}
            required
            type="date"
            value={values.assessedOn}
          />
        </label>
        <div>
          <span className={styles.label}>Previous assessment</span>
          <strong>
            {previous
              ? `${formatAssessmentDate(previous.assessedOn)} · ${formatRating(previous.overall)}`
              : "None yet"}
          </strong>
        </div>
        <div>
          <span className={styles.label}>Status</span>
          <strong>{published ? "Published" : assessmentId ? "Draft saved" : "Not saved yet"}</strong>
        </div>
      </div>

      <div className={styles.layout}>
        <aside className={`${styles.card} ${styles.summary}`} aria-label="Assessment summary">
          <span className={styles.label}>Overall rating</span>
          <div className={styles.bigNumber} aria-live="polite">
            <span>{formatRating(overall)}</span><small>/ 5.0</small>
          </div>
          <div className={styles.progress} aria-hidden="true">
            <i style={{ "--done": rated / ASSESSMENT_SKILL_COUNT } as React.CSSProperties} />
          </div>
          <p>
            {rated} of {ASSESSMENT_SKILL_COUNT} rated. The overall rating is worked out from the scores you give.
          </p>
          <ul className={styles.jump}>
            {ASSESSMENT_SECTIONS.map((section) => {
              const done = section.skills.filter((skill) => values.ratings[skill.key] !== undefined).length
              return (
                <li className={done === section.skills.length ? styles.jumpDone : undefined} key={section.id}>
                  <a href={`#assessment-${section.id}`}>
                    {section.title.replace(" Performance", "").replace(" Assessment", "")}
                    <span>{done === section.skills.length ? "✓" : `${done}/${section.skills.length}`}</span>
                  </a>
                </li>
              )
            })}
          </ul>
          <div className={styles.summaryActions}>{actions}</div>
          <div className={styles.summaryButtons}>{actions}</div>
        </aside>

        <div>
          {ASSESSMENT_SECTIONS.map((section) => (
            <section
              className={styles.section}
              id={`assessment-${section.id}`}
              key={section.id}
              style={{ "--tone": sectionTone(section) } as React.CSSProperties}
            >
              <div className={styles.sectionHead}>
                <i aria-hidden="true" />
                <h2>{section.title}</h2>
                <span>{section.skills.length} {section.skills.length === 1 ? "skill" : "skills"}</span>
              </div>
              <div className={`${styles.card} ${styles.skills}`}>
                {section.skills.map((skill) => (
                  <RatingSlider
                    hint={skill.hint}
                    key={skill.key}
                    label={skill.label}
                    skillKey={skill.key}
                    onClear={() => setRating(skill.key, null)}
                    onRate={(rating) => setRating(skill.key, rating)}
                    previous={previous?.ratings[skill.key]}
                    tone={sectionTone(section)}
                    value={values.ratings[skill.key]}
                  />
                ))}
              </div>
            </section>
          ))}

          <section className={styles.section} style={{ "--tone": "var(--navy)" } as React.CSSProperties}>
            <div className={styles.sectionHead}>
              <i aria-hidden="true" />
              <h2>Coach’s feedback</h2>
              <span>Shown to the player</span>
            </div>
            <div className={`${styles.card} ${styles.feedback}`}>
              {([
                ["strengths", "Strengths demonstrated", "What went well"],
                ["improvements", "Areas for improvement", "What to work on next"],
                ["comments", "Overall comments", "Anything else for the player"],
              ] as const).map(([field, title, placeholder]) => (
                <label className={styles.field} key={field}>
                  <strong>{title}</strong>
                  <textarea
                    name={field}
                    maxLength={ASSESSMENT_TEXT_MAX_LENGTH}
                    onChange={(event) => change({ [field]: event.target.value })}
                    placeholder={placeholder}
                    value={values[field]}
                  />
                  {values[field].length > ASSESSMENT_TEXT_MAX_LENGTH * 0.8
                    ? <small>{values[field].length} / {ASSESSMENT_TEXT_MAX_LENGTH}</small>
                    : null}
                </label>
              ))}
            </div>

            <InlineNotice
              action={notice?.action}
              className={styles.notice}
              message={notice?.message}
              reserveSpace={false}
              tone={notice?.tone}
            />

            <div className={styles.footer}>
              <p>
                {published
                  ? `${firstName} can already see this assessment. Updating replaces what they see.`
                  : "Saved as a draft until you publish. Nothing reaches the player before then."}
              </p>
              {assessmentId && !published
                ? confirmingDiscard
                  ? (
                    <>
                      <button className={styles.button} disabled={busy} onClick={() => setConfirmingDiscard(false)} type="button">
                        Keep draft
                      </button>
                      <button className={styles.button} disabled={busy} onClick={() => void discard()} type="button">
                        {pending === "discard" ? "Discarding…" : "Yes, discard"}
                      </button>
                    </>
                  )
                  : (
                    <button className={styles.button} disabled={busy} onClick={() => setConfirmingDiscard(true)} type="button">
                      Discard draft
                    </button>
                  )
                : null}
              {actions}
            </div>
          </section>
        </div>
      </div>

      <div className={styles.mobileBar}>
        <InlineNotice
          action={notice?.action}
          message={notice?.message}
          reserveSpace={false}
          tone={notice?.tone}
        />
        <div className={styles.mobileTop}>
          <span>{rated} of {ASSESSMENT_SKILL_COUNT} rated</span>
          <b>{formatRating(overall)}<small> / 5.0</small></b>
        </div>
        <div className={styles.mobileButtons}>{actions}</div>
      </div>
    </div>
  )
}
