"use client"

import { ArrowUpRight, Check } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { prepareMonthlyChargesAction } from "@/app/coach/financials/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { MonthlyPreparationPreview, MonthlyPreparationSkip } from "@/lib/finance/types"

import {
  periodLabel,
  resultFeedback,
  useIdempotencyKey,
} from "./financials-client-utils"
import styles from "./financials.module.css"

/**
 * `offerRetry` rides on the feedback so every existing `setFeedback(null)` also
 * withdraws the retry prompt.
 */
type SaveFeedback = ActionFeedback & { offerRetry?: boolean }

const monthOnlyFormat = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" })

function monthOnly(period: string) {
  const [year, month] = period.split("-").map(Number)
  if (!year || !month) return period
  return monthOnlyFormat.format(new Date(Date.UTC(year, month - 1, 1)))
}

const skipGroups: Array<{ folded: boolean; reason: MonthlyPreparationSkip["reason"]; title: string }> = [
  { folded: false, reason: "term_finished", title: "Term finished" },
  { folded: false, reason: "level_changed", title: "Level changed since the fee plan" },
  // A break is chosen on purpose and can last months, so it is folded away.
  { folded: true, reason: "on_break", title: "On a break (fee plan kept)" },
]

/*
 * Who this month's fee issue passes over although they have a fee plan, by
 * name, so nobody is skipped without a word (head coach, 12 Nov 2026). Fee
 * issuing itself is unchanged: a month is billed only for a schedule that
 * reaches into it. Each name opens the player's record in Members, where they
 * are moved on, ended, or their fees stopped.
 */
function SkippedPlayers({ period, skipped }: { period: string; skipped: MonthlyPreparationSkip[] }) {
  if (!skipped.length) return null
  return (
    <div className={styles.preparationSkipped}>
      <p>
        <strong>Not issued: {skipped.length} {skipped.length === 1 ? "player has" : "players have"} a fee plan but no schedule in {monthOnly(period)}</strong>
      </p>
      {skipGroups.map(({ folded, reason, title }) => {
        const group = skipped.filter((item) => item.reason === reason)
        if (!group.length) return null
        const list = (
          <ul>
            {group.map((item) => (
              <li key={item.playerId}>
                <Link href={`/coach/members?player=${encodeURIComponent(item.playerId)}`}>{item.fullName}</Link>
              </li>
            ))}
          </ul>
        )
        return folded ? (
          <details key={reason}>
            <summary>{title} · {group.length}</summary>
            {list}
          </details>
        ) : (
          <div key={reason}>
            <span>{title} · {group.length}</span>
            {list}
          </div>
        )
      })}
    </div>
  )
}

export function PrepareFees({
  compact = false,
  currentPeriod,
  period,
  preparation,
}: {
  compact?: boolean
  /** The academy's current month; a later month's fees are not issued yet. */
  currentPeriod: string
  period: string
  preparation: MonthlyPreparationPreview
}) {
  const router = useRouter()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  const requestKey = useIdempotencyKey()
  // Issued fees never change, so issuing ahead of the month would freeze it
  // before this month's fee changes, concessions and endings could reach it.
  const notYet = period > currentPeriod
  const canIssue = preparation.ready > 0 && !notYet

  async function prepare() {
    if (pending || !canIssue) return
    setPending(true)
    try {
      const result = await prepareMonthlyChargesAction({
        idempotencyKey: requestKey.current(),
        period,
      })
      setFeedback(resultFeedback(result))
      if (result.ok) {
        requestKey.reset()
        setReviewOpen(false)
        router.refresh()
      }
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "No fees have been issued",
        unconfirmed: "Check the connection, then reload the page to see whether this month's fees were issued",
        subject: "The monthly fee issue",
      })
      setFeedback({
        action: failure.signIn,
        message: failure.message,
        offerRetry: failure.offerRetry,
        tone: "error",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={`${styles.preparation} ${compact ? styles.compactPreparation : ""}`} aria-labelledby="financial-preparation-title">
      <div className={styles.preparationHeading}>
        <div>
          <span>Monthly fee issue</span>
          <h2 id="financial-preparation-title">Issue {periodLabel(period)} fees</h2>
        </div>
        {!reviewOpen ? (
          <button
            type="button"
            disabled={!canIssue}
            onClick={() => setReviewOpen(true)}
          >
            {notYet
              ? `Opens 1 ${monthOnly(period)}`
              : preparation.ready > 0
                ? "Review fee issue"
                : preparation.alreadyPrepared > 0
                  ? "Fees issued"
                  : "No fees to issue"}
            {canIssue ? <ArrowUpRight aria-hidden="true" /> : notYet ? null : <Check aria-hidden="true" />}
          </button>
        ) : null}
      </div>

      <dl className={styles.preparationCounts}>
        <div><dt>Ready to issue</dt><dd>{preparation.ready}</dd></div>
        <div><dt>Already issued</dt><dd>{preparation.alreadyPrepared}</dd></div>
      </dl>

      {notYet ? null : <SkippedPlayers period={period} skipped={preparation.skipped} />}

      {notYet ? (
        <p className={styles.preparationNote}>
          {periodLabel(period)} fees can be issued from 1 {monthOnly(period)}, so every change made before then still reaches them.
        </p>
      ) : null}

      {reviewOpen && canIssue ? (
        <div className={styles.preparationReview}>
          <div>
            <strong>{preparation.ready} {preparation.ready === 1 ? "player is" : "players are"} ready</strong>
            <p>Only missing monthly charges will be issued. Running this again will not duplicate them.</p>
          </div>
          <div>
            <button className={styles.quietButton} type="button" disabled={pending} onClick={() => { requestKey.reset(); setReviewOpen(false) }}>
              Cancel
            </button>
            <button className={styles.primaryButton} type="button" disabled={pending} onClick={() => void prepare()}>
              {pending
                ? "Issuing…"
                : `Issue ${preparation.ready} ${preparation.ready === 1 ? "fee" : "fees"}${feedback?.offerRetry ? " again" : ""}`}
            </button>
          </div>
        </div>
      ) : null}

      <InlineNotice action={feedback?.action} className={styles.notice} message={feedback?.message} reserveSpace={!compact} tone={feedback?.tone} />
    </section>
  )
}
