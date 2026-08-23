"use client"

import { useState, useTransition } from "react"
import { ShieldAlert } from "lucide-react"

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
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function decide(requestId: string, decision: "approve" | "reject") {
    setBusyId(requestId)
    setMessage(null)
    startTransition(async () => {
      try {
        const result = decision === "approve"
          ? await approveAuthenticatorResetRequestAction(requestId)
          : await rejectAuthenticatorResetRequestAction(requestId)
        setMessage(result.message)
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "The recovery decision could not be saved",
        )
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
      {message ? <p className="admin-support-message" role="status">{message}</p> : null}
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
