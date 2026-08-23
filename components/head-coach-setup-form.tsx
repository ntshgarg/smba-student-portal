"use client"

import { useActionState, useEffect, useRef } from "react"

import {
  completeHeadCoachSetupAction,
  type HeadCoachSetupState,
} from "@/app/setup/head-coach/actions"
import { AuthField } from "@/components/auth-field"
import { PasswordInput } from "@/components/password-input"

const initialState: HeadCoachSetupState = { error: null }
const headCoachSetupErrorId = "head-coach-setup-error"

export function HeadCoachSetupForm({
  defaultName = "",
  recoveryEmail,
}: {
  defaultName?: string
  recoveryEmail: string
}) {
  const [state, action, pending] = useActionState(completeHeadCoachSetupAction, initialState)
  const fullNameRef = useRef<HTMLInputElement>(null)
  const submissionStartedRef = useRef(false)
  useEffect(() => {
    if (pending) {
      submissionStartedRef.current = true
      return
    }
    if (!submissionStartedRef.current || !state.error) return
    submissionStartedRef.current = false
    const timeout = window.setTimeout(() => fullNameRef.current?.focus(), 0)
    return () => window.clearTimeout(timeout)
  }, [pending, state])
  return (
    <form className="login-form head-coach-setup-form" action={action} noValidate>
      <AuthField
        id="head-full-name"
        label="Full name"
        errorId={state.error ? headCoachSetupErrorId : undefined}
      >
        {(control) => (
          <input {...control} ref={fullNameRef} name="fullName" autoComplete="name" minLength={2} maxLength={80} defaultValue={defaultName} required />
        )}
      </AuthField>
      <AuthField id="head-recovery-email" label="Verified recovery email">
        {(control) => <input {...control} name="recoveryEmail" value={recoveryEmail} readOnly />}
      </AuthField>
      <div className="setup-field-grid">
        <AuthField id="head-password" label="Create password">
          {(control) => (
            <PasswordInput {...control} name="password" autoComplete="new-password" minLength={12} maxLength={128} required />
          )}
        </AuthField>
        <AuthField id="head-password-confirm" label="Confirm password">
          {(control) => (
            <PasswordInput {...control} name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required />
          )}
        </AuthField>
      </div>
      <div className="setup-field-grid">
        <AuthField id="head-pin" label="Create 6-digit PIN">
          {(control) => (
            <input {...control} className="login-pin-input" name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required />
          )}
        </AuthField>
        <AuthField id="head-pin-confirm" label="Confirm PIN">
          {(control) => (
            <input {...control} className="login-pin-input" name="confirmPin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required />
          )}
        </AuthField>
      </div>
      <p className="login-helper">Your next step scans a QR code with Google Authenticator, Microsoft Authenticator, 1Password, or another TOTP app.</p>
      {state.error ? <p id={headCoachSetupErrorId} className="login-error" role="alert">{state.error}</p> : null}
      <button className="login-submit" type="submit" disabled={pending}>
        {pending ? "Creating secure account…" : "Create account and continue"}
      </button>
    </form>
  )
}
