"use client"

import { useEffect, useRef } from "react"

import {
  completeHeadCoachSetupAction,
  type HeadCoachSetupState,
} from "@/app/setup/head-coach/actions"
import { AuthField } from "@/components/auth-field"
import { PasswordInput } from "@/components/password-input"
import { useResilientActionState } from "@/lib/client/use-resilient-action-state"

const initialState: HeadCoachSetupState = { error: null, errorField: null }
const headCoachSetupErrorId = "head-coach-setup-error"

/*
 * Which control each refusal belongs to, and which one to move focus to.
 *
 * The form used to attach the shared error id to "Full name" and focus it for
 * every failure, so a mistyped Confirm PIN marked a correct field invalid and
 * moved a screen-reader user four fields above the mistake: "Full name, invalid
 * entry, The PINs do not match."
 *
 * `fullName` stays the target for a form-level failure -- the spent setup link,
 * or an account that was created but could not be signed in -- because those
 * belong to no field and the alternative is leaving focus on a submit button
 * whose page has just changed underneath it. That is the behaviour a previous
 * audit added; keeping it is the point of falling back rather than switching.
 */
const setupFieldIds = {
  confirmPassword: "head-password-confirm",
  confirmPin: "head-pin-confirm",
  fullName: "head-full-name",
  password: "head-password",
  pin: "head-pin",
} as const

export function HeadCoachSetupForm({
  defaultName = "",
  recoveryEmail,
}: {
  defaultName?: string
  recoveryEmail: string
}) {
  const [state, action, pending] = useResilientActionState(
    completeHeadCoachSetupAction,
    initialState,
    {
      // A transport failure belongs to the request, not to a control, so the
      // fold clears any field verdict the previous submit left behind.
      fold: (state, message) => ({ ...state, error: message, errorField: null }),
      retained: "No account was created and this one-time setup link still works",
      subject: "Your head-coach account",
    },
  )
  const submissionStartedRef = useRef(false)
  useEffect(() => {
    if (pending) {
      submissionStartedRef.current = true
      return
    }
    if (!submissionStartedRef.current || !state.error) return
    submissionStartedRef.current = false
    const targetId = setupFieldIds[state.errorField ?? "fullName"]
    const timeout = window.setTimeout(() => document.getElementById(targetId)?.focus(), 0)
    return () => window.clearTimeout(timeout)
  }, [pending, state])

  function fieldErrorId(field: keyof typeof setupFieldIds) {
    return state.error && (state.errorField ?? "fullName") === field
      ? headCoachSetupErrorId
      : undefined
  }
  return (
    <form className="login-form head-coach-setup-form" action={action} noValidate>
      <AuthField id="head-full-name" label="Full name" errorId={fieldErrorId("fullName")}>
        {(control) => (
          <input {...control} name="fullName" autoComplete="name" minLength={2} maxLength={80} defaultValue={defaultName} required />
        )}
      </AuthField>
      <AuthField id="head-recovery-email" label="Verified recovery email">
        {(control) => <input {...control} name="recoveryEmail" value={recoveryEmail} readOnly />}
      </AuthField>
      <div className="setup-field-grid">
        <AuthField id="head-password" label="Create password" errorId={fieldErrorId("password")}>
          {(control) => (
            <PasswordInput {...control} name="password" autoComplete="new-password" minLength={12} maxLength={128} required />
          )}
        </AuthField>
        <AuthField id="head-password-confirm" label="Confirm password" errorId={fieldErrorId("confirmPassword")}>
          {(control) => (
            <PasswordInput {...control} name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required />
          )}
        </AuthField>
      </div>
      <div className="setup-field-grid">
        <AuthField id="head-pin" label="Create 6-digit PIN" errorId={fieldErrorId("pin")}>
          {(control) => (
            <input {...control} className="login-pin-input" name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required />
          )}
        </AuthField>
        <AuthField id="head-pin-confirm" label="Confirm PIN" errorId={fieldErrorId("confirmPin")}>
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
