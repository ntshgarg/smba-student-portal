"use client"

import { ArrowLeft, ArrowRight, Check, Send, X } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { publishAnnouncementAction } from "@/app/coach/announcements/actions"
import { announcementParagraphs } from "@/components/announcements/announcement-presentation"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure, withSaveDeadline } from "@/lib/client/network-failure"
import { formatDateKey } from "@/lib/format"

import {
  announcementChannelAudience,
  announcementChannelIsPublic,
  announcementChannelLabel,
  type AnnouncementChannel,
} from "./contracts"
import styles from "./announcements.module.css"

type FieldName = "title" | "content" | "channels" | "expiresOn"

type ComposerValues = {
  title: string
  content: string
  channels: AnnouncementChannel[]
  pinned: boolean
  expiresOn: string
}

const EMPTY_VALUES: ComposerValues = {
  title: "",
  content: "",
  channels: [],
  pinned: false,
  expiresOn: "",
}

/**
 * A publication is one small insert set, but the action revalidates nine paths
 * before it answers — every coach, player and public surface a notice can reach
 * — and then re-reads the announcement, so the response outlives the write. Set
 * alongside the player register's 20s rather than tuned under it: courtside
 * connections stall rather than fail, and this only has to beat an indefinite
 * hang. It is a deadline, not a cancellation — see `withSaveDeadline`.
 */
const publishDeadlineMs = 20_000

/**
 * Said on the composer, not in the dialog: by the time this is true the dialog
 * has gone and the coach is back in the editor with the message still in it.
 * The second sentence is the one that matters — the notice is already on every
 * channel it was addressed to, so publishing again is work, not insurance.
 */
const publishedAfterExitMessage = "Announcement published. The publish you left in"
  + " the review finished on its own, so the notice is live and does not need sending again."

function createMutationKey() {
  return globalThis.crypto.randomUUID()
}

/**
 * The announcement a publication key was minted for, canonicalised exactly the
 * way the server fingerprints it (lib/announcements/service.ts:90-99, sha256
 * over title, content, channels, pinned and expiresOn after the same
 * normalisation). Reference equality on `values` is not a substitute:
 * `updateValues` allocates a new object on every keystroke, so typing a
 * character and deleting it again would have reminted a key whose payload the
 * server would have recognised as the one already published — and a second key
 * for identical content is a second live notice that only a permanently audited
 * withdrawal can take down.
 */
function publicationPayload(values: ComposerValues) {
  return JSON.stringify({
    channels: [...new Set(values.channels)].sort(),
    content: values.content.replace(/\r\n?/gu, "\n").trim(),
    expiresOn: values.expiresOn.trim() || null,
    pinned: values.pinned,
    title: values.title.replace(/\s+/gu, " ").trim(),
  })
}

function firstInvalidField(values: ComposerValues, academyToday: string): FieldName | null {
  if (!values.title.trim()) return "title"
  if (!values.content.trim()) return "content"
  if (values.channels.length === 0) return "channels"
  if (values.expiresOn && values.expiresOn < academyToday) return "expiresOn"
  return null
}

function ReviewDialog({
  onBack,
  onOutcomeAfterExit,
  onPublished,
  onValidationFailure,
  publicationKey,
  values,
}: {
  onBack: () => void
  onOutcomeAfterExit: (outcome: { feedback: ActionFeedback; published: boolean }) => void
  onPublished: (announcementId: string) => void
  onValidationFailure: (field: FieldName, message: string) => void
  publicationKey: string
  values: ComposerValues
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const publishButtonRef = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  /**
   * Set once this dialog has left the screen. A publish that settles afterwards
   * must not navigate the page or pull focus back out of the editor the coach
   * has returned to, but it must still be reported: it is reported through
   * `onOutcomeAfterExit`, onto the composer's own notice, because this dialog's
   * notice no longer exists to be read. Cleared on every mount because an effect
   * cleanup also runs between Strict Mode's paired development mounts, which
   * would otherwise retire the dialog before its first publish ever ran.
   */
  const dismissed = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow

    dismissed.current = false
    if (dialog && !dialog.open) dialog.showModal()
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()

    return () => {
      dismissed.current = true
      document.body.style.overflow = previousOverflow
      if (dialog?.open) dialog.close()
      previouslyFocused?.focus()
    }
  }, [])

  async function publish() {
    if (pending) return
    setPending(true)
    setFeedback(null)
    try {
      const result = await withSaveDeadline(
        publishAnnouncementAction({
          channels: values.channels,
          content: values.content.trim(),
          expiresOn: values.expiresOn || null,
          pinned: values.pinned,
          publicationKey,
          title: values.title.trim(),
        }),
        publishDeadlineMs,
      )
      if (!result.ok) {
        if (dismissed.current) {
          // Not routed through `onValidationFailure`: that focuses the field it
          // names, and the coach is already typing somewhere in the editor.
          onOutcomeAfterExit({
            feedback: { message: result.message, tone: "error" },
            published: false,
          })
          return
        }
        if (
          result.field === "title"
          || result.field === "content"
          || result.field === "channels"
          || result.field === "expiresOn"
        ) {
          onValidationFailure(result.field, result.message)
          return
        }
        setFeedback({ message: result.message, tone: "error" })
        publishButtonRef.current?.focus()
        return
      }

      if (dismissed.current) {
        onOutcomeAfterExit({
          feedback: { message: publishedAfterExitMessage, tone: "success" },
          published: true,
        })
        return
      }
      onPublished(result.announcement.id)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The announcement could not be published",
        retained: "Your message is still here",
        subject: "The announcement",
      })
      if (dismissed.current) {
        onOutcomeAfterExit({
          feedback: { message: failure.message, tone: "error" },
          published: false,
        })
        return
      }
      setFeedback({ message: failure.message, tone: "error" })
      publishButtonRef.current?.focus()
    } finally {
      setPending(false)
    }
  }

  /**
   * Every exit below stays live while a publish is in flight. Next invokes a
   * server action through React's `callServer`, whose fetch carries no
   * `AbortSignal` (lib/client/network-failure.ts:28-40), so a connection that is
   * established but stalled — the courtside phone on one bar — neither resolves
   * nor rejects; gating Escape, the backdrop, the close button and "Back to
   * edit" on `pending` sealed the coach in with up to 5,000 characters, behind
   * an `isDirty` beforeunload guard that leaves reload no way out either.
   * Leaving is safe because the attempt keeps its `publicationKey`:
   * `publication_key` is uniquely indexed and `publishAnnouncement` returns the
   * row an earlier request created while the payload fingerprint still matches,
   * so reviewing an untouched message and publishing again resolves to that same
   * row rather than posting a second notice — which is why the key is reminted
   * by canonical payload rather than by object identity. The publish button is
   * held for the length of one attempt; a coach who dismisses this dialog and
   * re-enters gets a fresh one that can start a second, and the shared key is
   * what makes that land on the first publication instead of beside it.
   */
  return (
    <dialog
      ref={dialogRef}
      className={styles.dialogBackdrop}
      aria-labelledby="announcement-review-title"
      onCancel={(event) => {
        event.preventDefault()
        onBack()
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBack()
      }}
    >
      <section className={styles.reviewDialog} onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="announcement-review-title" className="sr-only">Review announcement</h2>
        <button
          ref={closeButtonRef}
          className={styles.dialogClose}
          type="button"
          onClick={onBack}
          aria-label="Back to announcement editor"
        >
          <X aria-hidden="true" />
        </button>

        <div className={styles.reviewCopy}>
          <h3>{values.title.trim()}</h3>
          <div className={styles.reviewMessage}>
            {announcementParagraphs(values.content).map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
            ))}
          </div>
        </div>

        <div className={styles.reviewMeta}>
          <div className={styles.channelPills} role="group" aria-label="Announcement locations">
            {values.channels.map((channel) => (
              <span key={channel}>
                <Check aria-hidden="true" /> {announcementChannelLabel(channel)}
                <small>{announcementChannelAudience(channel)}</small>
              </span>
            ))}
          </div>
          {values.expiresOn ? (
            <p>
              Available through {formatDateKey(values.expiresOn, {
                day: "numeric",
                month: "long",
                weekday: undefined,
                year: "numeric",
              })}
            </p>
          ) : null}
        </div>

        {values.channels.some(announcementChannelIsPublic) ? (
          /*
           * Shown only for the public channel, so it stays meaningful. The
           * second sentence matters as much as the first: withdrawal is the
           * emergency stop a coach reaches for when they realise a message
           * named a child, and it does not take effect at once -- the public
           * endpoint is served with `stale-while-revalidate`, so a copy can keep
           * being handed out for a few minutes after it is pulled.
           */
          <p className={styles.publicWarning} role="note">
            <strong>This will be public.</strong> Anyone on the internet can read it, and other
            sites may keep a copy. If you withdraw it, it can take a few minutes to disappear
            everywhere — so check names and photos before you publish.
          </p>
        ) : null}

        <InlineNotice
          className={styles.dialogNotice}
          message={feedback?.message}
          tone={feedback?.tone}
        />

        <div className={styles.dialogActions}>
          <button type="button" onClick={onBack}>Back to edit</button>
          <button
            ref={publishButtonRef}
            className={styles.primaryButton}
            type="button"
            onClick={publish}
            disabled={pending}
          >
            <Send aria-hidden="true" />
            {pending ? "Publishing…" : "Publish announcement"}
          </button>
        </div>
      </section>
    </dialog>
  )
}

export function AnnouncementComposer({ academyToday }: { academyToday: string }) {
  const [values, setValues] = useState(EMPTY_VALUES)
  const [reviewing, setReviewing] = useState(false)
  const [published, setPublished] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  /**
   * The publication key and the canonical payload it was minted for. It is held
   * here rather than inside the dialog so that dismissing a stalled publish and
   * reviewing again retries the same key. `publishAnnouncement` treats a reused
   * key as the same publication only while the payload fingerprint matches and
   * rejects it outright once it does not, so the key has to be reminted exactly
   * when that fingerprint would change and no sooner — hence `publicationPayload`
   * rather than a reference check.
   */
  const [publication, setPublication] = useState(() => ({
    key: createMutationKey(),
    payload: publicationPayload(EMPTY_VALUES),
  }))
  // Reports a publish that settled after the review dialog had gone. Nothing
  // else writes here: while the dialog is up it carries its own notice.
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const channelGroupRef = useRef<HTMLFieldSetElement>(null)
  const expiryRef = useRef<HTMLInputElement>(null)
  const isDirty = !published && (
    values.title !== ""
    || values.content !== ""
    || values.channels.length > 0
    || values.pinned
    || values.expiresOn !== ""
  )

  const { navigateAfterCommit } = useUnsavedWorkGuard({
    isDirty,
    message: "This announcement has not been published. Leave and discard it?",
    scope: "announcement-composer",
  })

  function updateValues(next: Partial<ComposerValues>) {
    setValues((current) => ({ ...current, ...next }))
    // Clear only the errors for the fields being edited. Clearing all of them
    // wiped outstanding errors on fields the coach had not touched.
    setErrors((current) => {
      const remaining = { ...current }
      for (const field of Object.keys(next)) delete remaining[field as FieldName]
      return remaining
    })
  }

  function toggleChannel(channel: AnnouncementChannel) {
    const channels = values.channels.includes(channel)
      ? values.channels.filter((item) => item !== channel)
      : [...values.channels, channel]
    updateValues({ channels })
  }

  function focusField(field: FieldName) {
    window.setTimeout(() => {
      if (field === "title") titleRef.current?.focus()
      if (field === "content") contentRef.current?.focus()
      if (field === "channels") channelGroupRef.current?.focus()
      if (field === "expiresOn") expiryRef.current?.focus()
    }, 0)
  }

  function reviewAnnouncement() {
    const invalid = firstInvalidField(values, academyToday)
    if (invalid) {
      const nextErrors: Partial<Record<FieldName, string>> = {}
      if (!values.title.trim()) nextErrors.title = "Enter an announcement title."
      if (!values.content.trim()) nextErrors.content = "Enter an announcement message."
      if (values.channels.length === 0) nextErrors.channels = "Choose where the announcement should appear."
      if (values.expiresOn && values.expiresOn < academyToday) {
        nextErrors.expiresOn = "Expiry cannot be before today."
      }
      setErrors(nextErrors)
      focusField(invalid)
      return
    }
    const payload = publicationPayload(values)
    if (publication.payload !== payload) {
      setPublication({ key: createMutationKey(), payload })
    }
    setReviewing(true)
  }

  function completePublication(announcementId: string) {
    setPublished(true)
    setReviewing(false)
    navigateAfterCommit(() => {
      window.location.replace(
        `/coach/announcements/${encodeURIComponent(announcementId)}?published=1`,
      )
    })
  }

  function reportOutcomeAfterExit(
    { feedback: outcome, published: didPublish }: {
      feedback: ActionFeedback
      published: boolean
    },
  ) {
    // A published notice is no longer unsaved work, whichever screen the coach
    // was on when it landed: leaving the guard armed would ask them to discard
    // an announcement the academy can already read.
    if (didPublish) setPublished(true)
    setFeedback(outcome)
  }

  function handleServerValidation(field: FieldName, message: string) {
    setReviewing(false)
    setErrors({ [field]: message })
    focusField(field)
  }

  return (
    <div className={`${styles.composerWorkspace} page-shell`}>
      <div className={styles.composerBackRow}>
        <Link href="/coach/announcements">
          <ArrowLeft aria-hidden="true" />
          Back to announcements
        </Link>
      </div>

      <header className={styles.composerHeader}>
        <h1>New announcement</h1>
      </header>

      <InlineNotice
        className={styles.composerNotice}
        message={feedback?.message}
        reserveSpace={false}
        tone={feedback?.tone}
      />

      <section className={styles.noticeSlip} aria-labelledby="announcement-editor-title">
        <div className={styles.slipMasthead}>
          <h2 id="announcement-editor-title" className="sr-only">Write an announcement</h2>
          <span>Notice 01</span>
        </div>

        <div className={styles.slipBody}>
          <div className={styles.slipField}>
            <span><label htmlFor="announcement-title">Title</label></span>
            <input
              ref={titleRef}
              aria-describedby={errors.title
                ? "announcement-title-limit announcement-title-error"
                : "announcement-title-limit"}
              aria-invalid={Boolean(errors.title)}
              autoComplete="off"
              id="announcement-title"
              maxLength={120}
              name="title"
              onChange={(event) => updateValues({ title: event.target.value })}
              placeholder="Holiday training schedule"
              type="text"
              value={values.title}
            />
            <span className={styles.slipFieldMeta}>
              {errors.title ? (
                <small id="announcement-title-error" className={styles.slipFieldError}>
                  {errors.title}
                </small>
              ) : <span aria-hidden="true" />}
              <small className={styles.slipCounter} aria-hidden="true">
                {values.title.length} / 120
              </small>
              <small id="announcement-title-limit" className="sr-only">
                Maximum 120 characters.
              </small>
            </span>
          </div>

          <div className={styles.slipField}>
            <span><label htmlFor="announcement-content">Message</label></span>
            <textarea
              ref={contentRef}
              aria-describedby={errors.content
                ? "announcement-content-limit announcement-content-error"
                : "announcement-content-limit"}
              aria-invalid={Boolean(errors.content)}
              autoComplete="off"
              id="announcement-content"
              maxLength={5000}
              name="content"
              onChange={(event) => updateValues({ content: event.target.value })}
              placeholder="Share the important details with the academy."
              rows={5}
              value={values.content}
            />
            <span className={styles.slipFieldMeta}>
              {errors.content ? (
                <small id="announcement-content-error" className={styles.slipFieldError}>
                  {errors.content}
                </small>
              ) : <span aria-hidden="true" />}
              <small className={styles.slipCounter} aria-hidden="true">
                {values.content.length} / 5000
              </small>
              <small id="announcement-content-limit" className="sr-only">
                Maximum 5,000 characters.
              </small>
            </span>
          </div>
        </div>

        <div className={styles.slipDocket}>
          <fieldset
            ref={channelGroupRef}
            className={styles.slipChannels}
            aria-describedby="announcement-channels-help"
            aria-invalid={Boolean(errors.channels)}
            tabIndex={errors.channels ? -1 : undefined}
          >
            <legend className="sr-only">Send to destinations</legend>
            <span className={styles.slipDocketLabel} aria-hidden="true">Send to</span>
            <div className={styles.slipChannelChoices}>
              {/*
                * Each choice carries its audience, because the names do not.
                * "Homepage" reads like the academy's own page -- somewhere
                * families go -- and it is the public internet. A coach weighing
                * whether a child's name belongs in a message is weighing it
                * against that, so it belongs next to the box, not in a doc.
                */}
              <label>
                <input
                  checked={values.channels.includes("homepage")}
                  name="channels"
                  onChange={() => toggleChannel("homepage")}
                  type="checkbox"
                  value="homepage"
                />
                <span>
                  Homepage
                  <small className={styles.slipChannelAudience}>
                    {announcementChannelAudience("homepage")}
                  </small>
                </span>
              </label>
              <label>
                <input
                  checked={values.channels.includes("player_dashboard")}
                  name="channels"
                  onChange={() => toggleChannel("player_dashboard")}
                  type="checkbox"
                  value="player_dashboard"
                />
                <span>
                  Player Dashboard
                  <small className={styles.slipChannelAudience}>
                    {announcementChannelAudience("player_dashboard")}
                  </small>
                </span>
              </label>
            </div>
            <small
              id="announcement-channels-help"
              className={errors.channels ? styles.slipChannelMessage : styles.slipChannelHelp}
            >
              {errors.channels ?? "Homepage posts are public and can be cached elsewhere."}
            </small>
          </fieldset>

          <label className={styles.slipPinOption}>
            <input
              aria-describedby="announcement-pin-help"
              checked={values.pinned}
              name="pinned"
              onChange={(event) => updateValues({ pinned: event.target.checked })}
              type="checkbox"
            />
            <span>Pin announcement</span>
          </label>
          {/* Outside the label: nested description text leaks into the
              checkbox's accessible name. `sr-only` is absolutely positioned,
              so it takes no grid cell here. */}
          <small id="announcement-pin-help" className="sr-only">
            Keep it above ordinary notices while active.
          </small>

          <div className={styles.slipExpiryField}>
            <span><label htmlFor="announcement-expires-on">Expiry date</label></span>
            <input
              ref={expiryRef}
              aria-describedby="announcement-expiry-help"
              aria-invalid={Boolean(errors.expiresOn)}
              id="announcement-expires-on"
              min={academyToday}
              name="expiresOn"
              onChange={(event) => updateValues({ expiresOn: event.target.value })}
              type="date"
              value={values.expiresOn}
            />
            <small
              id="announcement-expiry-help"
              className={errors.expiresOn ? styles.slipExpiryError : "sr-only"}
            >
              {errors.expiresOn ?? "The notice remains visible through this date."}
            </small>
          </div>

          <button
            className={styles.slipReviewButton}
            type="button"
            onClick={reviewAnnouncement}
          >
            <span>Review announcement</span>
            <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </section>

      {reviewing ? (
        <ReviewDialog
          onBack={() => setReviewing(false)}
          onOutcomeAfterExit={reportOutcomeAfterExit}
          onPublished={completePublication}
          onValidationFailure={handleServerValidation}
          publicationKey={publication.key}
          values={values}
        />
      ) : null}
    </div>
  )
}
