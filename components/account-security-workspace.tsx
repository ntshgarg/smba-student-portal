"use client"

import { useActionState, useState, useTransition } from "react"
import Link from "next/link"
import { Check, KeyRound, LogOut, RefreshCw, ShieldCheck } from "lucide-react"

import {
  changePasswordAction,
  removePinAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  savePinAction,
  type PasswordChangeState,
  type PinManagementState,
} from "@/app/account/security/actions"
import { PasswordInput } from "@/components/password-input"

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
}: {
  allowPin: boolean
  authenticatorEnabled: boolean
  authenticatorRequired: boolean
  pinEnabled: boolean
  pinRequired: boolean
  sessions: SecuritySession[]
}) {
  const [passwordState, passwordAction, passwordPending] = useActionState(
    changePasswordAction,
    initialPasswordState,
  )
  const [pinState, pinAction, pinPending] = useActionState(savePinAction, initialPinState)
  const [removeState, removeAction, removePending] = useActionState(removePinAction, initialPinState)
  const [pinValidationTarget, setPinValidationTarget] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

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

      <div className="security-columns">
        <section className="security-panel" aria-labelledby="change-password-title">
          <header>
            <KeyRound aria-hidden="true" />
            <div><p className="eyebrow">Credentials</p><h2 id="change-password-title">Change password</h2></div>
          </header>
          <form className="security-form" action={passwordAction} noValidate>
            <div className="security-password-field">
              <label htmlFor="security-current-password">Current password</label>
              <PasswordInput id="security-current-password" name="currentPassword" autoComplete="current-password" required />
            </div>
            <div className="security-password-field">
              <label htmlFor="security-new-password">New password</label>
              <PasswordInput id="security-new-password" name="newPassword" autoComplete="new-password" minLength={12} maxLength={128} required />
            </div>
            <div className="security-password-field">
              <label htmlFor="security-confirm-password">Confirm new password</label>
              <PasswordInput id="security-confirm-password" name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required />
            </div>
            {passwordState.error ? <p className="login-error" role="alert">{passwordState.error}</p> : null}
            {passwordState.success ? <p className="security-success" role="status">{passwordState.success}</p> : null}
            <button type="submit" disabled={passwordPending}>{passwordPending ? "Changing…" : "Change password"}</button>
          </form>
        </section>

        <section className="security-panel" aria-labelledby="sessions-title">
          <header>
            <LogOut aria-hidden="true" />
            <div><p className="eyebrow">Devices</p><h2 id="sessions-title">Active sessions</h2></div>
          </header>
          <ul className="security-sessions">
            {sessions.map((session) => (
              <li key={session.id}>
                <div>
                  <strong>{deviceLabel(session.userAgent)}{session.current ? " · This device" : ""}</strong>
                  <span>Signed in {new Date(session.createdAt).toLocaleString("en-IN")}</span>
                  <span>Expires {new Date(session.expiresAt).toLocaleString("en-IN")}</span>
                </div>
                {!session.current ? (
                  <button type="button" onClick={() => startTransition(() => revokeSessionAction(session.id))}>Log out</button>
                ) : null}
              </li>
            ))}
          </ul>
          {sessions.length > 1 ? (
            <button className="security-secondary-action" type="button" onClick={() => startTransition(() => revokeOtherSessionsAction())} disabled={isPending}>
              Log out other devices
            </button>
          ) : null}
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
                <label htmlFor="pin-remove-current-password">Current password</label>
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
