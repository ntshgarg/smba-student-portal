"use client"

import { Undo2 } from "lucide-react"
import { useState } from "react"

import { undoRegistrationRejectionAction } from "@/app/coach/actions"
import { InlineNotice } from "@/components/inline-notice"
import type { RejectedRegistration } from "@/lib/auth/registration-form"
import { describeSaveFailure } from "@/lib/client/network-failure"

import styles from "./player-onboarding-register.module.css"
import { folio, shortDate } from "./register/shared"

/** Rejected requests, so a mistaken rejection can be found and undone. */
export function RejectedRequests({
  onRestored,
  requests,
}: {
  onRestored: (input: { message: string }) => void
  requests: RejectedRegistration[]
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ message: string; requestId: string; tone: "error" } | null>(null)

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
      setFeedback({ message: failure.message, requestId: request.id, tone: "error" })
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
    <section className={styles.register} aria-labelledby="rejected-requests-title">
      <div className={styles.registerHeading}>
        <h2 id="rejected-requests-title">Rejected requests</h2>
        <p><strong>{requests.length}</strong> not accepted · Undo puts a request back in review</p>
      </div>
      <ol className={styles.rows}>
        {requests.map((request, index) => (
          <li key={request.id}>
            <div className={styles.row}>
              <span className={styles.folio}>{folio(index)}</span>
              <div className={styles.identity}>
                <strong>{request.fullName}</strong>
                <small>{request.contactEmail}</small>
              </div>
              <span className={styles.stageStamp}>Rejected</span>
              <div className={styles.nextAction}>
                <strong>{request.requestedRole === "coach" ? "Assistant coach" : "Player"}</strong>
                <small>{request.rejectedAt ? `Rejected ${shortDate(request.rejectedAt)}` : "Rejected"}</small>
              </div>
              <button
                className={styles.openButton}
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => void undo(request)}
              >
                {busyId === request.id ? "Undoing…" : "Undo rejection"}
                <Undo2 aria-hidden="true" />
              </button>
            </div>
            {feedback?.requestId === request.id ? (
              <InlineNotice message={feedback.message} tone={feedback.tone} reserveSpace={false} />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}
