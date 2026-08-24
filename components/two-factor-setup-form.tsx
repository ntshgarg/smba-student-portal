"use client"

import { QRCodeSVG } from "qrcode.react"

import {
  confirmTotpSetup,
  startTotpSetup,
  type TotpSetupState,
  type TotpVerificationState,
} from "@/app/auth/two-factor/actions"
import { PasswordInput } from "@/components/password-input"
import { useResilientActionState } from "@/lib/client/use-resilient-action-state"

const initialSetup: TotpSetupState = { error: null, setup: null }
const initialVerification: TotpVerificationState = { error: null }

export function TwoFactorSetupForm() {
  const [setupState, setupAction, setupPending] = useResilientActionState(
    startTotpSetup,
    initialSetup,
    { retained: "No authenticator was connected", subject: "Your authenticator setup" },
  )
  const [verifyState, verifyAction, verifyPending] = useResilientActionState(
    confirmTotpSetup,
    initialVerification,
    {
      // The recovery codes are shown once and live only in `setupState`. Keeping
      // this form mounted is the only thing standing between a dropped request
      // and losing them permanently.
      retained: "The recovery codes above are still on screen",
      subject: "Your six-digit code",
    },
  )

  if (!setupState.setup) {
    return (
      <form className="login-form" action={setupAction} noValidate>
        <div className="login-field">
          <label htmlFor="totp-current-password">Confirm password</label>
          <PasswordInput
            id="totp-current-password"
            name="password"
            autoComplete="current-password"
            required
            aria-describedby={setupState.error ? "totp-setup-error" : "totp-password-help"}
            aria-invalid={setupState.error ? true : undefined}
          />
          {setupState.error ? (
            <p id="totp-setup-error" className="login-error" role="alert">{setupState.error}</p>
          ) : (
            <p id="totp-password-help" className="login-helper">This confirms that you control the coach account.</p>
          )}
        </div>
        <button className="login-submit" type="submit" disabled={setupPending}>
          {setupPending ? "Preparing authenticator…" : "Set up authenticator"}
        </button>
      </form>
    )
  }

  const setupUrl = new URL(setupState.setup.totpURI)
  const manualSecret = setupUrl.searchParams.get("secret") ?? ""
  return (
    <div className="totp-setup">
      <div className="totp-qr">
        <QRCodeSVG
          aria-label="Authenticator setup QR code"
          value={setupState.setup.totpURI}
          size={190}
          level="M"
        />
      </div>
      <div className="totp-instructions">
        <h2>Scan with your authenticator app</h2>
        <p>Google Authenticator, Microsoft Authenticator, 1Password and compatible apps work.</p>
        <p className="totp-manual-key"><span>Manual key</span><code>{manualSecret}</code></p>
      </div>
      <section className="totp-backup-codes" aria-labelledby="backup-code-title">
        <h2 id="backup-code-title">Save these recovery codes now</h2>
        <p>Each code works once. Store them somewhere separate from this device.</p>
        <ul>{setupState.setup.backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
      </section>
      <form className="login-form" action={verifyAction} noValidate>
        <div className="login-field">
          <label htmlFor="totp-confirm-code">Confirm six-digit code</label>
          <input
            id="totp-confirm-code"
            name="code"
            type="text"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            pattern="[0-9]{6}"
            required
            aria-describedby={verifyState.error ? "totp-confirm-error" : undefined}
            aria-invalid={verifyState.error ? true : undefined}
          />
          {verifyState.error ? (
            <p id="totp-confirm-error" className="login-error" role="alert">{verifyState.error}</p>
          ) : null}
        </div>
        <button className="login-submit" type="submit" disabled={verifyPending}>
          {verifyPending ? "Verifying…" : "Verify and enter workspace"}
        </button>
      </form>
    </div>
  )
}
