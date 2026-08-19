"use client"

import { useActionState } from "react"
import { ArrowRight, MailCheck } from "lucide-react"

import {
  requestAuthenticatorRecoveryAction,
  submitAuthenticatorRecoveryApprovalAction,
  type AuthenticatorRecoveryApprovalState,
  type AuthenticatorRecoveryRequestState,
} from "@/app/auth/two-factor/recovery/actions"

const initialRequestState: AuthenticatorRecoveryRequestState = { error: null, sent: false }
const initialApprovalState: AuthenticatorRecoveryApprovalState = { error: null }

export function AuthenticatorRecoveryRequestForm() {
  const [state, action, pending] = useActionState(requestAuthenticatorRecoveryAction, initialRequestState)
  if (state.sent) {
    return (
      <div className="registration-confirmation" role="status">
        <MailCheck aria-hidden="true" />
        <h2>Check your recovery email.</h2>
        <p>If the username and verified email match the head-coach account, a secure link is on its way.</p>
        <p>Opening the link does not reset the authenticator. You must still request admin approval.</p>
      </div>
    )
  }
  return (
    <form className="login-form" action={action} noValidate>
      <div className="login-field">
        <label htmlFor="authenticator-recovery-id">SMBA username</label>
        <input id="authenticator-recovery-id" name="academyId" autoComplete="username" maxLength={15} required />
      </div>
      <div className="login-field">
        <label htmlFor="authenticator-recovery-email">Verified recovery email</label>
        <input
          id="authenticator-recovery-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          required
          aria-describedby="authenticator-recovery-email-help"
        />
        <p id="authenticator-recovery-email-help" className="login-helper">
          Use the recovery address verified during head-coach setup.
        </p>
      </div>
      {state.error ? <p className="login-error" role="alert">{state.error}</p> : null}
      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Sending secure link…" : "Email verification link"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}

export function AuthenticatorRecoveryApprovalForm({ academyId }: { academyId: string }) {
  const [state, action, pending] = useActionState(
    submitAuthenticatorRecoveryApprovalAction,
    initialApprovalState,
  )
  return (
    <form className="login-form" action={action} noValidate>
      <div className="registration-confirmation" role="status">
        <MailCheck aria-hidden="true" />
        <h2>Recovery email verified.</h2>
        <p>Submit an authenticator reset request for {academyId}. The platform admin must approve it.</p>
      </div>
      <aside className="totp-reconnect-note">
        Approval revokes every signed-in coach session. The password and PIN remain unchanged.
      </aside>
      {state.error ? <p className="login-error" role="alert">{state.error}</p> : null}
      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Submitting request…" : "Request admin approval"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
