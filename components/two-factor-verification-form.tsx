"use client"

import { useActionState, useState } from "react"
import Link from "next/link"

import {
  verifyBackupCodeSignIn,
  verifyTotpSignIn,
  type TotpVerificationState,
} from "@/app/auth/two-factor/actions"

const initialState: TotpVerificationState = { error: null }

export function TwoFactorVerificationForm() {
  const [useRecovery, setUseRecovery] = useState(false)
  const [totpState, totpAction, totpPending] = useActionState(verifyTotpSignIn, initialState)
  const [backupState, backupAction, backupPending] = useActionState(verifyBackupCodeSignIn, initialState)

  return (
    <div>
      {useRecovery ? (
        <form className="login-form" action={backupAction} noValidate>
          <div className="login-field">
            <label htmlFor="backup-code">Recovery code</label>
            <input
              id="backup-code"
              name="backupCode"
              type="text"
              autoComplete="one-time-code"
              required
              aria-describedby={backupState.error ? "backup-code-error" : undefined}
              aria-invalid={backupState.error ? true : undefined}
            />
            {backupState.error ? <p id="backup-code-error" className="login-error" role="alert">{backupState.error}</p> : null}
          </div>
          <button className="login-submit" type="submit" disabled={backupPending}>
            {backupPending ? "Checking code…" : "Use recovery code"}
          </button>
        </form>
      ) : (
        <form className="login-form" action={totpAction} noValidate>
          <div className="login-field">
            <label htmlFor="two-factor-code">Six-digit code</label>
            <input
              id="two-factor-code"
              name="code"
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]{6}"
              required
              aria-describedby={totpState.error ? "two-factor-error" : "two-factor-help"}
              aria-invalid={totpState.error ? true : undefined}
            />
            {totpState.error ? (
              <p id="two-factor-error" className="login-error" role="alert">{totpState.error}</p>
            ) : (
              <p id="two-factor-help" className="login-helper">Enter the current code from your authenticator app.</p>
            )}
          </div>
          <label className="totp-trust-device">
            <input type="checkbox" name="trustDevice" />
            Trust this private device for 30 days
          </label>
          <button className="login-submit" type="submit" disabled={totpPending}>
            {totpPending ? "Verifying…" : "Verify and continue"}
          </button>
        </form>
      )}
      <button className="totp-switch" type="button" onClick={() => setUseRecovery((value) => !value)}>
        {useRecovery ? "Use authenticator code" : "Use a recovery code"}
      </button>
      <Link className="totp-recovery-link" href="/auth/two-factor/recovery">
        Lost the authenticator and every recovery code?
      </Link>
    </div>
  )
}
