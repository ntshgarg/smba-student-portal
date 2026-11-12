"use client"

import { Undo2 } from "lucide-react"
import { useState } from "react"

import { undoRegistrationRejectionAction } from "@/app/coach/actions"
import { InlineNotice } from "@/components/inline-notice"
import type { RejectedRegistration } from "@/lib/auth/registration-form"
import { describeSaveFailure } from "@/lib/client/network-failure"

import styles from "./rejected-requests.module.css"
import { shortDate, type SaveFeedback } from "./register/shared"

/**
 * Rejected requests used to vanish from every screen the moment Reject was
 * pressed, while the family's name and email kept answering "not accepted" for
 * good. One mis-tap locked a family out with nothing here for the coach to act
 * on. This list is where a rejection can be found again and undone.
 *
 * Undo only puts the request back in the review queue; approving it is still
 * the separate, deliberate step it always was. Closed by default: it is a place
 * to look things up, not a queue of work.
 */
export function RejectedRequests({
  onRestored,
  requests,
}: {
  onRestored: (input: { message: string }) => void
  requests: RejectedRegistration[]
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<(SaveFeedback & { requestId: string }) | null>(null)

  if (!requests.length) return null

  async function undo(request: RejectedRegistration) {
    if (busyId) return
    setBusyId(request.id)
    setFeedback(null)
    let result: Awaited<ReturnType<typeof undoRegistrationRejectionAction>>
    try {
      result = await undoRegistrationRejectionAction(request.id)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The rejection could not be undone",
        retained: "The request is still rejected",
        subject: "The undo",
      })
      setFeedback({
        message: failure.message,
        offerRetry: failure.offerRetry,
        requestId: request.id,
        tone: "error",
      })
      return
    } finally {
      setBusyId(null)
    }
    if (!result.ok) {
      setFeedback({ message: result.message, requestId: request.id, tone: "error" })
      return
    }
    onRestored({
      message: `${request.fullName}’s request is back in the queue for review. Nothing was approved.`,
    })
  }

  return (
    <section className={styles.rejected} aria-labelledby="rejected-requests-title">
      <details>
        <summary>
          <h2 id="rejected-requests-title">Rejected requests</h2>
          <p>
            <strong>{requests.length}</strong> not accepted · Open to undo a rejection
          </p>
        </summary>
        <p className={styles.help}>
          The family is told their registration was not accepted and to contact the academy.
          Undoing a rejection puts the request back in the queue above for you to review again.
        </p>
        <ol className={styles.rows}>
          {requests.map((request) => (
            <li key={request.id}>
              <div className={styles.identity}>
                <strong>{request.fullName}</strong>
                <small>
                  {[
                    request.requestedRole === "coach" ? "Assistant coach" : "Player",
                    request.rejectedAt ? `Rejected ${shortDate(request.rejectedAt)}` : "Rejected",
                    request.contactEmail,
                  ].filter(Boolean).join(" · ")}
                </small>
              </div>
              <button
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => void undo(request)}
              >
                <Undo2 aria-hidden="true" />
                {busyId === request.id
                  ? "Undoing…"
                  : feedback?.requestId === request.id && feedback.offerRetry
                    ? "Undo rejection again"
                    : "Undo rejection"}
              </button>
              {feedback?.requestId === request.id ? (
                <InlineNotice
                  className={styles.notice}
                  message={feedback.message}
                  tone={feedback.tone}
                  reserveSpace={false}
                />
              ) : null}
            </li>
          ))}
        </ol>
      </details>
    </section>
  )
}
