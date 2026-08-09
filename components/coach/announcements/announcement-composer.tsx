"use client"

import { ArrowLeft, Check, Eye, Send, X } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { publishAnnouncementAction } from "@/app/coach/announcements/actions"
import { announcementParagraphs } from "@/components/announcements/announcement-presentation"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { formatDateKey } from "@/lib/format"

import {
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

function createMutationKey() {
  return globalThis.crypto.randomUUID()
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
  onPublished,
  onValidationFailure,
  values,
}: {
  onBack: () => void
  onPublished: (announcementId: string) => void
  onValidationFailure: (field: FieldName, message: string) => void
  values: ComposerValues
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const publishButtonRef = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [publicationKey] = useState(createMutationKey)

  useEffect(() => {
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow

    if (dialog && !dialog.open) dialog.showModal()
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()

    return () => {
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
      const result = await publishAnnouncementAction({
        channels: values.channels,
        content: values.content.trim(),
        expiresOn: values.expiresOn || null,
        pinned: values.pinned,
        publicationKey,
        title: values.title.trim(),
      })
      if (!result.ok) {
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

      onPublished(result.announcement.id)
    } catch {
      setFeedback({
        message: "The announcement could not be published. Your message is still here.",
        tone: "error",
      })
      publishButtonRef.current?.focus()
    } finally {
      setPending(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialogBackdrop}
      aria-labelledby="announcement-review-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onBack()
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onBack()
      }}
    >
      <section className={styles.reviewDialog} onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="announcement-review-title" className="sr-only">Review announcement</h2>
        <button
          ref={closeButtonRef}
          className={styles.dialogClose}
          type="button"
          onClick={onBack}
          disabled={pending}
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
          <div className={styles.channelPills} aria-label="Announcement locations">
            {values.channels.map((channel) => (
              <span key={channel}><Check aria-hidden="true" /> {announcementChannelLabel(channel)}</span>
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

        <InlineNotice
          className={styles.dialogNotice}
          message={feedback?.message}
          tone={feedback?.tone}
        />

        <div className={styles.dialogActions}>
          <button type="button" onClick={onBack} disabled={pending}>Back to edit</button>
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
    setErrors({})
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

  function handleServerValidation(field: FieldName, message: string) {
    setReviewing(false)
    setErrors({ [field]: message })
    focusField(field)
  }

  return (
    <div className={`${styles.workspace} page-shell`}>
      <div className={styles.backRow}>
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>

      <header className={styles.workspaceHeader}>
        <span className="eyebrow">Announcements</span>
        <h1>New announcement</h1>
        <p>Write one clear notice, check where it will appear, then publish.</p>
      </header>

      <section className={styles.composerPanel} aria-labelledby="announcement-editor-title">
        <div className={styles.panelHeading}>
          <span>Notice board</span>
          <h2 id="announcement-editor-title">Write an announcement</h2>
        </div>

        <div className={styles.composerFields}>
          <label className={styles.field}>
            <span>Title</span>
            <input
              ref={titleRef}
              aria-describedby={errors.title ? "announcement-title-error" : undefined}
              aria-invalid={Boolean(errors.title)}
              autoComplete="off"
              maxLength={120}
              onChange={(event) => updateValues({ title: event.target.value })}
              placeholder="Holiday training schedule"
              type="text"
              value={values.title}
            />
            <small id="announcement-title-error" className={styles.fieldMessage}>
              {errors.title ?? `${values.title.length}/120`}
            </small>
          </label>

          <label className={styles.field}>
            <span>Message</span>
            <textarea
              ref={contentRef}
              aria-describedby={errors.content ? "announcement-content-error" : undefined}
              aria-invalid={Boolean(errors.content)}
              maxLength={5000}
              onChange={(event) => updateValues({ content: event.target.value })}
              placeholder="Share the important details with the academy."
              rows={8}
              value={values.content}
            />
            <small id="announcement-content-error" className={styles.fieldMessage}>
              {errors.content ?? `${values.content.length}/5000`}
            </small>
          </label>

          <fieldset
            ref={channelGroupRef}
            className={styles.locationFieldset}
            aria-describedby={errors.channels ? "announcement-channels-error" : undefined}
            tabIndex={errors.channels ? -1 : undefined}
          >
            <legend>Where should it appear?</legend>
            <div>
              <label>
                <input
                  checked={values.channels.includes("homepage")}
                  onChange={() => toggleChannel("homepage")}
                  type="checkbox"
                />
                <span><strong>Homepage</strong><small>Visible to everyone visiting SMBA.</small></span>
              </label>
              <label>
                <input
                  checked={values.channels.includes("player_dashboard")}
                  onChange={() => toggleChannel("player_dashboard")}
                  type="checkbox"
                />
                <span><strong>Player Dashboard</strong><small>Visible after a player signs in.</small></span>
              </label>
            </div>
            <small id="announcement-channels-error" className={styles.fieldMessage}>
              {errors.channels ?? "Choose one or both locations."}
            </small>
          </fieldset>

          <div className={styles.optionsGrid}>
            <label className={styles.checkOption}>
              <input
                checked={values.pinned}
                onChange={(event) => updateValues({ pinned: event.target.checked })}
                type="checkbox"
              />
              <span><strong>Pin announcement</strong><small>Keep it above ordinary notices while active.</small></span>
            </label>

            <label className={styles.field}>
              <span>Expiry date <em>Optional</em></span>
              <input
                ref={expiryRef}
                aria-describedby={errors.expiresOn ? "announcement-expiry-error" : undefined}
                aria-invalid={Boolean(errors.expiresOn)}
                min={academyToday}
                onChange={(event) => updateValues({ expiresOn: event.target.value })}
                type="date"
                value={values.expiresOn}
              />
              <small id="announcement-expiry-error" className={styles.fieldMessage}>
                {errors.expiresOn ?? "The notice remains visible through this date."}
              </small>
            </label>
          </div>
        </div>

        <div className={styles.composerActions}>
          <p>Nothing is saved until you publish.</p>
          <button type="button" onClick={reviewAnnouncement}>
            <Eye aria-hidden="true" />
            Review announcement
          </button>
        </div>
      </section>

      {reviewing ? (
        <ReviewDialog
          onBack={() => setReviewing(false)}
          onPublished={completePublication}
          onValidationFailure={handleServerValidation}
          values={values}
        />
      ) : null}
    </div>
  )
}
