"use client"

import { useActionState } from "react"

import {
  completePlatformAdminSetupAction,
  type PlatformAdminSetupState,
} from "@/app/setup/admin/actions"

const initialState: PlatformAdminSetupState = { error: null }

export function PlatformAdminSetupForm() {
  const [state, action, pending] = useActionState(
    completePlatformAdminSetupAction,
    initialState,
  )

  return (
    <form className="login-form head-coach-setup-form" action={action} noValidate>
      <div className="login-field">
        <label htmlFor="admin-full-name">Your name</label>
        <input
          id="admin-full-name"
          name="fullName"
          autoComplete="name"
          minLength={2}
          maxLength={80}
          required
        />
      </div>
      <div className="setup-field-grid">
        <div className="login-field">
          <label htmlFor="admin-password">Create password</label>
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </div>
        <div className="login-field">
          <label htmlFor="admin-password-confirm">Confirm password</label>
          <input
            id="admin-password-confirm"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </div>
      </div>
      <div className="setup-field-grid">
        <div className="login-field">
          <label htmlFor="admin-pin">Create 6-digit PIN</label>
          <input
            id="admin-pin"
            className="login-pin-input"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            autoComplete="new-password"
            required
          />
        </div>
        <div className="login-field">
          <label htmlFor="admin-pin-confirm">Confirm PIN</label>
          <input
            id="admin-pin-confirm"
            className="login-pin-input"
            name="confirmPin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            autoComplete="new-password"
            required
          />
        </div>
      </div>
      <p className="login-helper">
        Next, you’ll scan a QR code with your authenticator app and save one-time backup codes.
      </p>
      {state.error ? <p className="login-error" role="alert">{state.error}</p> : null}
      <button className="login-submit" type="submit" disabled={pending}>
        {pending ? "Creating secure owner account…" : "Create account and connect authenticator"}
      </button>
    </form>
  )
}
