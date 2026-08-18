"use client"

import { useActionState, useState, useTransition } from "react"
import Link from "next/link"
import { KeyRound, LogOut, ShieldCheck, UserPlus } from "lucide-react"

import {
  approveJuniorCoachRequestAction,
  changePasswordAction,
  rejectJuniorCoachRequestAction,
  removePinAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  savePinAction,
  type PasswordChangeState,
  type PinManagementState,
} from "@/app/account/security/actions"

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

type PendingCoachRequest = {
  createdAt: string
  fullName: string
  id: string
}

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
  pendingCoachRequests,
  pinEnabled,
  pinRequired,
  sessions,
  showCoachMfaSetup,
}: {
  allowPin: boolean
  pendingCoachRequests: PendingCoachRequest[]
  pinEnabled: boolean
  pinRequired: boolean
  sessions: SecuritySession[]
  showCoachMfaSetup: boolean
}) {
  const [passwordState, passwordAction, passwordPending] = useActionState(
    changePasswordAction,
    initialPasswordState,
  )
  const [pinState, pinAction, pinPending] = useActionState(savePinAction, initialPinState)
  const [removeState, removeAction, removePending] = useActionState(removePinAction, initialPinState)
  const [requestMessage, setRequestMessage] = useState<string | null>(null)
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function approveCoachRequest(request: PendingCoachRequest) {
    setBusyAccountId(request.id)
    setRequestMessage(null)
    startTransition(async () => {
      const result = await approveJuniorCoachRequestAction(request.id)
      setBusyAccountId(null)
      setRequestMessage(result.ok
        ? `${request.fullName} approved as ${result.data.academyId}. They can create a password in their registration browser.`
        : result.message)
    })
  }

  function rejectCoachRequest(request: PendingCoachRequest) {
    setBusyAccountId(request.id)
    setRequestMessage(null)
    startTransition(async () => {
      const result = await rejectJuniorCoachRequestAction(request.id)
      setBusyAccountId(null)
      setRequestMessage(result.ok ? `${request.fullName}’s request was rejected.` : result.message)
    })
  }

  return (
    <div className="security-workspace">
      {showCoachMfaSetup ? (
        <section className="security-panel security-mfa-callout">
          <ShieldCheck aria-hidden="true" />
          <div>
            <p className="eyebrow">Protected access</p>
            <h2>Add an authenticator app</h2>
            <p>This account must complete this step before protected workspace access.</p>
          </div>
          <Link href="/auth/two-factor/setup">Set up authenticator</Link>
        </section>
      ) : null}

      <div className="security-columns">
        <section className="security-panel" aria-labelledby="change-password-title">
          <header>
            <KeyRound aria-hidden="true" />
            <div><p className="eyebrow">Credentials</p><h2 id="change-password-title">Change password</h2></div>
          </header>
          <form className="security-form" action={passwordAction} noValidate>
            <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
            <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
            <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
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
          <form className="security-form security-pin-form" action={pinAction} noValidate>
            <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
            <label>{pinEnabled ? "New PIN" : "PIN"}<input className="login-pin-input" name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required /></label>
            <label>Confirm PIN<input className="login-pin-input" name="confirmPin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required /></label>
            {pinState.error ? <p className="login-error" role="alert">{pinState.error}</p> : null}
            {pinState.success ? <p className="security-success" role="status">{pinState.success}</p> : null}
            <button type="submit" disabled={pinPending}>{pinPending ? "Saving…" : pinEnabled ? "Change PIN" : "Enable PIN login"}</button>
          </form>
          {pinEnabled && !pinRequired ? (
            <form className="security-form security-pin-remove" action={removeAction} noValidate>
              <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
              {removeState.error ? <p className="login-error" role="alert">{removeState.error}</p> : null}
              {removeState.success ? <p className="security-success" role="status">{removeState.success}</p> : null}
              <button className="security-secondary-action" type="submit" disabled={removePending}>{removePending ? "Removing…" : "Remove PIN"}</button>
            </form>
          ) : null}
        </section>
      ) : null}

      {pendingCoachRequests.length ? (
        <section className="security-panel security-account-access" aria-labelledby="coach-requests-title">
          <header>
            <UserPlus aria-hidden="true" />
            <div>
              <p className="eyebrow">Head coach control</p>
              <h2 id="coach-requests-title">Junior-coach requests</h2>
            </div>
          </header>
          <p>Approve only staff members whose identity you have confirmed.</p>
          {requestMessage ? <p className="security-success" role="status">{requestMessage}</p> : null}
          <div className="security-account-table">
            {pendingCoachRequests.map((request) => (
              <div key={request.id}>
                <div>
                  <strong>{request.fullName}</strong>
                  <span>Requested {new Date(request.createdAt).toLocaleDateString("en-IN")}</span>
                </div>
                <span className="security-status security-status-pending">Pending review</span>
                <div className="security-request-actions">
                  <button type="button" disabled={busyAccountId === request.id || isPending} onClick={() => approveCoachRequest(request)}>Approve</button>
                  <button type="button" disabled={busyAccountId === request.id || isPending} onClick={() => rejectCoachRequest(request)}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

    </div>
  )
}
