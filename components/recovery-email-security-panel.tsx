"use client"

import { useActionState, useState } from "react"
import { MailCheck, ShieldCheck } from "lucide-react"

import {
  confirmRecoveryEmailChange,
  requestRecoveryEmailChange,
  type RecoveryEmailEnrollmentState,
} from "@/app/account/recovery-email/actions"

const initialRecoveryEmailEnrollmentState: RecoveryEmailEnrollmentState = {
  email: "",
  error: null,
  sent: false,
}

export function RecoveryEmailSecurityPanel({
  maskedEmail,
  requiresSecondFactor,
}: {
  maskedEmail: string
  requiresSecondFactor: boolean
}) {
  const [requestState, requestAction, requesting] = useActionState(
    requestRecoveryEmailChange,
    initialRecoveryEmailEnrollmentState,
  )
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmRecoveryEmailChange,
    initialRecoveryEmailEnrollmentState,
  )
  const [requestValidationTarget, setRequestValidationTarget] = useState<string | null>(null)
  const [confirmValidationTarget, setConfirmValidationTarget] = useState<string | null>(null)
  const sent = requestState.sent || confirmState.sent
  const email = confirmState.email || requestState.email

  return (
    <section className="security-panel" aria-labelledby="recovery-email-security-title">
      <header>
        <MailCheck aria-hidden="true" />
        <div>
          <p className="eyebrow">Account recovery</p>
          <h2 id="recovery-email-security-title">Recovery email</h2>
        </div>
      </header>
      <p>Verified address: <strong>{maskedEmail}</strong></p>
      {sent ? (
        <form
          className="security-form security-recovery-form"
          action={confirmAction}
          noValidate
          onInput={(event) => {
            if (!confirmValidationTarget) return
            const nextInvalid = event.currentTarget.querySelector<HTMLInputElement>("input:invalid")
            setConfirmValidationTarget(nextInvalid?.name ?? null)
          }}
          onSubmit={(event) => {
            if (event.currentTarget.checkValidity()) {
              setConfirmValidationTarget(null)
              return
            }
            event.preventDefault()
            const nextInvalid = event.currentTarget.querySelector<HTMLInputElement>("input:invalid")
            setConfirmValidationTarget(nextInvalid?.name ?? null)
            nextInvalid?.focus()
          }}
        >
          <input type="hidden" name="email" value={email} />
          <label>
            <span>Verification code <span className="security-required-marker" aria-hidden="true">*</span></span>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required aria-invalid={confirmValidationTarget === "code" ? true : undefined} />
          </label>
          <p>Enter the six-digit code sent to the new address.</p>
          {confirmValidationTarget ? <p className="security-validation-message" role="alert">Enter the highlighted six-digit verification code.</p> : null}
          {confirmState.error ? <p className="login-error" role="alert">{confirmState.error}</p> : null}
          <button type="submit" disabled={confirming}>{confirming ? "Verifying…" : "Confirm new email"}</button>
        </form>
      ) : (
        <form
          className="security-form security-recovery-form"
          action={requestAction}
          noValidate
          onInput={(event) => {
            if (!requestValidationTarget) return
            const nextInvalid = event.currentTarget.querySelector<HTMLInputElement>("input:invalid")
            setRequestValidationTarget(nextInvalid?.name ?? null)
          }}
          onSubmit={(event) => {
            if (event.currentTarget.checkValidity()) {
              setRequestValidationTarget(null)
              return
            }
            event.preventDefault()
            const nextInvalid = event.currentTarget.querySelector<HTMLInputElement>("input:invalid")
            setRequestValidationTarget(nextInvalid?.name ?? null)
            nextInvalid?.focus()
          }}
        >
          <label>
            <span>New recovery email <span className="security-required-marker" aria-hidden="true">*</span></span>
            <input name="email" type="email" autoComplete="email" maxLength={254} required aria-invalid={requestValidationTarget === "email" ? true : undefined} />
          </label>
          <label>
            <span>Current password <span className="security-required-marker" aria-hidden="true">*</span></span>
            <input name="currentPassword" type="password" autoComplete="current-password" required aria-invalid={requestValidationTarget === "currentPassword" ? true : undefined} />
          </label>
          {requiresSecondFactor ? (
            <label>
              <span>Authenticator or backup code <span className="security-required-marker" aria-hidden="true">*</span></span>
              <input name="secondFactor" type="text" autoComplete="one-time-code" required aria-invalid={requestValidationTarget === "secondFactor" ? true : undefined} />
            </label>
          ) : null}
          <p>A new address becomes active only after its verification code is confirmed.</p>
          {requestValidationTarget ? <p className="security-validation-message" role="alert">Complete the highlighted required field.</p> : null}
          {requestState.error ? <p className="login-error" role="alert">{requestState.error}</p> : null}
          <button className="security-recovery-submit" type="submit" disabled={requesting}>
            <ShieldCheck aria-hidden="true" />
            {requesting ? "Sending code…" : "Change recovery email"}
          </button>
        </form>
      )}
    </section>
  )
}
