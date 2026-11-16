"use client"

import { ArrowLeft, X } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { publishAnnouncementAction } from "@/app/coach/announcements/actions"
import { announcementParagraphs } from "@/components/announcements/announcement-presentation"
import {
  InlineNotice,
  type ActionFeedback,
} from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import type { AnnouncementActionResult } from "@/lib/announcements/contracts"
import { describeSaveFailure, withSaveDeadline } from "@/lib/client/network-failure"

import { lastDayLabel, whereItShows } from "./announcement-detail"
import {
  announcementChannelAudience,
  announcementChannelIsPublic,
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

/** Said when a version of this notice is live and it may not be what is on screen. */
const otherVersionLiveMessage = "Another version of this announcement is already live."
  + " Open it to check it, and withdraw it if this one replaces it."


/** A version of this notice known to be live; `payload` is what it said, when known. */
export type LiveVersion = {
  announcementId: string
  key: string
  payload: string | null
}

function announcementHref(announcementId: string) {
  return `/coach/announcements/${encodeURIComponent(announcementId)}`
}

/** Worked out on each render, so an edit made since is never called published. */
export function liveVersionNotice(version: LiveVersion, onScreen: string): ActionFeedback {
  // Opened beside the editor, so checking it does not discard unpublished wording.
  const action = { href: announcementHref(version.announcementId), label: "Open it", newTab: true }
  if (version.payload === onScreen) {
    return { action, message: publishedAfterExitMessage, tone: "success" }
  }
  return { action, message: otherVersionLiveMessage, tone: "info" }
}

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
export function publicationPayload(values: ComposerValues) {
  return JSON.stringify({
    channels: [...new Set(values.channels)].sort(),
    content: values.content.replace(/\r\n?/gu, "\n").trim(),
    expiresOn: values.expiresOn.trim() || null,
    pinned: values.pinned,
    title: values.title.replace(/\s+/gu, " ").trim(),
  })
}

/**
 * The publication key a review should publish with. Unchanged message: the
 * same key, so a retry resolves to the same notice. Changed message whose key
 * was sent and may still land: the same key, so the server takes whichever
 * version arrives first and refuses the other. Otherwise a fresh key, because
 * the server refuses a key reused for different content.
 */
export function publicationForReview(
  current: { key: string; payload: string },
  payload: string,
  { keySent, liveVersions }: { keySent: boolean; liveVersions: readonly LiveVersion[] },
  mint: () => string = createMutationKey,
) {
  if (current.payload === payload) return current
  const keyLive = liveVersions.some((version) => version.key === current.key)
  if (keySent && !keyLive) return { key: current.key, payload }
  return { key: mint(), payload }
}

/** "the homepage and player home until 23 Nov, pinned". */
function willShowOn({ channels, expiresOn, pinned }: ComposerValues) {
  const places = whereItShows(channels)
    .replace(/ only$/u, "")
    .replace(/^Homepage/u, "the homepage")
    .replace(/^Player/u, "player")
  return `${places}${expiresOn ? ` until ${lastDayLabel(expiresOn)}` : ""}${pinned ? ", pinned" : ""}`
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
  onConflict,
  onFailureAfterExit,
  onLive,
  onPublished,
  onSent,
  onValidationFailure,
  otherLiveAnnouncementId,
  publicationKey,
  values,
}: {
  onBack: () => void
  /** Another version sent under the same key got there first and is live. */
  onConflict: (refusal: { announcementId: string; key: string }) => void
  /** A publish finished after the dialog was left. */
  onLive: (version: LiveVersion) => void
  onFailureAfterExit: (feedback: ActionFeedback) => void
  onPublished: (announcementId: string) => void
  /** A publish with this key has left the browser and may land at any time. */
  onSent: (publicationKey: string) => void
  onValidationFailure: (field: FieldName, message: string) => void
  /** A different version of this notice that is already live. */
  otherLiveAnnouncementId: string | null
  publicationKey: string
  values: ComposerValues
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const publishButtonRef = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  /**
   * Set once this dialog has left the screen. A publish that settles afterwards
   * must not navigate the page or pull focus back out of the editor the coach
   * has returned to, but it must still be reported: it is reported through
   * `onLive` or `onFailureAfterExit`, onto the composer's own notice, because this dialog's
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

  /** Acts on a publish's answer, inside the deadline or whenever it arrives after it. */
  function settle(
    result: AnnouncementActionResult,
    sent: { key: string; payload: string },
  ) {
    if (result.ok) {
      if (dismissed.current) {
        onLive({ announcementId: result.announcement.id, key: sent.key, payload: sent.payload })
        return
      }
      onPublished(result.announcement.id)
      return
    }
    if (result.code === "PUBLICATION_CONFLICT" && result.announcementId) {
      // The composer records it, so this dialog warns beside the button.
      onConflict({ announcementId: result.announcementId, key: sent.key })
      if (dismissed.current) return
      setFeedback({ message: result.message, tone: "error" })
      // Not the publish button: pressing it again now puts up a second notice,
      // and a coach retrying by keyboard should not do that by reflex.
      backButtonRef.current?.focus()
      return
    }
    if (dismissed.current) {
      // Not routed through `onValidationFailure`: that focuses the field it
      // names, and the coach is already typing somewhere in the editor.
      onFailureAfterExit({ message: result.message, tone: "error" })
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
  }

  async function publish() {
    if (pending) return
    setPending(true)
    setFeedback(null)
    const sent = { key: publicationKey, payload: publicationPayload(values) }
    onSent(sent.key)
    const request = publishAnnouncementAction({
      channels: values.channels,
      content: values.content.trim(),
      expiresOn: values.expiresOn || null,
      pinned: values.pinned,
      publicationKey: sent.key,
      title: values.title.trim(),
    })
    try {
      settle(await withSaveDeadline(request, publishDeadlineMs), sent)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "Your message is still here",
        subject: "The announcement",
      })
      if (failure.kind === "timeout") {
        // The request is still running; report whatever it ends with.
        request.then((result) => settle(result, sent), () => {})
      }
      if (dismissed.current) {
        onFailureAfterExit({ action: failure.signIn, message: failure.message, tone: "error" })
        return
      }
      setFeedback({ action: failure.signIn, message: failure.message, tone: "error" })
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
      className={styles.dialog}
      aria-labelledby="announcement-review-title"
      onCancel={(event) => {
        event.preventDefault()
        onBack()
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBack()
      }}
    >
      <section onMouseDown={(event) => event.stopPropagation()}>
        <header className={styles.band}>
          <div>
            <h2 id="announcement-review-title">Check before publishing</h2>
            <h3>{values.title.trim()}</h3>
          </div>
          <button
            ref={closeButtonRef}
            className={styles.close}
            type="button"
            onClick={onBack}
            aria-label="Back to announcement editor"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.message}>
            {announcementParagraphs(values.content).map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
            ))}
          </div>

          <ul className={styles.facts} aria-label="Where and how long">
            <li><span>Shows on</span>{whereItShows(values.channels)}</li>
            {values.expiresOn ? <li><span>Until</span>{lastDayLabel(values.expiresOn)}</li> : null}
            {values.pinned ? <li><span>Order</span>Pinned to top</li> : null}
          </ul>

          {values.channels.some(announcementChannelIsPublic) ? (
            /*
             * Shown only for the public channel, so it stays meaningful rather
             * than becoming furniture. Two sentences: what happens, and what to do
             * about it. The second clause is the part a coach cannot guess --
             * withdrawing takes it off our page, but a search engine or an archive
             * that already read it keeps its own copy, and nothing we publish
             * reaches that.
             */
            <p className={styles.note} data-tone="red" role="note">
              This will be public. Anyone on the internet can read it, and copies
              may stay online even after you withdraw it. Check names and photos first.
            </p>
          ) : null}

          {otherLiveAnnouncementId ? (
            // In the dialog, because the modal covers the composer's own notice.
            <p className={styles.note} data-tone="red" id="announcement-review-live-warning" role="note">
              Another version is already live. Publishing this one adds a
              second notice. Withdraw the other one if this replaces it.{" "}
              <Link
                href={announcementHref(otherLiveAnnouncementId)}
                rel="noopener"
                target="_blank"
              >
                Open the live notice<span className="sr-only"> (opens in a new tab)</span>
              </Link>
            </p>
          ) : null}

          <InlineNotice
            action={feedback?.action}
            message={feedback?.message}
            reserveSpace={false}
            tone={feedback?.tone}
          />

          <div className={styles.pair}>
            <button ref={backButtonRef} className={styles.button} type="button" onClick={onBack}>
              Back to edit
            </button>
            <button
              ref={publishButtonRef}
              aria-describedby={otherLiveAnnouncementId ? "announcement-review-live-warning" : undefined}
              className={styles.primary}
              type="button"
              onClick={publish}
              disabled={pending}
            >
              {pending
                ? "Publishing…"
                : otherLiveAnnouncementId ? "Publish as a second notice" : "Publish"}
            </button>
          </div>
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
   * refuses it once it does not; see `publicationForReview`.
   */
  const [publication, setPublication] = useState(() => ({
    key: createMutationKey(),
    payload: publicationPayload(EMPTY_VALUES),
  }))
  // Reports a publish that failed after the review dialog had gone. A live
  // version is reported from `liveVersions` instead.
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  /** Versions of this notice known to be live while the coach is still here, oldest first. */
  const [liveVersions, setLiveVersions] = useState<LiveVersion[]>([])
  /** Keys a publish was sent with; until its outcome is known it may still land. */
  const sentKeys = useRef<Set<string>>(new Set())
  /** Set once the composer starts leaving for the published notice. */
  const leaving = useRef<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const channelGroupRef = useRef<HTMLFieldSetElement>(null)
  const expiryRef = useRef<HTMLInputElement>(null)
  const currentPayload = publicationPayload(values)
  const latestLive = liveVersions.at(-1) ?? null
  const isDirty = !published && latestLive?.payload !== currentPayload && (
    values.title !== ""
    || values.content !== ""
    || values.channels.length > 0
    || values.pinned
    || values.expiresOn !== ""
  )
  // Warn in the review when publishing would add a second notice.
  const otherLiveAnnouncementId = latestLive && latestLive.payload !== publication.payload
    ? latestLive.announcementId
    : null
  const notice = feedback ?? (latestLive ? liveVersionNotice(latestLive, currentPayload) : null)

  const { navigateAfterCommit } = useUnsavedWorkGuard({
    isDirty,
    message: latestLive
      ? "Your latest changes have not been published; only the earlier wording is live."
        + " Leave and discard them?"
      : "This announcement has not been published. Leave and discard it?",
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
      if (!values.title.trim()) nextErrors.title = "Add a title."
      if (!values.content.trim()) nextErrors.content = "Add the message."
      if (values.channels.length === 0) nextErrors.channels = "Pick at least one place."
      if (values.expiresOn && values.expiresOn < academyToday) {
        nextErrors.expiresOn = "The last day cannot be before today."
      }
      setErrors(nextErrors)
      focusField(invalid)
      return
    }
    const next = publicationForReview(publication, currentPayload, {
      keySent: sentKeys.current.has(publication.key),
      liveVersions,
    })
    if (next !== publication) setPublication(next)
    setReviewing(true)
  }

  function completePublication(announcementId: string) {
    // A publish retried after its deadline can answer twice; leave once.
    if (leaving.current) return
    leaving.current = announcementId
    setPublished(true)
    setReviewing(false)
    navigateAfterCommit(() => {
      window.location.replace(
        `/coach/announcements/${encodeURIComponent(announcementId)}?published=1`,
      )
    })
  }

  function recordSent(key: string) {
    sentKeys.current.add(key)
  }

  function recordLiveVersion(version: LiveVersion) {
    setLiveVersions((current) => [
      ...current.filter((known) => known.announcementId !== version.announcementId),
      version,
    ])
    // The key is spent: a different wording under it needs a fresh one.
    setPublication((current) => (
      current.key === version.key && current.payload !== version.payload
        ? { key: createMutationKey(), payload: current.payload }
        : current
    ))
    setFeedback(null)
  }

  function recordConflict({ announcementId, key }: { announcementId: string; key: string }) {
    // Which wording went live is not known here.
    recordLiveVersion({ announcementId, key, payload: null })
  }

  function handleServerValidation(field: FieldName, message: string) {
    setReviewing(false)
    setErrors({ [field]: message })
    focusField(field)
  }

  return (
    <div className={`${styles.page} page-shell`}>
      <nav className={styles.back} aria-label="Announcement navigation">
        <Link href="/coach/announcements">
          <ArrowLeft aria-hidden="true" />
          Back to Announcements
        </Link>
      </nav>

      <h1 className={styles.title}>New announcement</h1>

      <InlineNotice
        action={notice?.action}
        className={styles.composerNotice}
        message={notice?.message}
        reserveSpace={false}
        tone={notice?.tone}
      />

      <section className={styles.form} aria-labelledby="announcement-editor-title">
        <h2 id="announcement-editor-title" className="sr-only">Write an announcement</h2>

        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <label className={styles.label} htmlFor="announcement-title">Title</label>
            <small aria-hidden="true">{values.title.length} / 120</small>
          </div>
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
          {errors.title ? (
            <small id="announcement-title-error" className={styles.error}>{errors.title}</small>
          ) : null}
          <small id="announcement-title-limit" className="sr-only">Maximum 120 characters.</small>
        </div>

        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <label className={styles.label} htmlFor="announcement-content">Message</label>
            <small aria-hidden="true">{values.content.length} / 5000</small>
          </div>
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
          {errors.content ? (
            <small id="announcement-content-error" className={styles.error}>{errors.content}</small>
          ) : null}
          <small id="announcement-content-limit" className="sr-only">Maximum 5,000 characters.</small>
        </div>

        <div className={styles.settings}>
          <fieldset
            ref={channelGroupRef}
            className={styles.field}
            aria-describedby="announcement-channels-help"
            aria-invalid={Boolean(errors.channels)}
            tabIndex={errors.channels ? -1 : undefined}
          >
            <legend className={styles.label}>Show on</legend>
            <div className={styles.chips}>
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
                Homepage
                <small>{announcementChannelAudience("homepage")}</small>
              </label>
              <label>
                <input
                  checked={values.channels.includes("player_dashboard")}
                  name="channels"
                  onChange={() => toggleChannel("player_dashboard")}
                  type="checkbox"
                  value="player_dashboard"
                />
                Player home
                <small>{announcementChannelAudience("player_dashboard")}</small>
              </label>
            </div>
            {/*
              * Nothing here but the error. The sentence that used to sit here --
              * "Homepage posts are public" -- is now under the Homepage box
              * itself, where the choice is actually made; saying it twice made
              * the group read as a warning rather than as two options.
              */}
            <small id="announcement-channels-help" className={styles.error}>
              {errors.channels ?? ""}
            </small>
          </fieldset>

          <div className={styles.field}>
            <div className={styles.fieldHead}>
              <label className={styles.label} htmlFor="announcement-expires-on">Last day</label>
              <small>optional</small>
            </div>
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
              className={errors.expiresOn ? styles.error : "sr-only"}
            >
              {errors.expiresOn ?? "The notice stays up through this day."}
            </small>
          </div>

          <fieldset className={styles.field} aria-describedby="announcement-pin-help">
            <legend className={styles.label}>Pin to top</legend>
            <div className={styles.switch}>
              {[false, true].map((pinned) => (
                <label key={String(pinned)}>
                  <input
                    checked={values.pinned === pinned}
                    name="pinned"
                    onChange={() => updateValues({ pinned })}
                    type="radio"
                    value={pinned ? "yes" : "no"}
                  />
                  {pinned ? "Yes" : "No"}
                </label>
              ))}
            </div>
            <small id="announcement-pin-help" className="sr-only">
              Keeps it above other notices while it shows.
            </small>
          </fieldset>
        </div>

        <div className={styles.formFoot}>
          <p className={styles.preview}>
            {values.channels.length
              ? <>Will show on <strong>{willShowOn(values)}</strong></>
              : "Pick where it shows"}
          </p>
          <div className={styles.actions}>
            <Link className={styles.button} href="/coach/announcements">Cancel</Link>
            <button className={styles.primary} type="button" onClick={reviewAnnouncement}>
              Review
            </button>
          </div>
        </div>
      </section>

      {reviewing ? (
        <ReviewDialog
          onBack={() => setReviewing(false)}
          onConflict={recordConflict}
          onFailureAfterExit={setFeedback}
          onLive={recordLiveVersion}
          onPublished={completePublication}
          onSent={recordSent}
          onValidationFailure={handleServerValidation}
          otherLiveAnnouncementId={otherLiveAnnouncementId}
          publicationKey={publication.key}
          values={values}
        />
      ) : null}
    </div>
  )
}
