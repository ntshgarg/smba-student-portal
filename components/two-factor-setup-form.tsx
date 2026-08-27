"use client"

import { ClipboardCopy, FileDown } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { useState } from "react"

import {
  confirmTotpSetup,
  startTotpSetup,
  type TotpSetupState,
  type TotpVerificationState,
} from "@/app/auth/two-factor/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { PasswordInput } from "@/components/password-input"
import {
  browserDownloadPort,
  copyRecoveryCodes,
  downloadRecoveryCodes,
} from "@/lib/client/recovery-codes"
import { useResilientActionState } from "@/lib/client/use-resilient-action-state"

const initialSetup: TotpSetupState = { error: null, setup: null }
const initialVerification: TotpVerificationState = { error: null }

/*
 * Both a head coach and the platform owner reach this screen, and the owner
 * meets it minutes after provisioning, as their first real interaction with
 * the product. A single sentence naming "the coach account" is wrong for one
 * of the two, so the noun follows the role.
 */
export function TwoFactorSetupForm({ role }: { role: "coach" | "platform_admin" }) {
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
  const [codesFeedback, setCodesFeedback] = useState<ActionFeedback | null>(null)
  const [codesSaved, setCodesSaved] = useState(false)

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
            <p id="totp-password-help" className="login-helper">
              This confirms that you control the {role === "platform_admin" ? "platform owner" : "coach"} account.
            </p>
          )}
        </div>
        <button className="login-submit" type="submit" disabled={setupPending}>
          {setupPending ? "Preparing authenticator…" : "Set up authenticator"}
        </button>
      </form>
    )
  }

  const { backupCodes } = setupState.setup
  const setupUrl = new URL(setupState.setup.totpURI)
  const manualSecret = setupUrl.searchParams.get("secret") ?? ""

  async function copyCodes() {
    setCodesFeedback(await copyRecoveryCodes(backupCodes, navigator.clipboard))
  }

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
        <ul>{backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
        <div className="totp-backup-actions">
          <button className="login-secondary" type="button" onClick={() => void copyCodes()}>
            <ClipboardCopy aria-hidden="true" />
            Copy all codes
          </button>
          <button
            className="login-secondary"
            type="button"
            onClick={() => setCodesFeedback(downloadRecoveryCodes(backupCodes, browserDownloadPort))}
          >
            <FileDown aria-hidden="true" />
            Download as a file
          </button>
        </div>
        <InlineNotice message={codesFeedback?.message} tone={codesFeedback?.tone} />
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
        {/* The gate belongs on this submit and nowhere earlier. A successful
            confirmTotpSetup is the one irreversible step: it sets
            two_factor_enabled, after which both the page and startTotpSetup
            redirect away. Until then a re-entered password issues a fresh
            enrolment, replacing the secret and all ten codes. */}
        <label className="totp-codes-saved">
          <input
            name="recoveryCodesSaved"
            type="checkbox"
            checked={codesSaved}
            aria-describedby={codesSaved ? undefined : "totp-codes-saved-hint"}
            onChange={(event) => setCodesSaved(event.target.checked)}
          />
          <span>I have saved these recovery codes somewhere I can reach without this device</span>
        </label>
        {/* Outside the label: nested description text leaks into the checkbox's
            accessible name. Both the checkbox and the held submit point at it,
            and it is dropped in the same render that drops the references. */}
        {codesSaved ? null : (
          <p id="totp-codes-saved-hint" className="login-helper">
            Verifying replaces this screen and the codes are never shown again, so this
            button stays locked until the box above is ticked.
          </p>
        )}
        {/* `disabled` would take this out of the tab order, and a control a
            screen reader in focus mode never lands on cannot explain itself --
            so the acknowledgement gate is aria-disabled plus an inert click,
            and `disabled` is left to mean verifying, which is the only state
            that is genuinely busy. Enter in the code field runs this button's
            activation behaviour rather than submitting directly, so cancelling
            the click closes that route too. */}
        <button
          className="login-submit"
          type="submit"
          disabled={verifyPending}
          aria-disabled={codesSaved ? undefined : true}
          aria-describedby={codesSaved ? undefined : "totp-codes-saved-hint"}
          onClick={(event) => { if (!codesSaved) event.preventDefault() }}
        >
          {verifyPending ? "Verifying…" : "Verify and enter workspace"}
        </button>
      </form>
    </div>
  )
}
