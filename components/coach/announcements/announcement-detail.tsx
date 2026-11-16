"use client"

import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, type RefObject } from "react"

import {
  setAnnouncementPinnedAction,
  withdrawAnnouncementAction,
} from "@/app/coach/announcements/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { announcementParagraphs } from "@/components/announcements/announcement-presentation"
import { describeSaveFailure, withSaveDeadline } from "@/lib/client/network-failure"
import { formatAcademyDate, formatDateKey } from "@/lib/format"

import type { AnnouncementChannel, CoachAnnouncementDetail } from "./contracts"
import styles from "./announcements.module.css"

/**
 * A withdrawal is one insert, but the action revalidates nine paths before it
 * answers — every coach, player and public surface the notice was reachable
 * from — and then re-reads the announcement. Matches the composer's publish
 * deadline for the same reason: courtside connections stall rather than fail,
 * and this only has to beat an indefinite hang. It is a deadline, not a
 * cancellation — see `withSaveDeadline`. Pin and unpin use it too.
 */
const actionDeadlineMs = 20_000

/** "Homepage and player home", "Homepage only" or "Player home only". */
export function whereItShows(channels: readonly AnnouncementChannel[]) {
  const homepage = channels.includes("homepage")
  if (homepage && channels.includes("player_dashboard")) return "Homepage and player home"
  return homepage ? "Homepage only" : "Player home only"
}

/** "23 Nov": the last day a notice shows. */
export function lastDayLabel(expiresOn: string) {
  return formatDateKey(expiresOn, { month: "short", weekday: undefined })
}

/** "12 Nov", or "12 Nov 2026": the day a notice went out or came down. */
export function shortDayLabel(instant: string, withYear = false) {
  return formatAcademyDate(instant, { month: "short", year: withYear ? "numeric" : undefined })
}

function WithdrawPanel({
  announcementId,
  onClose,
  onFailureAfterExit,
  onReasonChange,
  onWithdrawn,
  reason,
  returnFocus,
}: {
  announcementId: string
  onClose: () => void
  onFailureAfterExit: (message: string) => void
  onReasonChange: (reason: string) => void
  onWithdrawn: (message: string) => void
  reason: string
  /** The Withdraw button, back on screen once this panel has gone. */
  returnFocus: RefObject<HTMLButtonElement | null>
}) {
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  /**
   * Set once this panel has left the screen, for the reason given over the
   * composer's review dialog: a failure that arrives afterwards has no notice
   * here left to render it, so it is handed to the announcement's own notice
   * instead. A success needs no such treatment — `onWithdrawn` already writes to
   * that same notice and moves no focus. Cleared on every mount because an
   * effect cleanup also runs between Strict Mode's paired development mounts.
   */
  const dismissed = useRef(false)
  const fieldId = `withdraw-reason-${announcementId}`

  useEffect(() => {
    dismissed.current = false
    reasonRef.current?.focus()
    return () => {
      dismissed.current = true
      // Read at cleanup on purpose: by then the Withdraw button has taken this
      // panel's place, and it is that new button focus returns to.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      returnFocus.current?.focus()
    }
  }, [returnFocus])

  async function withdraw() {
    const normalizedReason = reason.trim()
    if (!normalizedReason) {
      setFeedback({ message: "Enter why this announcement is being withdrawn.", tone: "error" })
      reasonRef.current?.focus()
      return
    }
    if (pending) return
    setPending(true)
    setFeedback(null)
    try {
      const result = await withSaveDeadline(
        withdrawAnnouncementAction({ announcementId, reason: normalizedReason }),
        actionDeadlineMs,
      )
      if (!result.ok) {
        // Already withdrawn: the screen is out of date, so close the panel and
        // let the refreshed announcement show the withdrawal.
        if (dismissed.current || result.code === "ALREADY_WITHDRAWN") {
          onFailureAfterExit(result.message)
          return
        }
        setFeedback({ message: result.message, tone: "error" })
        reasonRef.current?.focus()
        return
      }
      onWithdrawn(result.message)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "Your reason is still here",
        subject: "The withdrawal",
      })
      if (dismissed.current) {
        onFailureAfterExit(failure.message)
        return
      }
      setFeedback({ action: failure.signIn, message: failure.message, tone: "error" })
      reasonRef.current?.focus()
    } finally {
      setPending(false)
    }
  }

  /**
   * Keep it stays live while a withdrawal is in flight, for the reason given
   * over the composer's review dialog: the server action's fetch carries no
   * `AbortSignal` (lib/client/network-failure.ts:28-40), so a stalled connection
   * neither resolves nor rejects and a `pending` gate here is a lock with no key.
   * Leaving is safe because the reason the retry sends is the reason still on
   * screen: `broadcast_withdrawals` is uniquely indexed per announcement and
   * `withdrawAnnouncement` reports a repeat of the same reason as already done
   * rather than withdrawing twice. Withdraw now is held for the length of one
   * attempt; a coach who keeps it and presses Withdraw again gets a fresh panel
   * that can start a second, and that reason dedupe is what makes the second
   * land on the first withdrawal instead of failing beside it.
   */
  return (
    <div className={styles.withdraw}>
      <label className={styles.label} htmlFor={fieldId}>Why are you withdrawing it?</label>
      <div className={styles.field}>
        <textarea
          ref={reasonRef}
          id={fieldId}
          name="withdrawalReason"
          aria-describedby={`${fieldId}-help`}
          maxLength={250}
          onChange={(event) => {
            onReasonChange(event.target.value)
            setFeedback(null)
          }}
          placeholder="For example: the date changed"
          rows={2}
          value={reason}
        />
        <small id={`${fieldId}-help`} className={styles.help}>
          {reason.length}/250 · only the head coach sees this
        </small>
      </div>
      <InlineNotice
        action={feedback?.action}
        message={feedback?.message}
        reserveSpace={false}
        tone={feedback?.tone}
      />
      <div className={styles.actions}>
        <button className={styles.button} type="button" onClick={onClose}>Keep it</button>
        <button
          className={styles.danger}
          data-solid=""
          type="button"
          onClick={withdraw}
          disabled={pending}
        >
          {pending ? "Withdrawing…" : "Withdraw now"}
        </button>
      </div>
    </div>
  )
}

/**
 * One announcement's message, what has become of it, and Pin to top / Withdraw
 * while it is live. The same piece opens in place in the list and fills the
 * announcement's own page.
 */
export function AnnouncementBody({
  announcement,
  initialFeedback = null,
  onDone,
}: {
  announcement: CoachAnnouncementDetail
  initialFeedback?: ActionFeedback | null
  /** A pin, unpin or withdrawal went through; the refresh may take this away. */
  onDone?: (verb: "pinned" | "unpinned" | "withdrawn") => void
}) {
  const router = useRouter()
  const [pinPending, setPinPending] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  // Outlives the panel so keeping it mid-withdrawal keeps the typed reason: it
  // is both what the coach would have to retype and the value the service
  // dedupes a repeated withdrawal on.
  const [withdrawalReason, setWithdrawalReason] = useState("")
  const [feedback, setFeedback] = useState<ActionFeedback | null>(initialFeedback)
  const withdrawButtonRef = useRef<HTMLButtonElement>(null)
  const withdrawnNoteRef = useRef<HTMLParagraphElement>(null)
  // Set by a withdrawal from here, so the note it brings back takes focus from
  // the Withdraw button the refresh removes.
  const focusWithdrawnNote = useRef<boolean | null>(null)
  const { withdrawal } = announcement

  useEffect(() => {
    if (!withdrawal || !focusWithdrawnNote.current) return
    focusWithdrawnNote.current = null
    withdrawnNoteRef.current?.focus()
  }, [withdrawal])

  async function togglePin() {
    if (pinPending || announcement.status !== "active") return
    setPinPending(true)
    setFeedback(null)
    try {
      const result = await withSaveDeadline(setAnnouncementPinnedAction({
        announcementId: announcement.id,
        expectedPresentationRevision: announcement.presentationRevision,
        pinned: !announcement.pinned,
      }), actionDeadlineMs)
      if (!result.ok) {
        setFeedback({ message: result.message, tone: "error" })
        // A refusal means the notice changed elsewhere; show it as it is now.
        router.refresh()
        return
      }
      setFeedback({
        message: announcement.pinned ? "Announcement unpinned" : "Announcement pinned",
        tone: "success",
      })
      onDone?.(announcement.pinned ? "unpinned" : "pinned")
      router.refresh()
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "Nothing was changed",
        subject: announcement.pinned ? "Unpinning the announcement" : "Pinning the announcement",
        unconfirmed: "Reload the page to see whether it changed",
      })
      setFeedback({ action: failure.signIn, message: failure.message, tone: "error" })
    } finally {
      setPinPending(false)
    }
  }

  function handleWithdrawn(message: string) {
    setWithdrawOpen(false)
    setFeedback({ message, tone: "success" })
    focusWithdrawnNote.current = true
    onDone?.("withdrawn")
    router.refresh()
  }

  return (
    <div className={styles.body}>
      {withdrawal ? (
        <p ref={withdrawnNoteRef} className={styles.note} data-tone="red" tabIndex={-1}>
          Withdrawn on <time dateTime={withdrawal.withdrawnAt}>{shortDayLabel(withdrawal.withdrawnAt)}</time>:{" "}
          {withdrawal.reason}{/[.!?]$/u.test(withdrawal.reason) ? "" : "."} No one sees it now.
        </p>
      ) : announcement.status === "expired" && announcement.expiresOn ? (
        <p className={styles.note}>
          Its last day was {lastDayLabel(announcement.expiresOn)}. No one sees it now.
        </p>
      ) : null}

      <div className={styles.message}>
        {announcementParagraphs(announcement.content).map((paragraph, index) => (
          <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
        ))}
      </div>

      <InlineNotice
        action={feedback?.action}
        message={feedback?.message}
        reserveSpace={false}
        tone={feedback?.tone}
      />

      {/* An expired or withdrawn notice is already off every screen, so there is
          nothing left to pin or withdraw; it stays here as history. */}
      {announcement.status !== "active" ? null : withdrawOpen ? (
        <WithdrawPanel
          announcementId={announcement.id}
          onClose={() => setWithdrawOpen(false)}
          onFailureAfterExit={(message) => {
            setWithdrawOpen(false)
            setFeedback({ message, tone: "error" })
            router.refresh()
          }}
          onReasonChange={setWithdrawalReason}
          onWithdrawn={handleWithdrawn}
          reason={withdrawalReason}
          returnFocus={withdrawButtonRef}
        />
      ) : (
        <div className={styles.actions}>
          <button className={styles.button} type="button" onClick={togglePin} disabled={pinPending}>
            {pinPending ? "Updating…" : announcement.pinned ? "Unpin" : "Pin to top"}
          </button>
          <button
            ref={withdrawButtonRef}
            className={styles.danger}
            type="button"
            onClick={() => setWithdrawOpen(true)}
          >
            Withdraw
          </button>
        </div>
      )}
    </div>
  )
}

export function PublishedAnnouncementDetail({
  announcement,
  backHref,
  publishedNow,
}: {
  announcement: CoachAnnouncementDetail
  backHref: string
  publishedNow?: boolean
}) {
  // The success note is shown once; drop ?published=1 so a reload does not
  // bring it back over a notice that may since have been withdrawn.
  useEffect(() => {
    if (!publishedNow) return
    const url = new URL(window.location.href)
    url.searchParams.delete("published")
    window.history.replaceState(null, "", url)
  }, [publishedNow])

  return (
    <div className={`${styles.page} page-shell`}>
      <nav className={styles.back} aria-label="Announcement navigation">
        <Link href={backHref}><ArrowLeft aria-hidden="true" /> Back to Announcements</Link>
      </nav>

      <article className={styles.single} data-status={announcement.status}>
        <header className={styles.band}>
          <h1>{announcement.title}</h1>
          <p>
            Published{" "}
            <time dateTime={announcement.publishedAt}>
              {shortDayLabel(announcement.publishedAt, true)}
            </time>
            {" · "}{whereItShows(announcement.channels).toLowerCase()}
            {announcement.expiresOn ? ` · until ${lastDayLabel(announcement.expiresOn)}` : ""}
          </p>
        </header>
        <AnnouncementBody
          announcement={announcement}
          initialFeedback={publishedNow ? { message: "Announcement published", tone: "success" } : null}
        />
      </article>
    </div>
  )
}
