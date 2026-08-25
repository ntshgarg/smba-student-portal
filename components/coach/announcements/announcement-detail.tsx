"use client"

import { ArrowLeft, Pin, PinOff, Undo2, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import {
  setAnnouncementPinnedAction,
  withdrawAnnouncementAction,
} from "@/app/coach/announcements/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { announcementParagraphs } from "@/components/announcements/announcement-presentation"
import { describeSaveFailure, withSaveDeadline } from "@/lib/client/network-failure"
import { formatAcademyDate, formatDateKey } from "@/lib/format"

import {
  announcementChannelLabel,
  announcementStatusLabel,
  type CoachAnnouncementDetail,
} from "./contracts"
import styles from "./announcements.module.css"

/**
 * A withdrawal is one insert, but the action revalidates nine paths before it
 * answers — every coach, player and public surface the notice was reachable
 * from — and then re-reads the announcement. Matches the composer's publish
 * deadline for the same reason: courtside connections stall rather than fail,
 * and this only has to beat an indefinite hang. It is a deadline, not a
 * cancellation — see `withSaveDeadline`.
 */
const withdrawDeadlineMs = 20_000

function WithdrawDialog({
  announcementId,
  onClose,
  onFailureAfterExit,
  onReasonChange,
  onWithdrawn,
  reason,
}: {
  announcementId: string
  onClose: () => void
  onFailureAfterExit: (message: string) => void
  onReasonChange: (reason: string) => void
  onWithdrawn: (message: string) => void
  reason: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  /**
   * Set once this dialog has left the screen, for the reason given over the
   * composer's review dialog: a failure that arrives afterwards has no notice
   * here left to render it, so it is handed to the detail page's notice instead.
   * A success needs no such treatment — `onWithdrawn` already writes to that
   * same notice and moves no focus. Cleared on every mount because an effect
   * cleanup also runs between Strict Mode's paired development mounts.
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
    reasonRef.current?.focus()
    return () => {
      dismissed.current = true
      document.body.style.overflow = previousOverflow
      if (dialog?.open) dialog.close()
      previouslyFocused?.focus()
    }
  }, [])

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
        withdrawDeadlineMs,
      )
      if (!result.ok) {
        if (dismissed.current) {
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
        fallbackMessage: "The announcement could not be withdrawn",
        retained: "Your reason is still here",
        subject: "The withdrawal",
      })
      if (dismissed.current) {
        onFailureAfterExit(failure.message)
        return
      }
      setFeedback({ message: failure.message, tone: "error" })
      reasonRef.current?.focus()
    } finally {
      setPending(false)
    }
  }

  /**
   * Every exit below stays live while a withdrawal is in flight, for the reason
   * given over the composer's review dialog: the server action's fetch carries
   * no `AbortSignal` (lib/client/network-failure.ts:28-40), so a stalled
   * connection neither resolves nor rejects and a `pending` gate here is a lock
   * with no key. Leaving is safe because the reason the retry sends is the
   * reason still on screen: `broadcast_withdrawals` is uniquely indexed per
   * announcement and `withdrawAnnouncement` reports a repeat of the same reason
   * as already done rather than withdrawing twice. The withdraw button is held
   * for the length of one attempt; a coach who closes this dialog and reopens it
   * gets a fresh one that can start a second, and that reason dedupe is what
   * makes the second land on the first withdrawal instead of failing beside it.
   */
  return (
    <dialog
      ref={dialogRef}
      className={styles.dialogBackdrop}
      aria-labelledby="withdraw-announcement-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className={styles.withdrawDialog} onMouseDown={(event) => event.stopPropagation()}>
        <button
          className={styles.dialogClose}
          type="button"
          onClick={onClose}
          aria-label="Close withdrawal dialog"
        >
          <X aria-hidden="true" />
        </button>
        <span>Published announcement</span>
        <h2 id="withdraw-announcement-title">Withdraw announcement?</h2>
        <p>The notice will disappear from active academy surfaces but remain in this history.</p>
        <label className={styles.field}>
          <span>Private reason</span>
          <textarea
            ref={reasonRef}
            name="withdrawalReason"
            aria-describedby="withdraw-reason-help"
            maxLength={250}
            onChange={(event) => {
              onReasonChange(event.target.value)
              setFeedback(null)
            }}
            placeholder="Event cancelled, timing changed…"
            rows={4}
            value={reason}
          />
          <small id="withdraw-reason-help" className={styles.fieldMessage}>
            {reason.length}/250 · visible only to the head coach
          </small>
        </label>
        <InlineNotice message={feedback?.message} tone={feedback?.tone} />
        <div className={styles.dialogActions}>
          <button type="button" onClick={onClose}>Keep announcement</button>
          <button
            className={styles.dangerButton}
            type="button"
            onClick={withdraw}
            disabled={pending}
          >
            {pending ? "Withdrawing…" : "Withdraw announcement"}
          </button>
        </div>
      </section>
    </dialog>
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
  const router = useRouter()
  const [pinPending, setPinPending] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  // Outlives the dialog so closing one mid-withdrawal keeps the typed reason:
  // it is both what the coach would have to retype and the value the service
  // dedupes a repeated withdrawal on.
  const [withdrawalReason, setWithdrawalReason] = useState("")
  const [feedback, setFeedback] = useState<ActionFeedback | null>(
    publishedNow ? { message: "Announcement published", tone: "success" } : null,
  )

  async function togglePin() {
    if (pinPending || announcement.status === "withdrawn") return
    setPinPending(true)
    setFeedback(null)
    try {
      const result = await setAnnouncementPinnedAction({
        announcementId: announcement.id,
        expectedPresentationRevision: announcement.presentationRevision,
        pinned: !announcement.pinned,
      })
      if (!result.ok) {
        setFeedback({ message: result.message, tone: "error" })
        return
      }
      setFeedback({
        message: announcement.pinned ? "Announcement unpinned" : "Announcement pinned",
        tone: "success",
      })
      router.refresh()
    } catch {
      setFeedback({ message: "The display priority could not be updated.", tone: "error" })
    } finally {
      setPinPending(false)
    }
  }

  function handleWithdrawn(message: string) {
    setWithdrawOpen(false)
    setFeedback({ message, tone: "success" })
    router.refresh()
  }

  return (
    <div className={`${styles.workspace} page-shell`}>
      <div className={styles.backRow}>
        <Link href={backHref}><ArrowLeft aria-hidden="true" /> Back to published announcements</Link>
      </div>

      <header className={styles.detailHeader}>
        <div>
          <span className="eyebrow">Published announcement</span>
          <h1>{announcement.title}</h1>
        </div>
        <span className={styles.detailStatus} data-status={announcement.status}>
          {announcementStatusLabel(announcement.status)}
        </span>
      </header>

      <InlineNotice className={styles.detailNotice} message={feedback?.message} tone={feedback?.tone} />

      <article className={styles.detailPanel}>
        <div className={styles.detailMessage}>
          {announcementParagraphs(announcement.content).map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
          ))}
        </div>

        <dl className={styles.detailMeta}>
          <div>
            <dt>Published</dt>
            <dd>
              <time dateTime={announcement.publishedAt}>
                {formatAcademyDate(announcement.publishedAt, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </time>
            </dd>
          </div>
          {announcement.expiresOn ? (
            <div>
              <dt>Available through</dt>
              <dd>{formatDateKey(announcement.expiresOn, {
                day: "numeric",
                month: "long",
                weekday: undefined,
                year: "numeric",
              })}</dd>
            </div>
          ) : null}
          <div>
            <dt>Appears on</dt>
            <dd className={styles.channelPills}>
              {announcement.channels.map((channel) => (
                <span key={channel}>{announcementChannelLabel(channel)}</span>
              ))}
            </dd>
          </div>
          <div>
            <dt>Display priority</dt>
            <dd>{announcement.pinned ? "Pinned" : "Standard"}</dd>
          </div>
        </dl>

        {announcement.withdrawal ? (
          <aside className={styles.withdrawalRecord}>
            <span>Withdrawal record</span>
            <p>{announcement.withdrawal.reason}</p>
            <time dateTime={announcement.withdrawal.withdrawnAt}>
              {formatAcademyDate(announcement.withdrawal.withdrawnAt, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </time>
          </aside>
        ) : null}

        {announcement.status !== "withdrawn" ? (
          <div className={styles.detailActions}>
            <button type="button" onClick={togglePin} disabled={pinPending}>
              {announcement.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
              {pinPending
                ? "Updating…"
                : announcement.pinned
                  ? "Unpin announcement"
                  : "Pin announcement"}
            </button>
            <button className={styles.withdrawButton} type="button" onClick={() => setWithdrawOpen(true)}>
              <Undo2 aria-hidden="true" />
              Withdraw announcement
            </button>
          </div>
        ) : null}
      </article>

      {withdrawOpen ? (
        <WithdrawDialog
          announcementId={announcement.id}
          onClose={() => setWithdrawOpen(false)}
          onFailureAfterExit={(message) => setFeedback({ message, tone: "error" })}
          onReasonChange={setWithdrawalReason}
          onWithdrawn={handleWithdrawn}
          reason={withdrawalReason}
        />
      ) : null}
    </div>
  )
}
