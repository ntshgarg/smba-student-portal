"use client"

import { useEffect, useState } from "react"
import { MailCheck, ShieldCheck } from "lucide-react"

import {
  confirmRecoveryEmailChange,
  requestRecoveryEmailChange,
  type RecoveryEmailEnrollmentState,
} from "@/app/account/recovery-email/actions"
import { PasswordInput } from "@/components/password-input"
import { useResilientActionState } from "@/lib/client/use-resilient-action-state"

const initialRecoveryEmailEnrollmentState: RecoveryEmailEnrollmentState = {
  email: "",
  error: null,
  sent: false,
}

export function RecoveryEmailSecurityPanel({
  changed = false,
  maskedEmail,
  requiresSecondFactor,
}: {
  /** The page was reached straight after a change was confirmed. */
  changed?: boolean
  maskedEmail: string
  requiresSecondFactor: boolean
}) {
  // Each change attempt is its own pair of form states; "Use a different address" remounts the pair.
  const [attempt, setAttempt] = useState(0)
  // The address from the attempt being redone, so a typo is fixed, not retyped.
  const [previousEmail, setPreviousEmail] = useState("")

  /*
   * The "changed" notice belongs to this one visit. The marker comes off the
   * address straight away, so a reload or a bookmark a week later does not
   * announce a change again (and a shared link cannot show it either).
   */
  useEffect(() => {
    if (!changed) return
    const url = new URL(window.location.href)
    if (!url.searchParams.has("emailChanged")) return
    url.searchParams.delete("emailChanged")
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
  }, [changed])

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
      {changed && attempt === 0 ? (
        <p className="security-success" role="status">
          Recovery email changed. Reset links sent to the old address no longer work.
        </p>
      ) : null}
      <RecoveryEmailChangeForms
        key={attempt}
        initialEmail={previousEmail}
        onStartOver={(email) => {
          setPreviousEmail(email)
          setAttempt((value) => value + 1)
        }}
        requiresSecondFactor={requiresSecondFactor}
      />
    </section>
  )
}

function RecoveryEmailChangeForms({
  initialEmail,
  onStartOver,
  requiresSecondFactor,
}: {
  initialEmail: string
  onStartOver: (email: string) => void
  requiresSecondFactor: boolean
}) {
  const [requestState, requestAction, requesting] = useResilientActionState(
    requestRecoveryEmailChange,
    initialRecoveryEmailEnrollmentState,
    {
      subject: "Your recovery email change",
      unconfirmed: "Your current recovery address stays in place until you confirm a code."
        + " Check the connection and send it again. If two codes arrive, use the newest one",
    },
  )
  const [confirmState, confirmAction, confirming] = useResilientActionState(
    confirmRecoveryEmailChange,
    initialRecoveryEmailEnrollmentState,
    {
      subject: "Your verification code",
      unconfirmed: "Reload this page to see which recovery address is saved before trying again",
    },
  )
  const [requestValidationTarget, setRequestValidationTarget] = useState<string | null>(null)
  const [confirmValidationTarget, setConfirmValidationTarget] = useState<string | null>(null)
  const sent = requestState.sent || confirmState.sent
  const email = confirmState.email || requestState.email

  if (sent) {
    return (
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
        <p role="status">We sent a six-digit code to <strong>{email}</strong>. If that address is wrong, use a different address below. A new code can be sent one minute after this one.</p>
        <label>
          <span>Verification code <span className="security-required-marker" aria-hidden="true">*</span></span>
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required aria-invalid={confirmValidationTarget === "code" ? true : undefined} />
        </label>
        {confirmValidationTarget ? <p className="security-validation-message" role="alert">Enter the highlighted six-digit verification code.</p> : null}
        {confirmState.error ? <p className="login-error" role="alert">{confirmState.error}</p> : null}
        <button type="submit" disabled={confirming}>{confirming ? "Verifying…" : "Confirm new email"}</button>
        <button
          className="security-secondary-action"
          type="button"
          disabled={confirming}
          onClick={() => onStartOver(email)}
        >
          Use a different address
        </button>
      </form>
    )
  }

  return (
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
        <input name="email" type="email" autoComplete="email" maxLength={254} required defaultValue={requestState.email || initialEmail} aria-invalid={requestValidationTarget === "email" ? true : undefined} />
      </label>
      <div className="security-password-field">
        <label htmlFor="recovery-email-current-password">
          <span>Current password <span className="security-required-marker" aria-hidden="true">*</span></span>
        </label>
        <PasswordInput id="recovery-email-current-password" name="currentPassword" autoComplete="current-password" required aria-invalid={requestValidationTarget === "currentPassword" ? true : undefined} />
      </div>
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
  )
}
