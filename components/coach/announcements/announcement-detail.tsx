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
import { formatAcademyDate, formatDateKey } from "@/lib/format"

import {
  announcementChannelLabel,
  announcementStatusLabel,
  type CoachAnnouncementDetail,
} from "./contracts"
import styles from "./announcements.module.css"

function WithdrawDialog({
  announcementId,
  onClose,
  onWithdrawn,
}: {
  announcementId: string
  onClose: () => void
  onWithdrawn: (message: string) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    if (dialog && !dialog.open) dialog.showModal()
    document.body.style.overflow = "hidden"
    reasonRef.current?.focus()
    return () => {
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
      const result = await withdrawAnnouncementAction({
        announcementId,
        reason: normalizedReason,
      })
      if (!result.ok) {
        setFeedback({ message: result.message, tone: "error" })
        reasonRef.current?.focus()
        return
      }
      onWithdrawn(result.message)
    } catch {
      setFeedback({ message: "The announcement could not be withdrawn.", tone: "error" })
      reasonRef.current?.focus()
    } finally {
      setPending(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialogBackdrop}
      aria-labelledby="withdraw-announcement-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onClose()
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <section className={styles.withdrawDialog} onMouseDown={(event) => event.stopPropagation()}>
        <button
          className={styles.dialogClose}
          type="button"
          onClick={onClose}
          disabled={pending}
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
              setReason(event.target.value)
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
          <button type="button" onClick={onClose} disabled={pending}>Keep announcement</button>
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
          onWithdrawn={handleWithdrawn}
        />
      ) : null}
    </div>
  )
}
