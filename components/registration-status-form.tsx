"use client"

import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import { ArrowRight, Check, Clock, X } from "lucide-react"
import Link from "next/link"

import {
  confirmRegistrationStatusCode,
  requestRegistrationStatusCode,
} from "@/app/activate/actions"
import {
  EMPTY_REGISTRATION_STATUS_STATE,
  type RegistrationStatusState,
} from "@/lib/auth/registration-form"
import { ActivationForm } from "@/components/activation-form"

const SUBMISSION_FAILURE_MESSAGE =
  "We couldn’t check that just now. Your details are still here—please try again."

/**
 * Name, email, code -- and it works on any device.
 *
 * Before this, the only link between a person and their request was a cookie in
 * the browser they registered from. Clearing it or picking up a phone left them
 * with no way to ask where they stood, and the only button on screen was
 * "request registration" -- which is why some of the duplicate queue is people
 * checking rather than people abusing.
 *
 * When the request is approved and onboarding is finished, the action mints the
 * activation claim, so the page that renders next can offer the password step
 * without needing the original browser.
 */
export function RegistrationStatusForm() {
  const [state, setState] = useState<RegistrationStatusState>(EMPTY_REGISTRATION_STATUS_STATE)
  const [values, setValues] = useState({ email: "", fullName: "" })
  const [code, setCode] = useState("")
  const [pending, setPending] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const fullNameRef = useRef<HTMLInputElement>(null)
  const submitButtonRef = useRef<HTMLButtonElement>(null)
  const submissionInFlight = useRef(false)

  useEffect(() => {
    const target = { code: codeRef, email: emailRef, fullName: fullNameRef }[state.errorField ?? "code"]
    if (state.error && state.errorField && target.current) target.current.focus()
    if (state.error && !state.errorField) submitButtonRef.current?.focus()
  }, [state])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionInFlight.current) return

    submissionInFlight.current = true
    setPending(true)
    const formData = new FormData(event.currentTarget)
    const onCodeStep = state.step === "code"
    formData.set("email", values.email)
    formData.set("fullName", values.fullName)

    try {
      setState(onCodeStep
        ? await confirmRegistrationStatusCode(state, formData)
        : await requestRegistrationStatusCode(state, formData))
    } catch {
      setState({ ...state, error: SUBMISSION_FAILURE_MESSAGE, errorField: null })
    } finally {
      submissionInFlight.current = false
      setPending(false)
    }
  }

  if (state.step === "done") {
    /*
     * "new" means no request exists under these details. It reads as a dead end
     * on purpose -- the alternative is telling whoever holds this mailbox which
     * name-and-address pairs are registered.
     */
    const heading = {
      approved: "Approved.",
      new: "Nothing to show yet.",
      pending: "Approval is pending.",
      rejected: "Request not approved.",
    }[state.standing ?? "new"]
    const body = {
      approved: state.onboardingCompleted
        ? "Your account is ready. Create a password below."
        : "Your coach is setting up training. You’ll be able to sign in once that is finished.",
      new: "We have no request under this name and email. Check the spelling, or send a new request.",
      pending: "Your coach is reviewing this request. We’ll keep it here until they decide.",
      rejected: "Please speak to your coach at the academy.",
    }[state.standing ?? "new"]

    return (
      <div className="registration-confirmation" role="status">
        <span>
          {state.standing === "rejected" ? <X aria-hidden="true" />
            : state.standing === "approved" ? <Check aria-hidden="true" />
              : <Clock aria-hidden="true" />}
        </span>
        <h2>{heading}</h2>
        <p>{body}</p>
        {state.academyId ? (
          <div className="login-field activation-academy-id">
            <label htmlFor="status-academy-id">Your Academy ID</label>
            <input id="status-academy-id" name="academyId" value={state.academyId} readOnly />
            <p className="login-helper">Save this ID. You will use it every time you sign in.</p>
          </div>
        ) : null}
        {state.standing === "approved" && state.onboardingCompleted && state.academyId ? (
          <ActivationForm academyId={state.academyId} />
        ) : null}
        {state.standing === "new" ? <Link href="/register">Request registration</Link> : null}
      </div>
    )
  }

  const onCodeStep = state.step === "code"
  const fieldError = (field: RegistrationStatusState["errorField"]) =>
    state.errorField === field ? state.error : null

  return (
    <form className="login-form" method="post" onSubmit={(event) => void submit(event)} noValidate>
      {onCodeStep ? (
        <div className="login-field">
          <label htmlFor="status-code">6-digit code</label>
          <input
            ref={codeRef}
            id="status-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            required
            aria-describedby={fieldError("code") ? "status-code-error" : "status-code-help"}
            aria-invalid={fieldError("code") ? true : undefined}
            disabled={pending}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <p id="status-code-help" className="login-helper">
            If those details can be looked up, we’ve sent a code to {values.email}.
          </p>
          {fieldError("code") ? (
            <p id="status-code-error" className="login-error" role="alert">{state.error}</p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="login-field">
            <label htmlFor="status-full-name">Full name</label>
            <input
              ref={fullNameRef}
              id="status-full-name"
              name="fullName"
              type="text"
              autoComplete="name"
              maxLength={80}
              required
              aria-describedby={fieldError("fullName") ? "status-full-name-error" : "status-full-name-help"}
              aria-invalid={fieldError("fullName") ? true : undefined}
              disabled={pending}
              value={values.fullName}
              onChange={(event) => setValues({ ...values, fullName: event.target.value })}
            />
            <p id="status-full-name-help" className="login-helper">
              The name the request was made in.
            </p>
            {fieldError("fullName") ? (
              <p id="status-full-name-error" className="login-error" role="alert">{state.error}</p>
            ) : null}
          </div>

          <div className="login-field">
            <label htmlFor="status-email">Contact email</label>
            <input
              ref={emailRef}
              id="status-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              aria-describedby={fieldError("email") ? "status-email-error" : undefined}
              aria-invalid={fieldError("email") ? true : undefined}
              disabled={pending}
              value={values.email}
              onChange={(event) => setValues({ ...values, email: event.target.value })}
            />
            {fieldError("email") ? (
              <p id="status-email-error" className="login-error" role="alert">{state.error}</p>
            ) : null}
          </div>
        </>
      )}

      {state.error && state.errorField === null ? (
        <p id="status-form-error" className="login-error" role="alert">{state.error}</p>
      ) : null}

      <button ref={submitButtonRef} className="login-submit" type="submit" disabled={pending}>
        <span>
          {pending
            ? onCodeStep ? "Checking…" : "Sending code…"
            : onCodeStep ? "Check status" : "Send code"}
        </span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
