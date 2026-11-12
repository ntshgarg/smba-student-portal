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
import {
  previousForDate,
  type AssessmentActionResult,
  type AssessmentRecord,
  type PreviousAssessmentOption,
  type SaveAssessmentInput,
} from "@/lib/assessments/contracts"
import { formatAssessmentDate, sectionTone } from "@/lib/assessments/display"
import { classifyNetworkFailure } from "@/lib/client/network-failure"
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

/**
 * What to say when a save got no answer. The request may have reached the
 * server and been saved before the connection dropped, so it is never called a
 * failure; and because every save carries the assessment's id, saving again
 * continues the same assessment rather than making a second copy.
 */
export function unconfirmedSaveNotice(error: unknown, isOnline?: boolean): Notice {
  const network = classifyNetworkFailure(error, isOnline)
  if (network === "offline") {
    return {
      message: "This device is offline, so the save may not have reached the academy."
        + " Your changes are still here. Save again when the connection returns; it will not make a second copy.",
      tone: "error",
    }
  }
  if (network === "unreachable") {
    return {
      message: "The connection dropped before the save was confirmed, so it may or may not have been saved."
        + " Your changes are still here. Saving again is safe; it will not make a second copy.",
      tone: "error",
    }
  }
  return {
    action: { href: "/login", label: "Sign in again" },
    message: "The save could not be confirmed. Your changes are still here, and saving again is safe."
      + " If it keeps happening, sign in again.",
    tone: "error",
  }
}

/**
 * What the form knows about its own assessment on the server, as far as a
 * refused save can change it. Kept together so `afterRefusal` can say what a
 * refusal means for the screen without a browser to run in.
 */
export type FormSaveState = {
  assessmentId: string | null
  /** How many published assessments the player had, as far as this form knows. */
  expectedPublishedCount: number | undefined
  /** A draft of the player's this form was told about, which a publish may go beside. */
  knownDraftId: string | null
  knownUpdatedAt: string | null
  newAssessmentId: string
  published: boolean
  /** The values last saved, serialised; "" once nothing on screen is saved. */
  saved: string
}

function assessmentHref(assessmentId: string) {
  return `/coach/assessments/${encodeURIComponent(assessmentId)}`
}

/**
 * What a refused save means for the form: what to tell the coach, and how the
 * form brings itself up to date so that the next press either goes through on
 * purpose or is not offered at all. A refusal that left the form as it was
 * would refuse the same press forever.
 *
 * Links open beside the form, because following one in place would ask the
 * coach to discard the work the refusal has just told them is still here.
 */
export function afterRefusal(
  state: FormSaveState,
  result: Extract<AssessmentActionResult, { ok: false }>,
  { firstName, kind, playerId, submitted }: {
    firstName: string
    kind: "draft" | "publish"
    playerId: string
    /** The values this save sent, serialised. */
    submitted: string
  },
): { notice: Notice; state: FormSaveState } {
  const historyAction: InlineNoticeAction = {
    href: `/coach/assessments/players/${encodeURIComponent(playerId)}`,
    label: `Open ${firstName}’s assessments`,
    newTab: true,
  }

  if (result.code === "NOT_FOUND" && state.assessmentId) {
    // Discarded somewhere else. The work on screen is kept, and the next save
    // makes it again under the same id: a discarded draft was never seen by
    // the player and nothing points at it, and the page this form is open on,
    // /coach/assessments/<id>, then still finds it when the save refreshes the
    // page, instead of answering "page not found" over the coach's work.
    return {
      notice: {
        message: `${result.message} Your work is still here; ${kind === "publish"
          ? `publishing again publishes it to ${firstName} as a new assessment`
          : "saving again keeps it as a new draft"}.`,
        tone: "error",
      },
      state: {
        ...state,
        assessmentId: null,
        knownUpdatedAt: null,
        newAssessmentId: state.assessmentId,
        published: false,
        saved: "",
      },
    }
  }

  if (result.code === "CHANGED_ELSEWHERE" && result.currentUpdatedAt && state.assessmentId) {
    const published = state.published || result.currentStatus === "published"
    if (submitted === state.saved) {
      // Nothing on screen is the coach's own work: the screen is only out of
      // date. It does not take on the newer version, so a stale screen can
      // never be saved over it; reloading costs nothing.
      return {
        notice: {
          action: { href: assessmentHref(state.assessmentId), label: "Reload" },
          message: `${result.message} Reload to see the latest version.`,
          tone: "error",
        },
        state: { ...state, published },
      }
    }
    // The coach has changes of their own. They are told what pressing again
    // does, and it now does it, rather than being sent away to "open the
    // latest version" -- leaving this screen is what would lose their work.
    return {
      notice: {
        action: { href: assessmentHref(state.assessmentId), label: "Open the latest version", newTab: true },
        message: `${result.message} Your changes are still here. ${published
          ? `Pressing Update assessment replaces that version with yours, and ${firstName} will see yours.`
          : "Saving again replaces that version with yours."}`,
        tone: "error",
      },
      state: { ...state, knownUpdatedAt: result.currentUpdatedAt, published },
    }
  }

  if (result.code === "CONFLICT") {
    const next = { ...state }
    // Published somewhere else: say so here too, so the screen stops showing a
    // draft and offers the update button instead.
    if (result.currentStatus === "published") {
      next.published = true
      if (result.currentUpdatedAt) next.knownUpdatedAt = result.currentUpdatedAt
    }
    // Told about once; the next press publishes this one anyway.
    if (result.currentPublishedCount !== undefined) {
      next.expectedPublishedCount = result.currentPublishedCount
    }
    if (result.currentDraftId) next.knownDraftId = result.currentDraftId
    return { notice: { action: historyAction, message: result.message, tone: "error" }, state: next }
  }

  return { notice: { message: result.message, tone: "error" }, state }
}

export function AssessmentForm({
  assessment,
  group,
  player,
  previousOptions,
  publishedCount,
  today,
}: {
  assessment: AssessmentRecord | null
  group: string | null
  player: FormPlayer
  /** Published assessments to compare against, newest first; see `previousForDate`. */
  previousOptions: PreviousAssessmentOption[]
  /** How many assessments the player had published when this opened. */
  publishedCount?: number
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
  /**
   * The id a brand-new assessment will have, chosen here so that a save repeated
   * after a dropped connection finds what the first attempt created.
   */
  const [newAssessmentId, setNewAssessmentId] = useState(() => globalThis.crypto.randomUUID())
  /**
   * When the assessment was last saved, as far as this screen knows. Null when
   * a save's answer was lost: this screen's own save may have moved it on, so
   * the "changed in another window" check is skipped once rather than raised
   * against the coach's own work.
   */
  const [knownUpdatedAt, setKnownUpdatedAt] = useState<string | null>(assessment?.updatedAt ?? null)
  /**
   * The published count this form opened with, kept rather than read from the
   * prop: saving a first draft refreshes the page with the count as it is now,
   * which would wave through a publish the count exists to catch. Moved on
   * only by a refusal that has told the coach why.
   */
  const [expectedPublishedCount, setExpectedPublishedCount] = useState(publishedCount)
  const [knownDraftId, setKnownDraftId] = useState<string | null>(null)
  const [savedDate, setSavedDate] = useState(initial.assessedOn)
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

  // Worked out from the date on screen, so backdating a new assessment compares
  // it with the one before that date rather than with the latest.
  // Never this assessment itself: after a first publish the page refreshes
  // with a list that includes it.
  const previous = previousForDate(previousOptions, values.assessedOn, assessmentId)
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
      ...(assessmentId
        ? { assessmentId }
        : { newAssessmentId, ...(knownDraftId ? { knownDraftId } : {}) }),
      // Every first publish is checked against it, a draft's as much as one
      // straight from a blank form.
      ...(!published && expectedPublishedCount !== undefined ? { expectedPublishedCount } : {}),
      ...(assessmentId && knownUpdatedAt ? { expectedUpdatedAt: knownUpdatedAt } : {}),
      ...values,
      playerId: player.playerId,
    }
  }

  const historyAction: InlineNoticeAction = {
    href: `/coach/assessments/players/${encodeURIComponent(player.playerId)}`,
    label: `Open ${firstName}’s assessments`,
    newTab: true,
  }

  function refusal(
    result: Extract<AssessmentActionResult, { ok: false }>,
    kind: "draft" | "publish",
    submitted: string,
  ): Notice {
    const { notice: told, state } = afterRefusal({
      assessmentId,
      expectedPublishedCount,
      knownDraftId,
      knownUpdatedAt,
      newAssessmentId,
      published,
      saved,
    }, result, { firstName, kind, playerId: player.playerId, submitted })
    setAssessmentId(state.assessmentId)
    setExpectedPublishedCount(state.expectedPublishedCount)
    setKnownDraftId(state.knownDraftId)
    setKnownUpdatedAt(state.knownUpdatedAt)
    setNewAssessmentId(state.newAssessmentId)
    setPublished(state.published)
    setSaved(state.saved)
    return told
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
        setNotice(refusal(result, kind, submitted))
        return
      }
      if ("discarded" in result) return
      setAssessmentId(result.assessment.id)
      setKnownUpdatedAt(result.assessment.updatedAt)
      setPublished(result.assessment.status === "published")
      setSaved(submitted)
      setSavedDate(result.assessment.assessedOn)
      setNotice({
        message: kind === "publish"
          ? `Published. ${firstName} can now see this assessment.`
          : "Draft saved. Nothing reaches the player until you publish.",
        tone: "success",
      })
    } catch (error) {
      setKnownUpdatedAt(null)
      setNotice(unconfirmedSaveNotice(error))
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
        if (result.code === "NOT_FOUND") {
          // Already gone, discarded somewhere else: what the coach asked for.
          setDiscarded(true)
          navigateAfterCommit(() => window.location.replace("/coach/assessments"))
          return
        }
        // Published somewhere else, so it stays on the record. The screen
        // stops calling it a draft, and the coach is pointed at the list.
        if (result.currentStatus === "published") setPublished(true)
        setNotice({ action: historyAction, message: result.message, tone: "error" })
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
  // Moving a published assessment to another date re-orders the player's
  // comparisons, theirs and this one's, so it is said before it is published.
  const dateMoved = published && values.assessedOn !== savedDate
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
        <div className={styles.metaField}>
          <label>
            <span className={styles.label}>Assessment date</span>
            <input
              aria-describedby={dateMoved ? "assessment-date-change" : undefined}
              name="assessedOn"
              max={today}
              onChange={(event) => change({ assessedOn: event.target.value })}
              required
              type="date"
              value={values.assessedOn}
            />
          </label>
          {/* Outside the label, so it describes the field rather than joining its name. */}
          {dateMoved
            ? (
              <small className={styles.metaNote} id="assessment-date-change">
                A new date also changes which assessments this one is compared with, for you and for {firstName}.
              </small>
            )
            : null}
        </div>
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
