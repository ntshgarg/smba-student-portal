"use client"

import { useActionState } from "react"
import { MailCheck, ShieldCheck } from "lucide-react"

import {
  confirmRecoveryEmailChange,
  requestRecoveryEmailChange,
  type RecoveryEmailEnrollmentState,
} from "@/app/account/recovery-email/actions"

const initialRecoveryEmailEnrollmentState: RecoveryEmailEnrollmentState = {
  email: "",
  error: null,
  sent: false,
}

export function RecoveryEmailSecurityPanel({
  maskedEmail,
  requiresSecondFactor,
}: {
  maskedEmail: string
  requiresSecondFactor: boolean
}) {
  const [requestState, requestAction, requesting] = useActionState(
    requestRecoveryEmailChange,
    initialRecoveryEmailEnrollmentState,
  )
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmRecoveryEmailChange,
    initialRecoveryEmailEnrollmentState,
  )
  const sent = requestState.sent || confirmState.sent
  const email = confirmState.email || requestState.email

  return (
    <section className="security-panel" aria-labelledby="recovery-email-security-title">
      <header>
        <MailCheck aria-hidden="true" />
        <div>
          <p className="eyebrow">Account recovery</p>
          <h2 id="recovery-email-security-title">Recovery email</h2>
        </div>
      </header>
      <p>Verified address: <strong>{maskedEmail}</strong></p>
      {sent ? (
        <form className="security-form" action={confirmAction} noValidate>
          <input type="hidden" name="email" value={email} />
          <label>
            Verification code
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required />
          </label>
          <p>Enter the six-digit code sent to the new address.</p>
          {confirmState.error ? <p className="login-error" role="alert">{confirmState.error}</p> : null}
          <button type="submit" disabled={confirming}>{confirming ? "Verifying…" : "Confirm new email"}</button>
        </form>
      ) : (
        <form className="security-form" action={requestAction} noValidate>
          <label>
            New recovery email
            <input name="email" type="email" autoComplete="email" maxLength={254} required />
          </label>
          <label>
            Current password
            <input name="currentPassword" type="password" autoComplete="current-password" required />
          </label>
          {requiresSecondFactor ? (
            <label>
              Authenticator or backup code
              <input name="secondFactor" type="text" autoComplete="one-time-code" required />
            </label>
          ) : null}
          <p>A new address becomes active only after its verification code is confirmed.</p>
          {requestState.error ? <p className="login-error" role="alert">{requestState.error}</p> : null}
          <button type="submit" disabled={requesting}>
            <ShieldCheck aria-hidden="true" />
            {requesting ? "Sending code…" : "Change recovery email"}
          </button>
        </form>
      )}
    </section>
  )
}
