"use client"

import { useActionState } from "react"

import {
  completeHeadCoachSetupAction,
  type HeadCoachSetupState,
} from "@/app/setup/head-coach/actions"

const initialState: HeadCoachSetupState = { error: null }

export function HeadCoachSetupForm({
  defaultName = "",
  recoveryEmail,
}: {
  defaultName?: string
  recoveryEmail: string
}) {
  const [state, action, pending] = useActionState(completeHeadCoachSetupAction, initialState)
  return (
    <form className="login-form head-coach-setup-form" action={action} noValidate>
      <div className="login-field">
        <label htmlFor="head-full-name">Full name</label>
        <input id="head-full-name" name="fullName" autoComplete="name" minLength={2} maxLength={80} defaultValue={defaultName} required />
      </div>
      <div className="login-field">
        <label htmlFor="head-recovery-email">Verified recovery email</label>
        <input id="head-recovery-email" name="recoveryEmail" value={recoveryEmail} readOnly />
      </div>
      <div className="setup-field-grid">
        <div className="login-field">
          <label htmlFor="head-password">Create password</label>
          <input id="head-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        </div>
        <div className="login-field">
          <label htmlFor="head-password-confirm">Confirm password</label>
          <input id="head-password-confirm" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        </div>
      </div>
      <div className="setup-field-grid">
        <div className="login-field">
          <label htmlFor="head-pin">Create 6-digit PIN</label>
          <input id="head-pin" className="login-pin-input" name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required />
        </div>
        <div className="login-field">
          <label htmlFor="head-pin-confirm">Confirm PIN</label>
          <input id="head-pin-confirm" className="login-pin-input" name="confirmPin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required />
        </div>
      </div>
      <p className="login-helper">Your next step scans a QR code with Google Authenticator, Microsoft Authenticator, 1Password, or another TOTP app.</p>
      {state.error ? <p className="login-error" role="alert">{state.error}</p> : null}
      <button className="login-submit" type="submit" disabled={pending}>
        {pending ? "Creating secure account…" : "Create account and continue"}
      </button>
    </form>
  )
}
