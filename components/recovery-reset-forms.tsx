"use client"

import { useActionState, useEffect, useRef } from "react"
import { ArrowRight } from "lucide-react"

import {
  completePasswordRecoveryAction,
  verifyRecoverySecondFactorAction,
  type RecoveryPasswordState,
  type RecoverySecondFactorState,
} from "@/app/recover/actions"
import { PasswordInput } from "@/components/password-input"

const initialFactorState: RecoverySecondFactorState = { error: null }
const initialPasswordState: RecoveryPasswordState = { error: null, errorField: null }

export function RecoverySecondFactorForm() {
  const [state, action, pending] = useActionState(verifyRecoverySecondFactorAction, initialFactorState)
  return (
    <form className="login-form" action={action} noValidate>
      <div className="login-field">
        <label htmlFor="recovery-second-factor">Authenticator or recovery code</label>
        <input
          id="recovery-second-factor"
          name="credential"
          type="text"
          autoComplete="one-time-code"
          required
          aria-describedby="recovery-second-factor-help"
        />
        <p id="recovery-second-factor-help" className="login-helper">
          Enter the current six-digit authenticator code or one unused saved recovery code.
        </p>
      </div>
      {state.error ? <p className="login-error" role="alert">{state.error}</p> : null}
      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Verifying…" : "Verify and continue"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}

export function RecoveryPasswordForm() {
  const [state, action, pending] = useActionState(completePasswordRecoveryAction, initialPasswordState)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (state.errorField === "password") passwordRef.current?.focus()
    if (state.errorField === "confirmPassword") confirmRef.current?.focus()
  }, [state.errorField])
  return (
    <form className="login-form" action={action} noValidate>
      <div className="login-field">
        <label htmlFor="recovery-new-password">New password</label>
        <PasswordInput ref={passwordRef} id="recovery-new-password" name="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      </div>
      <div className="login-field">
        <label htmlFor="recovery-confirm-password">Confirm new password</label>
        <PasswordInput ref={confirmRef} id="recovery-confirm-password" name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required />
      </div>
      <p className="login-helper">Resetting logs out every device and removes the old PIN. Your authenticator remains connected.</p>
      {state.error ? <p className="login-error" role="alert">{state.error}</p> : null}
      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Resetting password…" : "Reset password"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
