"use client"

import { useEffect, useRef } from "react"
import { ArrowRight, MailCheck } from "lucide-react"

import { AuthField } from "@/components/auth-field"
import { ACADEMY_ID_LABEL } from "@/lib/auth/identity"
import { useResilientActionState } from "@/lib/client/use-resilient-action-state"

import {
  requestPasswordRecoveryAction,
  type RecoveryRequestState,
} from "@/app/recover/actions"

const initialState: RecoveryRequestState = { error: null, sent: false }
const recoveryRequestErrorId = "recovery-request-error"

export function RecoveryForm() {
  const [state, formAction, pending] = useResilientActionState(
    requestPasswordRecoveryAction,
    initialState,
    { retained: "No reset email was sent", subject: "Your reset request" },
  )
  const academyIdRef = useRef<HTMLInputElement>(null)
  const submissionStartedRef = useRef(false)
  useEffect(() => {
    if (pending) {
      submissionStartedRef.current = true
      return
    }
    if (!submissionStartedRef.current || !state.error) return
    submissionStartedRef.current = false
    const timeout = window.setTimeout(() => academyIdRef.current?.focus(), 0)
    return () => window.clearTimeout(timeout)
  }, [pending, state])
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
      <AuthField
        id="recovery-academy-id"
        label={ACADEMY_ID_LABEL}
        errorId={state.error ? recoveryRequestErrorId : undefined}
      >
        {(control) => (
          <input {...control} ref={academyIdRef} name="academyId" autoComplete="username" maxLength={15} required />
        )}
      </AuthField>
      <AuthField
        id="recovery-email"
        label="Verified recovery email"
        helper="Use the address verified during account setup."
      >
        {(control) => (
          <input {...control} name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} required />
        )}
      </AuthField>
      {state.error ? <p id={recoveryRequestErrorId} className="login-error" role="alert">{state.error}</p> : null}
      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Sending secure link…" : "Email reset link"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
