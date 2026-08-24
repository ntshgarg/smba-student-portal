"use client"

import { ArrowRight, MailCheck } from "lucide-react"

import {
  type RecoveryEmailEnrollmentState,
} from "@/app/account/recovery-email/actions"
import { useResilientActionState } from "@/lib/client/use-resilient-action-state"

const initialRecoveryEmailEnrollmentState: RecoveryEmailEnrollmentState = {
  email: "",
  error: null,
  sent: false,
}

type EnrollmentAction = (
  state: RecoveryEmailEnrollmentState,
  formData: FormData,
) => Promise<RecoveryEmailEnrollmentState>

export function RecoveryEmailEnrollmentForm({
  collectName = false,
  confirmAction,
  defaultName = "",
  requestAction,
}: {
  collectName?: boolean
  confirmAction: EnrollmentAction
  defaultName?: string
  requestAction: EnrollmentAction
}) {
  const [requestState, send, sending] = useResilientActionState(
    requestAction,
    { ...initialRecoveryEmailEnrollmentState, fullName: defaultName },
    { retained: "No verification code was sent", subject: "Your recovery email" },
  )
  const [confirmState, confirm, confirming] = useResilientActionState(
    confirmAction,
    initialRecoveryEmailEnrollmentState,
    {
      retained: "The code was not used and is still valid",
      subject: "Your verification code",
    },
  )
  const sent = requestState.sent || confirmState.sent
  const email = confirmState.email || requestState.email
  const fullName = confirmState.fullName || requestState.fullName || defaultName

  if (sent) {
    return (
      <form className="login-form" action={confirm} noValidate>
        <div className="recovery-email-sent" role="status">
          <MailCheck aria-hidden="true" />
          <div>
            <strong>Check your email</strong>
            <p>Enter the six-digit code sent to {email}.</p>
          </div>
        </div>
        <input type="hidden" name="email" value={email} />
        {collectName ? <input type="hidden" name="fullName" value={fullName} /> : null}
        <div className="login-field">
          <label htmlFor="recovery-email-code">Verification code</label>
          <input
            id="recovery-email-code"
            name="code"
            type="text"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            aria-describedby="recovery-email-code-help"
          />
          <p id="recovery-email-code-help" className="login-helper">
            The code expires in ten minutes and can be tried five times.
          </p>
        </div>
        {confirmState.error || requestState.error ? (
          <p className="login-error" role="alert">{confirmState.error ?? requestState.error}</p>
        ) : null}
        <button className="login-submit" type="submit" disabled={confirming}>
          <span>{confirming ? "Verifying…" : "Verify recovery email"}</span>
          <ArrowRight aria-hidden="true" />
        </button>
        <button className="totp-switch" type="submit" formAction={send} disabled={sending || confirming}>
          {sending ? "Sending another code…" : "Send another code"}
        </button>
      </form>
    )
  }

  return (
    <form className="login-form" action={send} noValidate>
      {collectName ? (
        <div className="login-field">
          <label htmlFor="recovery-email-full-name">Full name</label>
          <input
            id="recovery-email-full-name"
            name="fullName"
            autoComplete="name"
            minLength={2}
            maxLength={80}
            defaultValue={fullName}
            required
          />
        </div>
      ) : null}
      <div className="login-field">
        <label htmlFor="recovery-email">Recovery email</label>
        <input
          id="recovery-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          defaultValue={email}
          required
          aria-describedby="recovery-email-help"
        />
        <p id="recovery-email-help" className="login-helper">
          This address is used only for account security and may be shared by siblings.
        </p>
      </div>
      {requestState.error ? <p className="login-error" role="alert">{requestState.error}</p> : null}
      <button className="login-submit" type="submit" disabled={sending}>
        <span>{sending ? "Sending code…" : "Send verification code"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
