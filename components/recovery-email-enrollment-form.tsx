"use client"

import { ArrowRight, MailCheck } from "lucide-react"
import { useState } from "react"

import {
  type RecoveryEmailEnrollmentState,
} from "@/app/account/recovery-email/actions"
import { useResilientActionState } from "@/lib/client/use-resilient-action-state"

const initialRecoveryEmailEnrollmentState: RecoveryEmailEnrollmentState = {
  email: "",
  error: null,
  sent: false,
}

/**
 * The fold both hooks need once a result has been retired.
 *
 * `resilientAction` folds a dropped submission onto whatever state React handed
 * the action (lib/client/use-resilient-action-state.ts:80), and after a
 * retirement that is still the retired result. The default fold rewrites only
 * `error`, so it returns a *new* object -- live by identity -- still carrying
 * the abandoned address and its `sent: true`. On the address form that bounces
 * the coach onto the code step for the address they just walked away from. On
 * the code step it drags `sentTo` back to that same address -- both the copy
 * and the hidden `email` the confirm action verifies against, and
 * lib/auth/recovery-service.ts:294 matches the challenge row on that address,
 * so every code the coach can enter is then refused with the "Use a different
 * email" button their only clue. A dropped submission is routine on a venue
 * connection, so both are one flaky post away.
 *
 * Folding onto the initial state keeps the failure and nothing else. `fullName`
 * rides along: it is the coach's own typing, not a claim about a code that was
 * sent.
 */
function foldPastRetirement(retiredState?: RecoveryEmailEnrollmentState) {
  return (state: RecoveryEmailEnrollmentState, error: string) => (
    state === retiredState
      ? { ...initialRecoveryEmailEnrollmentState, error, fullName: state.fullName }
      : { ...state, error }
  )
}

type EnrollmentAction = (
  state: RecoveryEmailEnrollmentState,
  formData: FormData,
) => Promise<RecoveryEmailEnrollmentState>

export function RecoveryEmailEnrollmentForm({
  collectName = false,
  confirmAction,
  defaultName = "",
  requestAction,
}: {
  collectName?: boolean
  confirmAction: EnrollmentAction
  defaultName?: string
  requestAction: EnrollmentAction
}) {
  /**
   * The pair of results the coach has retired by asking for the address field
   * back. `useActionState` hands out no setter -- its state moves only when its
   * own action resolves -- and every confirm failure in
   * app/account/recovery-email/actions.ts returns `sent: true` (:84, :133,
   * :218, :274), so once the code step appeared nothing could take it away. A
   * head coach who mistyped the address, or whose mail is blocked, was then
   * held on this page by the three redirects into it (app/coach/layout.tsx:27,
   * app/(student)/layout.tsx:32, app/admin/page.tsx:35) with the courtside
   * registers on the far side.
   *
   * Both actions build a fresh object on every call, so object identity is an
   * exact "is this still the same result?" test. Retiring the two results by
   * identity resets each hook without one existing -- and each counts again the
   * instant its own action resolves with something new. That is what keeps a
   * *failed* re-send on the address form: its request result is new, but the
   * confirm result beside it is still the retired one, so the stale `sent: true`
   * cannot slam the gate a second time. What identity alone cannot catch is a
   * *dropped* submission, whose folded result is new by construction;
   * `foldPastRetirement` above strips the retired claims out of those before
   * they land.
   */
  const [retired, setRetired] = useState<{
    confirm: RecoveryEmailEnrollmentState
    request: RecoveryEmailEnrollmentState
  } | null>(null)
  const [requestState, send, sending] = useResilientActionState(
    requestAction,
    { ...initialRecoveryEmailEnrollmentState, fullName: defaultName },
    {
      fold: foldPastRetirement(retired?.request),
      retained: "No verification code was sent",
      subject: "Your recovery email",
    },
  )
  const [confirmState, confirm, confirming] = useResilientActionState(
    confirmAction,
    initialRecoveryEmailEnrollmentState,
    {
      fold: foldPastRetirement(retired?.confirm),
      retained: "The code was not used and is still valid",
      subject: "Your verification code",
    },
  )
  // A retired result speaks for nothing: not the step, not the address the code
  // was sent to, not the verdict on screen.
  const liveRequest = requestState === retired?.request ? null : requestState
  const liveConfirm = confirmState === retired?.confirm ? null : confirmState
  const sent = Boolean(liveRequest?.sent || liveConfirm?.sent)
  /** The address a live result says the code actually went to. */
  const sentTo = liveConfirm?.email || liveRequest?.email || ""
  /** The last address typed, retired or not, so a typo is corrected rather than retyped. */
  const email = sentTo || confirmState.email || requestState.email
  const fullName = confirmState.fullName || requestState.fullName || defaultName

  if (sent) {
    return (
      <form className="login-form" action={confirm} noValidate>
        <div className="recovery-email-sent" role="status">
          <MailCheck aria-hidden="true" />
          <div>
            <strong>Check your email</strong>
            <p>Enter the six-digit code sent to {sentTo}.</p>
          </div>
        </div>
        <input type="hidden" name="email" value={sentTo} />
        {collectName ? <input type="hidden" name="fullName" value={fullName} /> : null}
        <div className="login-field">
          <label htmlFor="recovery-email-code">Verification code</label>
          <input
            id="recovery-email-code"
            name="code"
            type="text"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            aria-describedby="recovery-email-code-help"
          />
          <p id="recovery-email-code-help" className="login-helper">
            The code expires in ten minutes and can be tried five times.
          </p>
        </div>
        {liveConfirm?.error || liveRequest?.error ? (
          <p className="login-error" role="alert">{liveConfirm?.error ?? liveRequest?.error}</p>
        ) : null}
        <button className="login-submit" type="submit" disabled={confirming}>
          <span>{confirming ? "Verifying…" : "Verify recovery email"}</span>
          <ArrowRight aria-hidden="true" />
        </button>
        <button className="totp-switch" type="submit" formAction={send} disabled={sending || confirming}>
          {sending ? "Sending another code…" : "Send another code"}
        </button>
        <button
          className="totp-switch"
          type="button"
          disabled={sending || confirming}
          onClick={() => setRetired({ confirm: confirmState, request: requestState })}
        >
          Use a different email
        </button>
      </form>
    )
  }

  return (
    <form className="login-form" action={send} noValidate>
      {collectName ? (
        <div className="login-field">
          <label htmlFor="recovery-email-full-name">Full name</label>
          <input
            id="recovery-email-full-name"
            name="fullName"
            autoComplete="name"
            minLength={2}
            maxLength={80}
            defaultValue={fullName}
            required
          />
        </div>
      ) : null}
      <div className="login-field">
        <label htmlFor="recovery-email">Recovery email</label>
        <input
          id="recovery-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          defaultValue={email}
          required
          aria-describedby="recovery-email-help"
        />
        <p id="recovery-email-help" className="login-helper">
          This address is used only for account security and may be shared by siblings.
        </p>
      </div>
      {liveRequest?.error ? <p className="login-error" role="alert">{liveRequest.error}</p> : null}
      <button className="login-submit" type="submit" disabled={sending}>
        <span>{sending ? "Sending code…" : "Send verification code"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
