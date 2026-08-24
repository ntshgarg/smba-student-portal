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
import { tryCopyText, type ClipboardWriter } from "@/lib/client/clipboard"
import { useResilientActionState } from "@/lib/client/use-resilient-action-state"
import { formatAcademyDate, getAcademyDateKey } from "@/lib/format"

const initialSetup: TotpSetupState = { error: null, setup: null }
const initialVerification: TotpVerificationState = { error: null }

/**
 * The clipboard and the file carry the same document, so both routes out of
 * this screen leave the same thing to read. The prose is part of it: a bare
 * column of ten strings found in a downloads folder months later says nothing
 * about what it opens or that each line is spent on use.
 *
 * `issuedAt` is a parameter so the document is a pure function of its inputs;
 * the callers are click handlers, where reading the clock is safe.
 */
export function recoveryCodesDocument(codes: string[], issuedAt: Date = new Date()) {
  return {
    fileName: `SMBA-authenticator-recovery-codes-${getAcademyDateKey(issuedAt)}.txt`,
    text: [
      "Sathiya Moorthy Badminton Academy - authenticator recovery codes",
      `Issued ${formatAcademyDate(issuedAt)}`,
      "",
      "Each code signs the coach account in once when the authenticator app is",
      "not to hand. Cross a code off after it is used. Keep this away from the",
      "device that runs the app, and never share it.",
      "",
      ...codes,
      "",
    ].join("\n"),
  }
}

/**
 * The browser half of a download, as the four calls it actually takes. The
 * component passes the real ones; a test passes doubles, because the vitest
 * environment is `node` (vitest.config.ts:11) and there is no anchor to click.
 */
export type RecoveryCodeDownloadPort = {
  createAnchor: () => { click: () => void; download?: string; href?: string }
  createObjectUrl: (text: string) => string
  revokeObjectUrl: (url: string) => void
  /** Runs `release` well after the click; see downloadRecoveryCodes. */
  defer: (release: () => void) => void
}

const browserDownloadPort: RecoveryCodeDownloadPort = {
  createAnchor: () => document.createElement("a"),
  createObjectUrl: (text) => URL.createObjectURL(new Blob([text], { type: "text/plain" })),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  defer: (release) => { window.setTimeout(release, 60_000) },
}

export async function copyRecoveryCodes(
  codes: string[],
  clipboard?: ClipboardWriter | null,
): Promise<ActionFeedback> {
  // `tryCopyText` answers false for a missing Clipboard API and for a denied
  // write alike, and the two are indistinguishable from here, so the failure
  // names the remedy rather than the cause.
  const copied = await tryCopyText(recoveryCodesDocument(codes).text, clipboard)
  return copied
    ? { message: `All ${codes.length} recovery codes are on the clipboard`, tone: "success" }
    : { message: "The clipboard was not available. Download the codes instead", tone: "error" }
}

export function downloadRecoveryCodes(
  codes: string[],
  port: RecoveryCodeDownloadPort,
): ActionFeedback {
  const { fileName, text } = recoveryCodesDocument(codes)
  const anchor = port.createAnchor()
  // Without `download` the click navigates to the blob instead of saving it,
  // and navigating unmounts this component -- the codes live in its action
  // state and nothing anywhere reissues them. Refuse rather than click.
  if (!("download" in anchor)) {
    return { message: "This browser cannot save files. Copy the codes instead", tone: "error" }
  }

  let objectUrl = ""
  try {
    objectUrl = port.createObjectUrl(text)
    anchor.href = objectUrl
    anchor.download = fileName
    anchor.click()
  } catch {
    if (objectUrl) port.revokeObjectUrl(objectUrl)
    return { message: "The file could not be prepared. Copy the codes instead", tone: "error" }
  }

  // The click queues the read of the object URL rather than performing it, so
  // releasing it in this task -- or in the next one, which is all setTimeout 0
  // buys -- can cancel the save before a byte is read. `browserDownloadPort`
  // holds it for a minute; whatever is left goes when the document does.
  port.defer(() => port.revokeObjectUrl(objectUrl))
  // Nothing observable says where the file landed -- some phone browsers open a
  // text file rather than storing it -- so the notice claims only the start.
  return { message: `Download started as ${fileName}`, tone: "success" }
}

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
            <p id="totp-password-help" className="login-helper">This confirms that you control the coach account.</p>
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
