"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { Check, ClipboardCopy, FileDown, KeyRound, LogOut, RefreshCw, ShieldCheck } from "lucide-react"

import {
  changePasswordAction,
  reissueRecoveryCodesAction,
  removePinAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  savePinAction,
  type PasswordChangeState,
  type PinManagementState,
  type RecoveryCodeReissueState,
} from "@/app/account/security/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { describeSaveFailure } from "@/lib/client/network-failure"
import { PasswordInput } from "@/components/password-input"
import {
  browserDownloadPort,
  copyRecoveryCodes,
  downloadRecoveryCodes,
} from "@/lib/client/recovery-codes"
import { useResilientActionState } from "@/lib/client/use-resilient-action-state"

type SecuritySession = {
  createdAt: string
  current: boolean
  expiresAt: string
  id: string
  ipAddress: string | null
  userAgent: string | null
}

const initialPasswordState: PasswordChangeState = { error: null, success: null }
const initialPinState: PinManagementState = { error: null, success: null }
const initialReissueState: RecoveryCodeReissueState = {
  codes: null,
  error: null,
  errorField: null,
}

const PASSWORD_ERROR_ID = "security-password-error"
const RECOVERY_CODES_ERROR_ID = "security-recovery-codes-error"
const RECOVERY_CODES_FACTOR_HINT_ID = "security-recovery-codes-factor-hint"

/** Input ids for the change-password form, keyed by the field the action reports. */
const passwordFieldIds = {
  confirmPassword: "security-confirm-password",
  currentPassword: "security-current-password",
  newPassword: "security-new-password",
} as const

/**
 * The reissue action, wrapped so a refused second press keeps the set on screen.
 *
 * After a reissue the form stays live and React empties its fields, so a second
 * press by mistake used to come back as "Enter your current password." with
 * `codes: null` -- and the only readable copy of a set that was still the live
 * one vanished. The action now says when it refused before touching the stored
 * set, and only then do the codes on screen stay; anything that may have
 * replaced the set still clears them.
 *
 * The codes are also left out of what goes back to the server: they are the
 * coach's only copy and the action has no use for them.
 */
async function reissueStillShowingCodes(
  state: RecoveryCodeReissueState,
  formData: FormData,
): Promise<RecoveryCodeReissueState> {
  const next = await reissueRecoveryCodesAction({ ...state, codes: null }, formData)
  return next.storedSetUnchanged && state.codes ? { ...next, codes: state.codes } : next
}

/** Sessions shown before the list has to be expanded. */
const sessionPreviewCount = 5

function deviceLabel(userAgent: string | null) {
  if (!userAgent) return "Unknown browser"
  if (/iPhone|iPad/iu.test(userAgent)) return "Apple mobile device"
  if (/Android/iu.test(userAgent)) return "Android device"
  if (/Macintosh/iu.test(userAgent)) return "Mac browser"
  if (/Windows/iu.test(userAgent)) return "Windows browser"
  return "Web browser"
}

export function AccountSecurityWorkspace({
  allowPin,
  authenticatorEnabled,
  authenticatorRequired,
  pinEnabled,
  pinRequired,
  sessions,
  unusedRecoveryCodeCount,
}: {
  allowPin: boolean
  authenticatorEnabled: boolean
  authenticatorRequired: boolean
  pinEnabled: boolean
  pinRequired: boolean
  sessions: SecuritySession[]
  /** `null` when Better Auth could not be asked; the panel then states no count. */
  unusedRecoveryCodeCount: number | null
}) {
  const [passwordState, passwordAction, passwordPending] = useResilientActionState(
    changePasswordAction,
    initialPasswordState,
    {
      // No field was rejected and nothing succeeded, so clear both verdicts
      // rather than leave a stale one beside the failure.
      fold: (state, error) => ({ ...state, error, errorField: null, success: null }),
      subject: "Your new password",
      // A finished change replaces the password, signs every device out and
      // removes the PIN before the reply is sent; the new sign-in cookie is lost
      // with the reply. So the next click may well ask for a sign-in, and the
      // password to give it is the new one.
      unconfirmed: "If it went through, your new password is now the one that works and"
        + " other devices were signed out. Reload this page: if you are asked to sign in,"
        + " use your new password",
    },
  )
  const [pinState, pinAction, pinPending] = useResilientActionState(savePinAction, initialPinState, {
    fold: (state, error) => ({ ...state, error, success: null }),
    subject: "Your PIN",
    unconfirmed: "Your password still signs you in either way. Reload this page to see"
      + " whether the PIN changed before trying again",
  })
  const [removeState, removeAction, removePending] = useResilientActionState(
    removePinAction,
    initialPinState,
    {
      fold: (state, error) => ({ ...state, error, success: null }),
      subject: "Your PIN removal",
      unconfirmed: "Your password still signs you in either way. Reload this page to see"
        + " whether the PIN was removed",
    },
  )
  const [reissueState, reissueAction, reissuePending] = useResilientActionState(
    reissueStillShowingCodes,
    initialReissueState,
    {
      // Codes from an earlier press may have been superseded by the press that
      // failed, and a dead code presented as live is what locks a coach out, so
      // they go with the failure. An expired sign-in is the exception: the
      // guard refuses before the stored set is touched, so codes on screen are
      // still the live set and the only readable copy of it. Neither credential
      // was rejected, so neither field is flagged.
      fold: (state, error, kind) => ({
        ...state,
        codes: kind === "session-expired" ? state.codes : null,
        error,
        errorField: null,
      }),
      subject: "Your request for new recovery codes",
      // A finished reissue overwrites the stored set before the reply is sent,
      // so the codes the coach holds may already be dead. Only a set that was
      // actually shown can be trusted, so the way out is another reissue.
      unconfirmed: "If it went through, your old codes no longer work and the new ones could"
        + " not be shown. Check the connection and reissue again to get a set you can save."
        + " No device was signed out and your authenticator app is unchanged",
    },
  )
  // The notice names a set -- "All 10 recovery codes are on the clipboard" --
  // so it is held against the set it named. A second reissue voids that
  // clipboard write, and pairing drops the sentence with the codes rather than
  // leaving a superseded set described as saved.
  const [codesFeedback, setCodesFeedback] = useState<{
    codes: string[]
    feedback: ActionFeedback
  } | null>(null)
  const [pinValidationTarget, setPinValidationTarget] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null)
  const [showAllSessions, setShowAllSessions] = useState(false)
  const [sessionsFeedback, setSessionsFeedback] = useState<ActionFeedback | null>(null)

  /*
   * The two revoke buttons were the only mutations in this file that did not
   * go through `describeSaveFailure`: `startTransition(() => action())` hands
   * React a promise it can only reject, and a rejected action throws during
   * render and escalates to the root boundary. So a dropped request on a venue
   * connection replaced the whole security page -- including the session list
   * being read -- with the generic error card, and said nothing about whether
   * the device had been signed out.
   *
   * Awaiting inside the transition and folding the failure into a notice beside
   * the list keeps the page, keeps the list, and answers the only question that
   * matters after a failed revoke. Neither action calls `redirect()`, so this
   * catch cannot swallow Next's redirect control-flow rejection; if either ever
   * grows one, it has to be rethrown here.
   */
  function revokeSessions(
    run: () => Promise<void>,
    { retained, subject, success }: {
      retained: string
      subject: string
      success?: string
    },
  ) {
    setSessionsFeedback(null)
    startTransition(async () => {
      try {
        await run()
        if (success) setSessionsFeedback({ message: success, tone: "success" })
      } catch (error) {
        const failure = describeSaveFailure({
          error,
          retained,
          subject,
          // "It is still signed in" is only true if the request never
          // arrived; a dropped reply cannot say which.
          unconfirmed: "Reload this page to see which devices are still signed in",
        })
        setSessionsFeedback({ action: failure.signIn, message: failure.message, tone: "error" })
      } finally {
        setRevokingSessionId(null)
      }
    })
  }

  // Send focus to the field the error names, matching the PIN form below.
  useEffect(() => {
    const field = passwordState.errorField
    if (!field) return
    document.getElementById(passwordFieldIds[field])?.focus()
  }, [passwordState])

  // Keep this device visible even when the list is capped.
  const orderedSessions = useMemo(() => [
    ...sessions.filter((session) => session.current),
    ...sessions.filter((session) => !session.current),
  ], [sessions])
  const visibleSessions = showAllSessions
    ? orderedSessions
    : orderedSessions.slice(0, sessionPreviewCount)
  const hiddenSessionCount = orderedSessions.length - visibleSessions.length
  // Read into a const so the click handlers below keep the narrowing; a property
  // access loses it inside a callback.
  const reissuedCodes = reissueState.codes

  function passwordFieldProps(field: keyof typeof passwordFieldIds) {
    if (passwordState.errorField !== field) return {}
    return { "aria-describedby": PASSWORD_ERROR_ID, "aria-invalid": true } as const
  }

  const shownCodesFeedback = codesFeedback?.codes === reissuedCodes
    ? codesFeedback.feedback
    : null

  async function copyReissuedCodes(codes: string[]) {
    setCodesFeedback({ codes, feedback: await copyRecoveryCodes(codes, navigator.clipboard) })
  }

  return (
    <div className="security-workspace">
      {authenticatorRequired ? (
        <section className={`security-panel security-mfa-callout ${authenticatorEnabled ? "is-connected" : "is-required"}`}>
          <span className="security-mfa-icon"><ShieldCheck aria-hidden="true" /></span>
          <div className="security-mfa-copy">
            <p className="eyebrow">Protected access</p>
            <h2>{authenticatorEnabled ? "Authenticator connected" : "Add an authenticator app"}</h2>
            <p>{authenticatorEnabled
              ? "Your protected workspace requires a fresh authenticator code at sign-in."
              : "This account must complete this step before protected workspace access."}</p>
          </div>
          <div className="security-mfa-actions">
            {authenticatorEnabled ? (
              <span className="security-mfa-status" role="status">
                <Check aria-hidden="true" />Authenticator setup successful
              </span>
            ) : null}
            <Link href={authenticatorEnabled ? "/auth/two-factor/reconnect" : "/auth/two-factor/setup"}>
              {authenticatorEnabled ? <RefreshCw aria-hidden="true" /> : null}
              {authenticatorEnabled ? "Reconnect authenticator" : "Set up authenticator"}
            </Link>
          </div>
        </section>
      ) : null}

      {authenticatorEnabled ? (
        <section
          className="security-panel security-recovery-codes"
          aria-labelledby="recovery-codes-title"
        >
          <header>
            <KeyRound aria-hidden="true" />
            <div>
              <p className="eyebrow">Recovery codes</p>
              <h2 id="recovery-codes-title">Reissue recovery codes</h2>
            </div>
          </header>
          <p>{unusedRecoveryCodeCount === null
            ? "Each recovery code signs this account in once, for the days the authenticator app is not to hand."
            : `${unusedRecoveryCodeCount} unused recovery ${unusedRecoveryCodeCount === 1 ? "code remains" : "codes remain"}. Each one signs this account in once, for the days the authenticator app is not to hand.`}</p>
          {/* The consequence belongs above the button, not in the receipt. */}
          <p>Reissuing replaces the whole set: every code you hold now, printed or
            downloaded, stops working the moment a new set is issued. Your authenticator
            app keeps working and no signed-in device is logged out.</p>
          <form className="security-form" action={reissueAction} noValidate>
            <div className="security-password-field">
              <label htmlFor="security-recovery-codes-password"><span>Current password <span className="security-required-marker" aria-hidden="true">*</span></span></label>
              <PasswordInput
                id="security-recovery-codes-password"
                name="currentPassword"
                autoComplete="current-password"
                required
                aria-describedby={reissueState.errorField === "currentPassword" ? RECOVERY_CODES_ERROR_ID : undefined}
                aria-invalid={reissueState.errorField === "currentPassword" ? true : undefined}
              />
            </div>
            {/* The second factor is the gate `beginAuthenticatorReconnect` puts
                on the other operation that touches this credential, and this
                one mints ten permanent bypasses of it. */}
            <div className="security-password-field">
              <label htmlFor="security-recovery-codes-second-factor"><span>Authenticator or recovery code <span className="security-required-marker" aria-hidden="true">*</span></span></label>
              <input
                id="security-recovery-codes-second-factor"
                name="secondFactor"
                type="text"
                autoComplete="one-time-code"
                required
                aria-describedby={reissueState.errorField === "secondFactor"
                  ? `${RECOVERY_CODES_ERROR_ID} ${RECOVERY_CODES_FACTOR_HINT_ID}`
                  : RECOVERY_CODES_FACTOR_HINT_ID}
                aria-invalid={reissueState.errorField === "secondFactor" ? true : undefined}
              />
              <p className="login-helper" id={RECOVERY_CODES_FACTOR_HINT_ID}>
                Six digits from your authenticator app, or one of the recovery codes you
                still hold. A recovery code used here is replaced with the rest.
              </p>
            </div>
            {reissueState.error ? <p className="login-error" id={RECOVERY_CODES_ERROR_ID} role="alert">{reissueState.error}</p> : null}
            <button type="submit" disabled={reissuePending}>{reissuePending ? "Reissuing…" : "Reissue recovery codes"}</button>
          </form>
          {reissuedCodes ? (
            /* The block enrolment shows, one heading level down, and the same two
               exits: `copyRecoveryCodes` and `downloadRecoveryCodes` both write
               `recoveryCodesDocument`, so the clipboard, the file and this list
               cannot come to say different things. */
            <div className="totp-backup-codes">
              <h3>Your new recovery codes</h3>
              <p role="status">{`${reissuedCodes.length} new codes replaced the old set. Save them before you leave this page; they are not shown again.`}</p>
              {/* Another reissue, from this page or another device, replaces this
                  set without this page knowing, so the list says so itself. */}
              <p>If new codes are issued again, here or on another device, these stop working.</p>
              <ul>{reissuedCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
              <div className="totp-backup-actions">
                <button
                  className="login-secondary"
                  type="button"
                  onClick={() => void copyReissuedCodes(reissuedCodes)}
                >
                  <ClipboardCopy aria-hidden="true" />
                  Copy all codes
                </button>
                <button
                  className="login-secondary"
                  type="button"
                  onClick={() => setCodesFeedback({
                    codes: reissuedCodes,
                    feedback: downloadRecoveryCodes(reissuedCodes, browserDownloadPort),
                  })}
                >
                  <FileDown aria-hidden="true" />
                  Download as a file
                </button>
              </div>
              <InlineNotice
                message={shownCodesFeedback?.message}
                tone={shownCodesFeedback?.tone}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="security-columns">
        <section className="security-panel" aria-labelledby="change-password-title">
          <header>
            <KeyRound aria-hidden="true" />
            <div><p className="eyebrow">Credentials</p><h2 id="change-password-title">Change password</h2></div>
          </header>
          <form className="security-form" action={passwordAction} noValidate>
            <div className="security-password-field">
              <label htmlFor="security-current-password"><span>Current password <span className="security-required-marker" aria-hidden="true">*</span></span></label>
              <PasswordInput id="security-current-password" name="currentPassword" autoComplete="current-password" required {...passwordFieldProps("currentPassword")} />
            </div>
            <div className="security-password-field">
              <label htmlFor="security-new-password"><span>New password <span className="security-required-marker" aria-hidden="true">*</span></span></label>
              <PasswordInput id="security-new-password" name="newPassword" autoComplete="new-password" minLength={12} maxLength={128} required {...passwordFieldProps("newPassword")} />
            </div>
            <div className="security-password-field">
              <label htmlFor="security-confirm-password"><span>Confirm new password <span className="security-required-marker" aria-hidden="true">*</span></span></label>
              <PasswordInput id="security-confirm-password" name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required {...passwordFieldProps("confirmPassword")} />
            </div>
            {passwordState.error ? <p className="login-error" id={PASSWORD_ERROR_ID} role="alert">{passwordState.error}</p> : null}
            {passwordState.success ? <p className="security-success" role="status">{passwordState.success}</p> : null}
            <button type="submit" disabled={passwordPending}>{passwordPending ? "Changing…" : "Change password"}</button>
          </form>
        </section>

        <section className="security-panel" aria-labelledby="sessions-title">
          <header>
            <LogOut aria-hidden="true" />
            <div><p className="eyebrow">Devices</p><h2 id="sessions-title">Active sessions</h2></div>
          </header>
          <p className="security-sessions-count">
            {orderedSessions.length === 1
              ? "1 signed-in device."
              : `${orderedSessions.length} signed-in devices.`}
          </p>
          <ul className="security-sessions">
            {visibleSessions.map((session) => {
              const signedIn = new Date(session.createdAt).toLocaleString("en-IN")
              const revoking = revokingSessionId === session.id
              return (
                <li key={session.id}>
                  <div>
                    <strong>{deviceLabel(session.userAgent)}{session.current ? " · This device" : ""}</strong>
                    <span>Signed in {signedIn}</span>
                    <span>Expires {new Date(session.expiresAt).toLocaleString("en-IN")}</span>
                  </div>
                  {!session.current ? (
                    <button
                      type="button"
                      aria-label={`Log out ${deviceLabel(session.userAgent)} signed in ${signedIn}`}
                      disabled={isPending}
                      onClick={() => {
                        setRevokingSessionId(session.id)
                        revokeSessions(() => revokeSessionAction(session.id), {
                          retained: "It is still signed in",
                          subject: "The sign-out",
                        })
                      }}
                    >
                      {revoking && isPending ? "Logging out…" : "Log out"}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {hiddenSessionCount > 0 || showAllSessions ? (
            <button
              className="security-secondary-action"
              type="button"
              aria-expanded={showAllSessions}
              onClick={() => setShowAllSessions((value) => !value)}
            >
              {showAllSessions
                ? `Show ${sessionPreviewCount} most recent`
                : `Show all ${orderedSessions.length} devices`}
            </button>
          ) : null}
          {orderedSessions.length > 1 ? (
            <button
              className="security-secondary-action"
              type="button"
              onClick={() => revokeSessions(() => revokeOtherSessionsAction(), {
                retained: "They are still signed in",
                subject: "The sign-out",
                // Trusted browsers are forgotten too (app/account/security/actions.ts).
                success: authenticatorEnabled
                  ? "Other devices were logged out. Every browser, this one included, will ask for an authenticator code at its next sign-in."
                  : "Other devices were logged out.",
              })}
              disabled={isPending}
            >
              Log out other devices
            </button>
          ) : null}
          <InlineNotice
            action={sessionsFeedback?.action}
            message={sessionsFeedback?.message}
            reserveSpace={false}
            tone={sessionsFeedback?.tone}
          />
        </section>
      </div>

      {allowPin ? (
        <section className="security-panel" aria-labelledby="quick-pin-title">
          <header>
            <KeyRound aria-hidden="true" />
            <div>
              <p className="eyebrow">Quick login</p>
              <h2 id="quick-pin-title">{pinEnabled
                ? pinRequired ? "Change PIN" : "Change or remove PIN"
                : "Add a 6-digit PIN"}</h2>
            </div>
          </header>
          <p>{pinRequired
            ? "This protected account requires a PIN. Your password always remains available for recovery."
            : "Your password always remains available for login and PIN recovery."}</p>
          <form
            className="security-form security-pin-form"
            action={pinAction}
            noValidate
            onInput={(event) => {
              if (!pinValidationTarget) return
              const nextInvalid = event.currentTarget.querySelector<HTMLInputElement>("input:invalid")
              setPinValidationTarget(nextInvalid?.name ?? null)
            }}
            onSubmit={(event) => {
              if (event.currentTarget.checkValidity()) {
                setPinValidationTarget(null)
                return
              }
              event.preventDefault()
              const nextInvalid = event.currentTarget.querySelector<HTMLInputElement>("input:invalid")
              setPinValidationTarget(nextInvalid?.name ?? null)
              nextInvalid?.focus()
            }}
          >
            <div className="security-password-field">
              <label htmlFor="pin-current-password"><span>Current password <span className="security-required-marker" aria-hidden="true">*</span></span></label>
              <PasswordInput id="pin-current-password" name="currentPassword" autoComplete="current-password" required aria-invalid={pinValidationTarget === "currentPassword" ? true : undefined} />
            </div>
            <label><span>{pinEnabled ? "New PIN" : "PIN"} <span className="security-required-marker" aria-hidden="true">*</span></span><input className="login-pin-input" name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required aria-invalid={pinValidationTarget === "pin" ? true : undefined} /></label>
            <label><span>Confirm PIN <span className="security-required-marker" aria-hidden="true">*</span></span><input className="login-pin-input" name="confirmPin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required aria-invalid={pinValidationTarget === "confirmPin" ? true : undefined} /></label>
            {pinValidationTarget ? <p className="security-validation-message" role="alert">Complete the highlighted required field.</p> : null}
            {pinState.error ? <p className="login-error" role="alert">{pinState.error}</p> : null}
            {pinState.success ? <p className="security-success" role="status">{pinState.success}</p> : null}
            <button type="submit" disabled={pinPending}>{pinPending ? "Saving…" : pinEnabled ? "Change PIN" : "Enable PIN login"}</button>
          </form>
          {pinEnabled && !pinRequired ? (
            <form className="security-form security-pin-remove" action={removeAction} noValidate>
              <div className="security-password-field">
                <label htmlFor="pin-remove-current-password"><span>Current password <span className="security-required-marker" aria-hidden="true">*</span></span></label>
                <PasswordInput id="pin-remove-current-password" name="currentPassword" autoComplete="current-password" required />
              </div>
              {removeState.error ? <p className="login-error" role="alert">{removeState.error}</p> : null}
              {removeState.success ? <p className="security-success" role="status">{removeState.success}</p> : null}
              <button className="security-secondary-action" type="submit" disabled={removePending}>{removePending ? "Removing…" : "Remove PIN"}</button>
            </form>
          ) : null}
        </section>
      ) : null}

    </div>
  )
}
