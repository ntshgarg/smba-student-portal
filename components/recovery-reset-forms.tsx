"use client"

import { useEffect, useRef } from "react"
import { ArrowRight } from "lucide-react"

import {
  completePasswordRecoveryAction,
  verifyRecoverySecondFactorAction,
  type RecoveryPasswordState,
  type RecoverySecondFactorState,
} from "@/app/recover/actions"
import { AuthField } from "@/components/auth-field"
import { PasswordInput } from "@/components/password-input"
import { useResilientActionState } from "@/lib/client/use-resilient-action-state"

const initialFactorState: RecoverySecondFactorState = { error: null }
const initialPasswordState: RecoveryPasswordState = { error: null, errorField: null }
const factorErrorId = "recovery-factor-error"
const passwordErrorId = "recovery-password-error"

export function RecoverySecondFactorForm() {
  const [state, action, pending] = useResilientActionState(
    verifyRecoverySecondFactorAction,
    initialFactorState,
    {
      retained: "The code was not used and your reset link still works",
      subject: "Your code",
    },
  )
  const credentialRef = useRef<HTMLInputElement>(null)
  const submissionStartedRef = useRef(false)
  useEffect(() => {
    if (pending) {
      submissionStartedRef.current = true
      return
    }
    if (!submissionStartedRef.current || !state.error) return
    submissionStartedRef.current = false
    const timeout = window.setTimeout(() => credentialRef.current?.focus(), 0)
    return () => window.clearTimeout(timeout)
  }, [pending, state])
  return (
    <form className="login-form" action={action} noValidate>
      <AuthField
        id="recovery-second-factor"
        label="Authenticator or recovery code"
        errorId={state.error ? factorErrorId : undefined}
        helper="Enter the current six-digit authenticator code or one unused saved recovery code."
      >
        {(control) => (
          <input
            {...control}
            ref={credentialRef}
            name="credential"
            type="text"
            autoComplete="one-time-code"
            required
          />
        )}
      </AuthField>
      {state.error ? <p id={factorErrorId} className="login-error" role="alert">{state.error}</p> : null}
      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Verifying…" : "Verify and continue"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}

export function RecoveryPasswordForm() {
  const [state, action, pending] = useResilientActionState(
    completePasswordRecoveryAction,
    initialPasswordState,
    {
      // Neither password field is at fault, so focus stays where it is.
      fold: (state, error) => ({ ...state, error, errorField: null }),
      retained: "Your old password still works and the reset link is still valid",
      subject: "Your new password",
    },
  )
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (state.errorField === "password") passwordRef.current?.focus()
    if (state.errorField === "confirmPassword") confirmRef.current?.focus()
  }, [state])
  return (
    <form className="login-form" action={action} noValidate>
      <AuthField
        id="recovery-new-password"
        label="New password"
        errorId={state.error && state.errorField === "password" ? passwordErrorId : undefined}
      >
        {(control) => (
          <PasswordInput {...control} ref={passwordRef} name="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        )}
      </AuthField>
      <AuthField
        id="recovery-confirm-password"
        label="Confirm new password"
        errorId={state.error && state.errorField === "confirmPassword" ? passwordErrorId : undefined}
      >
        {(control) => (
          <PasswordInput {...control} ref={confirmRef} name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required />
        )}
      </AuthField>
      <p className="login-helper">Resetting logs out every device and removes the old PIN. Your authenticator remains connected.</p>
      {state.error ? <p id={passwordErrorId} className="login-error" role="alert">{state.error}</p> : null}
      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Resetting password…" : "Reset password"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
