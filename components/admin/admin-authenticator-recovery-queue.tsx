"use client"

import { useState, useTransition } from "react"
import { ShieldAlert } from "lucide-react"

import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"

import {
  approveAuthenticatorResetRequestAction,
  rejectAuthenticatorResetRequestAction,
} from "@/app/admin/actions"

type AuthenticatorResetRequest = {
  academyId: string
  expiresAt: string
  fullName: string
  id: string
  maskedEmail: string
  requestedAt: string
}

function readableDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function AdminAuthenticatorRecoveryQueue({
  requests,
}: {
  requests: AuthenticatorResetRequest[]
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [pending, startTransition] = useTransition()

  /*
   * This was the last mutating surface in the product printing a raw transport
   * string: `error.message` on a dropped request is authored by the browser, so
   * the platform owner's record of a security decision they had just verified
   * out of band read "Failed to fetch" in Chrome and "Load failed" in Safari --
   * with no statement of whether the reset had been granted, on a queue where
   * the request stays looking untouched either way.
   *
   * `describeSaveFailure` supplies that statement. The tone travels with the
   * message rather than beside it, because this one slot carries three
   * outcomes -- the decision landed, the server refused it, the request never
   * arrived -- and the previous single string would have rendered all three in
   * whichever tone was hard-coded.
   */
  function decide(requestId: string, decision: "approve" | "reject") {
    setBusyId(requestId)
    setFeedback(null)
    startTransition(async () => {
      try {
        const result = decision === "approve"
          ? await approveAuthenticatorResetRequestAction(requestId)
          : await rejectAuthenticatorResetRequestAction(requestId)
        setFeedback({ message: result.message, tone: result.ok ? "success" : "error" })
      } catch (error) {
        setFeedback({
          message: describeSaveFailure({
            error,
            fallbackMessage: "The recovery decision could not be saved",
            retained: "The request is still pending",
            subject: "The recovery decision",
          }).message,
          tone: "error",
        })
      } finally {
        setBusyId(null)
      }
    })
  }

  return (
    <section className="admin-support-panel" aria-labelledby="admin-authenticator-recovery-title">
      <header>
        <div>
          <p className="eyebrow">Security approvals</p>
          <h2 id="admin-authenticator-recovery-title">Authenticator recovery</h2>
          <p>Approve only after confirming the head coach’s identity outside the website.</p>
        </div>
        <span>{requests.length} pending</span>
      </header>
      <InlineNotice
        message={feedback?.message}
        reserveSpace={false}
        tone={feedback?.tone}
      />
      <div className="admin-support-list">
        {requests.map((request) => (
          <article key={request.id}>
            <ShieldAlert aria-hidden="true" />
            <div>
              <small>Head coach · {request.academyId}</small>
              <strong>{request.fullName}</strong>
              <span>Verified email {request.maskedEmail}</span>
              <span>Requested {readableDate(request.requestedAt)} · Expires {readableDate(request.expiresAt)}</span>
            </div>
            <div className="admin-support-actions">
              <button
                type="button"
                disabled={pending}
                onClick={() => decide(request.id, "reject")}
              >
                Reject
              </button>
              <button
                className="is-approve"
                type="button"
                disabled={pending}
                onClick={() => decide(request.id, "approve")}
              >
                {pending && busyId === request.id ? "Working…" : "Approve reset"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
