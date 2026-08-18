"use client"

import { useActionState } from "react"
import { ArrowRight, MailCheck } from "lucide-react"

import {
  requestPasswordRecoveryAction,
  type RecoveryRequestState,
} from "@/app/recover/actions"

const initialState: RecoveryRequestState = { error: null, sent: false }

export function RecoveryForm() {
  const [state, formAction, pending] = useActionState(requestPasswordRecoveryAction, initialState)
  if (state.sent) {
    return (
      <div className="registration-confirmation" role="status">
        <MailCheck aria-hidden="true" />
        <h2>Check your email.</h2>
        <p>If the Academy ID and verified email match an active account, a secure reset link is on its way.</p>
        <p>The link expires in 20 minutes. You can close this page.</p>
      </div>
    )
  }
  return (
    <form className="login-form" action={formAction} noValidate>
      <div className="login-field">
        <label htmlFor="recovery-academy-id">SMBA username</label>
        <input id="recovery-academy-id" name="academyId" autoComplete="username" maxLength={15} required />
      </div>
      <div className="login-field">
        <label htmlFor="recovery-email">Verified recovery email</label>
        <input id="recovery-email" name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} required aria-describedby="recovery-email-help" />
        <p id="recovery-email-help" className="login-helper">Use the address verified during account setup.</p>
      </div>
      {state.error ? <p className="login-error" role="alert">{state.error}</p> : null}
      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Sending secure link…" : "Email reset link"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
