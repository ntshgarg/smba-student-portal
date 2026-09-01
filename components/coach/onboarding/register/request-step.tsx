"use client"

import { ArrowRight, X } from "lucide-react"
import { useState } from "react"

import {
  approveRegistrationAction,
  rejectRegistrationAction,
} from "@/app/coach/actions"
import { InlineNotice } from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { PlayerOnboardingCase } from "@/lib/coach/onboarding"

import styles from "../player-onboarding-register.module.css"
import { shortDate, type SaveFeedback } from "./shared"

/**
 * Approve and reject share one notice, so the retry prompt names which of the
 * two the coach should repeat.
 */
type RequestStepFeedback = SaveFeedback & {
  retryAction?: "approve" | "reject"
}

export function RequestStep({
  item,
  onSuccess,
}: {
  item: PlayerOnboardingCase
  onSuccess: (input: {
    message: string
    remove?: boolean
  }) => void
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null)
  const [feedback, setFeedback] = useState<RequestStepFeedback | null>(null)

  async function approve() {
    if (busy) return
    setBusy("approve")
    setFeedback(null)
    let result: Awaited<ReturnType<typeof approveRegistrationAction>>
    try {
      result = await approveRegistrationAction(item.id, item.requestedRole)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "Approval could not be saved",
        retained: "The request is still on screen",
        subject: "The approval",
      })
      setFeedback({
        message: failure.message,
        offerRetry: failure.offerRetry,
        retryAction: "approve",
        tone: "error",
      })
      return
    } finally {
      setBusy(null)
    }
    if (!result.ok) {
      setFeedback({ message: result.message, tone: "error" })
      return
    }
    onSuccess({
      message: item.requestedRole === "coach"
        ? `${result.data.fullName} approved as ${result.data.academyId}. They can activate their staff account in the registration browser.`
        : `${result.data.fullName} approved as ${result.data.academyId}. Continue with the court assessment.`,
      remove: item.requestedRole === "coach",
    })
  }

  async function reject() {
    if (busy || !window.confirm(`Reject ${item.fullName}’s registration request?`)) return
    setBusy("reject")
    setFeedback(null)
    let result: Awaited<ReturnType<typeof rejectRegistrationAction>>
    try {
      result = await rejectRegistrationAction(item.id)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        fallbackMessage: "The rejection could not be saved",
        retained: "The request is still on screen",
        subject: "The rejection",
      })
      setFeedback({
        message: failure.message,
        offerRetry: failure.offerRetry,
        retryAction: "reject",
        tone: "error",
      })
      return
    } finally {
      setBusy(null)
    }
    if (!result.ok) {
      setFeedback({ message: result.message, tone: "error" })
      return
    }
    onSuccess({ message: `${item.fullName}’s request was rejected.`, remove: true })
  }

  const retryAction = feedback?.offerRetry ? feedback.retryAction : undefined

  return (
    <div className={styles.requestStep} aria-busy={Boolean(busy)}>
      {/*
        * A name, a type and a date was everything an approval used to rest on --
        * two people of the same name were indistinguishable here. The contact
        * details now arrive with the request, verified, so the coach can tell
        * them apart and reach the person without asking for the number later.
        *
        * All three are optional: requests made before registration collected them
        * still sit in this queue, and a coach entering someone by hand has none.
        */}
      <dl className={styles.requestFacts}>
        <div><dt>{item.requestedRole === "coach" ? "Junior coach" : "Player"}</dt><dd>{item.fullName}</dd></div>
        <div><dt>Request type</dt><dd>{item.requestedRole === "coach" ? "Coaching staff" : "Academy membership"}</dd></div>
        <div><dt>Received</dt><dd>{item.requestedAt ? shortDate(item.requestedAt) : "Recently"}</dd></div>
        {item.dateOfBirth ? (
          <div><dt>Date of birth</dt><dd>{shortDate(item.dateOfBirth)}</dd></div>
        ) : null}
        {item.contactEmail ? (
          <div><dt>Contact email</dt><dd>{item.contactEmail}</dd></div>
        ) : null}
        {item.contactPhone ? (
          <div><dt>Contact mobile</dt><dd>{item.contactPhone}</dd></div>
        ) : null}
      </dl>
      <InlineNotice message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
      <div className={styles.formActions}>
        <button type="button" disabled={Boolean(busy)} onClick={() => void reject()}>
          <X aria-hidden="true" /> {busy === "reject"
            ? "Rejecting…"
            : retryAction === "reject" ? "Reject request again" : "Reject request"}
        </button>
        <button className={styles.primaryButton} type="button" disabled={Boolean(busy)} onClick={() => void approve()}>
          {busy === "approve"
            ? "Approving…"
            : retryAction === "approve"
              ? "Approve again"
              : item.requestedRole === "coach" ? "Approve staff access" : "Approve & continue"} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
