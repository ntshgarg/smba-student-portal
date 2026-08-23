"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import Link from "next/link"

import {
  verifyBackupCodeSignIn,
  verifyTotpSignIn,
  type TotpVerificationState,
} from "@/app/auth/two-factor/actions"
import { AuthField } from "@/components/auth-field"

const initialState: TotpVerificationState = { error: null }

export function TwoFactorVerificationForm() {
  const [useRecovery, setUseRecovery] = useState(false)
  const [totpState, totpAction, totpPending] = useActionState(verifyTotpSignIn, initialState)
  const [backupState, backupAction, backupPending] = useActionState(verifyBackupCodeSignIn, initialState)
  const codeRef = useRef<HTMLInputElement>(null)
  const backupCodeRef = useRef<HTMLInputElement>(null)
  const totpSubmissionRef = useRef(false)
  const backupSubmissionRef = useRef(false)
  useEffect(() => {
    if (totpPending) {
      totpSubmissionRef.current = true
      return
    }
    if (!totpSubmissionRef.current || !totpState.error) return
    totpSubmissionRef.current = false
    const timeout = window.setTimeout(() => codeRef.current?.focus(), 0)
    return () => window.clearTimeout(timeout)
  }, [totpPending, totpState])
  useEffect(() => {
    if (backupPending) {
      backupSubmissionRef.current = true
      return
    }
    if (!backupSubmissionRef.current || !backupState.error) return
    backupSubmissionRef.current = false
    const timeout = window.setTimeout(() => backupCodeRef.current?.focus(), 0)
    return () => window.clearTimeout(timeout)
  }, [backupPending, backupState])

  return (
    <div>
      {useRecovery ? (
        <form className="login-form" action={backupAction} noValidate>
          <AuthField id="backup-code" label="Recovery code" error={backupState.error}>
            {(control) => (
              <input
                {...control}
                ref={backupCodeRef}
                name="backupCode"
                type="text"
                autoComplete="one-time-code"
                required
              />
            )}
          </AuthField>
          <button className="login-submit" type="submit" disabled={backupPending}>
            {backupPending ? "Checking code…" : "Use recovery code"}
          </button>
        </form>
      ) : (
        <form className="login-form" action={totpAction} noValidate>
          <AuthField
            id="two-factor-code"
            label="Six-digit code"
            error={totpState.error}
            helper="Enter the current code from your authenticator app."
          >
            {(control) => (
              <input
                {...control}
                ref={codeRef}
                name="code"
                type="text"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                required
              />
            )}
          </AuthField>
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
