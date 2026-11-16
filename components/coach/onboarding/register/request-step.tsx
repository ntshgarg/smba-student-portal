"use client"

import { ArrowRight, Eye, X } from "lucide-react"
import { useState } from "react"

import {
  approveRegistrationAction,
  rejectRegistrationAction,
} from "@/app/coach/actions"
import { initials } from "@/components/coach/members/directory/shared"
import { InlineNotice } from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type { OnboardingDuplicateSignal, PlayerOnboardingCase } from "@/lib/coach/onboarding"

import styles from "../player-onboarding-register.module.css"
import { OnboardingTimeline } from "./onboarding-timeline"
import { shortDate, shortInstant, type SaveFeedback } from "./shared"

/**
 * Approve and reject share one notice, so the retry prompt names which of the
 * two the coach should repeat.
 */
type RequestStepFeedback = SaveFeedback & {
  retryAction?: "approve" | "reject"
}

function duplicateStandingLabel(signal: OnboardingDuplicateSignal) {
  switch (signal.standing) {
    case "archived":
      return signal.academyId ? `was ${signal.academyId}, has left the academy` : "has left the academy"
    case "pending":
      return "request waiting"
    case "approved":
      return signal.academyId ?? null
  }
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
  const [contactShown, setContactShown] = useState(false)

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
        retained: "The request is still on screen",
        subject: "The approval",
      })
      setFeedback({
        action: failure.signIn,
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
    const baseMessage = item.requestedRole === "coach"
      ? `${result.data.fullName} approved as ${result.data.academyId}. They can now activate their staff account from any device.`
      : `${result.data.fullName} approved as ${result.data.academyId}. Continue with the court assessment.`
    onSuccess({
      message: result.data.notificationDelivered
        ? baseMessage
        : `${baseMessage} Their Academy ID email couldn't be sent -- share ${result.data.academyId} with them directly.`,
      remove: item.requestedRole === "coach",
    })
  }

  async function reject() {
    if (busy || !window.confirm(
      `Reject ${item.fullName}’s registration request? You can undo this later from Rejected requests.`,
    )) return
    setBusy("reject")
    setFeedback(null)
    let result: Awaited<ReturnType<typeof rejectRegistrationAction>>
    try {
      result = await rejectRegistrationAction(item.id)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "The request is still on screen",
        subject: "The rejection",
      })
      setFeedback({
        action: failure.signIn,
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
    onSuccess({
      message: `${item.fullName}’s request was rejected. To change your mind, open Rejected requests below the register.`,
      remove: true,
    })
  }

  const retryAction = feedback?.offerRetry ? feedback.retryAction : undefined
  const staff = item.requestedRole === "coach"
  const contact = [
    item.dateOfBirth ? { label: "Date of birth", value: shortDate(item.dateOfBirth) } : null,
    item.contactEmail ? { label: "Email", value: item.contactEmail } : null,
    item.contactPhone ? { label: "Mobile", value: item.contactPhone } : null,
  ].filter((entry) => entry !== null)

  return (
    <div className={styles.stepBody} aria-busy={Boolean(busy)}>
      {staff ? (
        <p className={styles.facts}>
          <span>Assistant coach</span>
          <span>Coaching staff</span>
          <span>Received {item.requestedAt ? shortInstant(item.requestedAt) : "recently"}</span>
        </p>
      ) : <OnboardingTimeline item={item} />}
      {/*
        * A name, a type and a date was everything an approval used to rest on --
        * two people of the same name were indistinguishable here. The contact
        * details now arrive with the request, verified, so the coach can tell
        * them apart and reach the person without asking for the number later.
        *
        * All three are optional: requests made before registration collected them
        * still sit in this queue, and a coach entering someone by hand has none.
        */}
      {contact.length ? (
        <div className={styles.contactBox}>
          <div>
            <span className={styles.label}>Contact</span>
            {contactShown ? (
              <dl id={`onboarding-${item.id}-contact`}>
                {contact.map((entry) => (
                  <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>
                ))}
              </dl>
            ) : (
              <p>{contact.map((entry) => entry.label).join(", ")}</p>
            )}
          </div>
          {contactShown ? null : (
            <button className={styles.button} type="button" onClick={() => setContactShown(true)}>
              <Eye aria-hidden="true" /> Show contact
            </button>
          )}
        </div>
      ) : null}
      {/*
        * Shown, never enforced. The registration identity is the contact address
        * and the name together, so a second request under a differently spelled
        * name is a new identity and the unique index lets it through -- which is
        * correct, because siblings really do share one address. What it cannot
        * judge is whether these two rows are one child typed twice, and a coach
        * can. Approving both remains one click away; the point is that the
        * question is asked before it is.
        */}
      {item.duplicateSignals?.length ? (
        <div className={styles.duplicate} role="note">
          <strong>
            {item.duplicateSignals.length === 1
              ? "Someone already on record may be this person"
              : "People already on record who may be this person"}
          </strong>
          <ul>
            {item.duplicateSignals.map((signal, index) => (
              <li key={`${signal.fullName}-${signal.reason}-${signal.standing}-${signal.academyId ?? "none"}-${index}`}>
                <span className={styles.badge} aria-hidden="true">{initials(signal.fullName)}</span>
                <span>
                  <strong>{signal.fullName}</strong>
                  {duplicateStandingLabel(signal)}
                </span>
                <span className={styles.why}>
                  {signal.reason === "same-contact"
                    ? "Same contact email"
                    : "Same name and date of birth, different email"}
                </span>
              </li>
            ))}
          </ul>
          <p>
            {item.duplicateSignals.some((signal) => signal.standing === "archived")
              ? "Someone who has left may be registering again. Approving gives them a new Academy ID; their earlier attendance and fees stay on the old record. "
              : null}
            Registering more than one player on one address is normal. Check the name and date of
            birth before approving.
          </p>
        </div>
      ) : null}
      <InlineNotice action={feedback?.action} message={feedback?.message} tone={feedback?.tone} reserveSpace={false} />
      <div className={styles.formActions}>
        <button className={styles.dangerButton} type="button" disabled={Boolean(busy)} onClick={() => void reject()}>
          <X aria-hidden="true" /> {busy === "reject"
            ? "Rejecting…"
            : retryAction === "reject" ? "Reject request again" : "Reject request"}
        </button>
        <button className={styles.primaryButton} type="button" disabled={Boolean(busy)} onClick={() => void approve()}>
          {busy === "approve"
            ? "Approving…"
            : retryAction === "approve"
              ? "Approve again"
              : staff ? "Approve staff access" : "Approve & continue"} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
