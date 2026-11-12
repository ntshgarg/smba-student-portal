"use client"

import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import { ArrowRight, Check, Clock, X } from "lucide-react"
import Link from "next/link"

import { confirmRegistrationCode, requestRegistrationCode } from "@/app/login/actions"
import { ActivationForm } from "@/components/activation-form"
import {
  EMPTY_REGISTRATION_STATE,
  passwordStepReachable,
  registrationDetailsAgain,
  registrationForAnotherPlayer,
  type RegistrationFormState,
} from "@/lib/auth/registration-form"

const SUBMISSION_FAILURE_MESSAGE =
  "We couldn’t send your request. Your details are still here—please try again."

/*
 * The code step's own failure. The confirm call writes the request and spends
 * the code in one go, so a reply lost on the way back can hide a request that
 * did reach the coach -- and then any retry with the same code is refused. Say
 * that, and point at the status check that can tell the difference, rather than
 * "we couldn't send your request".
 */
const CODE_STEP_FAILURE_MESSAGE =
  "We didn’t hear back after checking your code. If it went through, your request is already with your coach—check its status before sending it again."

function formDataFor(values: RegistrationFormState["values"], code?: string) {
  const formData = new FormData()
  for (const [field, value] of Object.entries(values)) formData.set(field, value)
  if (code !== undefined) formData.set("code", code)
  return formData
}

/**
 * Two steps in one component rather than two routes, so a wrong code returns the
 * person to the code field with everything they typed intact. The step is read
 * from the action's reply instead of inferred locally: only the server knows
 * whether a code actually went out.
 *
 * The way back is local, though. "Change details" and "Register another player"
 * never ask the server anything; they only reopen the form, so a mistyped email
 * or a second child no longer means reloading the page and typing it all again.
 */
export function RegistrationForm({
  initialState = EMPTY_REGISTRATION_STATE,
}: {
  /** Where the form starts. Only tests start it anywhere but the empty details step. */
  initialState?: RegistrationFormState
} = {}) {
  const [state, setState] = useState(initialState)
  const [values, setValues] = useState(initialState.values)
  const [code, setCode] = useState("")
  const [pending, setPending] = useState(false)
  /** "resend" while a new code is being asked for from the code step. */
  const [pendingKind, setPendingKind] = useState<"submit" | "resend" | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lostCodeReply, setLostCodeReply] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)
  const fullNameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const dateOfBirthRef = useRef<HTMLInputElement>(null)
  const submitButtonRef = useRef<HTMLButtonElement>(null)
  const submissionInFlight = useRef(false)

  useEffect(() => {
    const target = {
      code: codeRef,
      dateOfBirth: dateOfBirthRef,
      email: emailRef,
      fullName: fullNameRef,
      phone: phoneRef,
      requestedRole: null,
    }[state.errorField ?? "requestedRole"]
    if (state.error && target?.current) target.current.focus()
  }, [state])

  useEffect(() => {
    if (!pending && state.error && state.errorField === null) {
      submitButtonRef.current?.focus()
    }
  }, [pending, state])

  async function run(kind: "submit" | "resend", call: () => Promise<RegistrationFormState>, onCodeStep: boolean) {
    if (submissionInFlight.current) return

    submissionInFlight.current = true
    setPending(true)
    setPendingKind(kind)
    setNotice(null)
    setLostCodeReply(false)
    // Clear the previous answer before asking again. Leaving it up meant a
    // stale "we couldn't send your request" sat beside the spinner for the whole
    // of the next attempt, so a retry looked like it had already failed.
    setState((current) => ({ ...current, error: null, errorField: null }))

    try {
      const next = await call()
      setState(next)
      if (kind === "resend" && next.step === "code" && !next.error) {
        setCode("")
        setNotice(`If a new code was due, it is on its way to ${next.values.email}. A code you already received still works until it runs out.`)
      }
    } catch {
      const codeStepConfirm = onCodeStep && kind === "submit"
      setLostCodeReply(codeStepConfirm)
      setState({
        ...state,
        error: codeStepConfirm ? CODE_STEP_FAILURE_MESSAGE : SUBMISSION_FAILURE_MESSAGE,
        errorField: null,
      })
    } finally {
      submissionInFlight.current = false
      setPending(false)
      setPendingKind(null)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const onCodeStep = state.step === "code"
    // The details ride along with the code so the server can rebuild the identity
    // key without trusting a cookie or a hidden request id.
    const formData = formDataFor(values, onCodeStep ? code : undefined)
    void run(
      "submit",
      () => onCodeStep
        ? confirmRegistrationCode(state, formData)
        : requestRegistrationCode(state, formData),
      onCodeStep,
    )
  }

  function sendNewCode() {
    void run("resend", () => requestRegistrationCode(state, formDataFor(values)), true)
  }

  function reopen(next: RegistrationFormState) {
    if (submissionInFlight.current) return
    setState(next)
    setValues(next.values)
    setCode("")
    setNotice(null)
    setLostCodeReply(false)
  }

  if (state.step === "done") {
    /*
     * "approved" is the standing from the moment a coach approves and never
     * changes again, so it alone cannot tell a player still waiting on
     * onboarding from one who finished it weeks ago and already has a password.
     * Sending the second group away to wait was the whole defect: they had
     * nothing to wait for, and re-registering is exactly what someone does when
     * they have forgotten they already have an account. Worded to match the
     * status door in components/registration-status-form.tsx.
     */
    const settled = state.standing === "approved" && state.activated
    /*
     * Ready for a password. The action has already handed this browser the
     * receipt, so the password step is offered right here -- the same as the
     * status door -- instead of a link to /activate that asked for the name,
     * email and a second code all over again.
     */
    const ready = passwordStepReachable(state) && Boolean(state.academyId)
    const heading = settled
      ? "Your account is ready."
      : {
        approved: "Approved.",
        new: "Registration received.",
        pending: "Already in review.",
        rejected: "Registration not accepted.",
      }[state.standing ?? "new"]
    const body = settled
      ? "This account already has a password. Sign in with the Academy ID below."
      : {
        approved: state.onboardingCompleted
          ? "Your coach has finished setting up training. Create a password to sign in."
          : "Your coach is setting up training. You’ll be able to sign in once that is finished.",
        new: `Your coach will review this ${state.values.requestedRole === "coach" ? "assistant-coach" : "player"} request. You can check the status any time with this name and email.`,
        pending: `${state.values.fullName}’s request is already with your coach. Nothing new was created.`,
        rejected: "This registration was not accepted. Please contact the academy.",
      }[state.standing ?? "new"]

    return (
      <div className="registration-confirmation" role="status">
        <span>
          {state.standing === "rejected"
            ? <X aria-hidden="true" />
            : state.standing === "pending" ? <Clock aria-hidden="true" /> : <Check aria-hidden="true" />}
        </span>
        <h2>{heading}</h2>
        <p>{body}</p>
        {state.academyId && !ready ? (
          <p className="registration-academy-id">
            <span className="operational-eyebrow">Academy ID</span>
            <strong>{state.academyId}</strong>
          </p>
        ) : null}
        {ready && state.academyId ? <ActivationForm academyId={state.academyId} /> : null}
        {settled
          ? <Link href="/login">Sign in</Link>
          : ready ? null : <Link href="/activate">View activation status</Link>}
        <button
          className="registration-restart"
          type="button"
          onClick={() => reopen(registrationForAnotherPlayer(state))}
        >
          Register another player
        </button>
      </div>
    )
  }

  const onCodeStep = state.step === "code"
  const fieldError = (field: RegistrationFormState["errorField"]) =>
    state.errorField === field ? state.error : null

  return (
    <form className="login-form" method="post" onSubmit={submit} noValidate>
      {onCodeStep ? (
        <>
          {/*
            Shown to everyone, always. Codes are limited to one per address per
            minute so a stranger cannot flood an inbox, which means a parent
            registering a second child in the same sitting can land on a wait
            they did not ask for. Saying it up front explains that without the
            page having to admit anything about who is already registered.
          */}
          <p className="login-helper">
            If that address can be registered, we’ve sent a code to {state.values.email}. It can
            take a minute to arrive. If nothing comes, send a new code, or change the details if
            the email is wrong.
          </p>
          <div className="login-field">
            <label htmlFor="registration-code">6-digit code</label>
            <input
              ref={codeRef}
              id="registration-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
              aria-describedby={fieldError("code") ? "registration-code-error" : undefined}
              aria-invalid={fieldError("code") ? true : undefined}
              disabled={pending}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            {fieldError("code") ? (
              <p id="registration-code-error" className="login-error" role="alert">{state.error}</p>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="login-field">
            <label htmlFor="requested-role">I am registering a</label>
            <select
              id="requested-role"
              name="requestedRole"
              disabled={pending}
              value={values.requestedRole}
              onChange={(event) => setValues({
                ...values,
                requestedRole: event.target.value === "coach" ? "coach" : "player",
              })}
            >
              <option value="player">Player</option>
              <option value="coach">Assistant coach</option>
            </select>
            <p id="requested-role-help" className="login-helper">
              Assistant-coach access requires head-coach approval.
            </p>
          </div>

          <div className="login-field">
            <label htmlFor="full-name">Full name</label>
            <input
              ref={fullNameRef}
              id="full-name"
              name="fullName"
              type="text"
              autoComplete="name"
              maxLength={80}
              required
              aria-describedby={fieldError("fullName") ? "full-name-error" : "full-name-help"}
              aria-invalid={fieldError("fullName") ? true : undefined}
              disabled={pending}
              value={values.fullName}
              onChange={(event) => setValues({ ...values, fullName: event.target.value })}
            />
            <p id="full-name-help" className="login-helper">The player’s name.</p>
            {fieldError("fullName") ? (
              <p id="full-name-error" className="login-error" role="alert">{state.error}</p>
            ) : null}
          </div>

          <div className="login-field">
            <label htmlFor="date-of-birth">Date of birth</label>
            <input
              ref={dateOfBirthRef}
              id="date-of-birth"
              name="dateOfBirth"
              type="date"
              required
              aria-describedby={fieldError("dateOfBirth") ? "date-of-birth-error" : undefined}
              aria-invalid={fieldError("dateOfBirth") ? true : undefined}
              disabled={pending}
              value={values.dateOfBirth}
              onChange={(event) => setValues({ ...values, dateOfBirth: event.target.value })}
            />
            {fieldError("dateOfBirth") ? (
              <p id="date-of-birth-error" className="login-error" role="alert">{state.error}</p>
            ) : null}
          </div>

          <div className="login-field">
            <label htmlFor="contact-email">Contact email</label>
            <input
              ref={emailRef}
              id="contact-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              aria-describedby={fieldError("email") ? "contact-email-error" : "contact-email-help"}
              aria-invalid={fieldError("email") ? true : undefined}
              disabled={pending}
              value={values.email}
              onChange={(event) => setValues({ ...values, email: event.target.value })}
            />
            <p id="contact-email-help" className="login-helper">We’ll send a 6-digit code here.</p>
            {fieldError("email") ? (
              <p id="contact-email-error" className="login-error" role="alert">{state.error}</p>
            ) : null}
          </div>

          <div className="login-field">
            <label htmlFor="contact-mobile">Contact mobile</label>
            <input
              ref={phoneRef}
              id="contact-mobile"
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={20}
              required
              aria-describedby={fieldError("phone") ? "contact-mobile-error" : undefined}
              aria-invalid={fieldError("phone") ? true : undefined}
              disabled={pending}
              value={values.phone}
              onChange={(event) => setValues({ ...values, phone: event.target.value })}
            />
            {fieldError("phone") ? (
              <p id="contact-mobile-error" className="login-error" role="alert">{state.error}</p>
            ) : null}
          </div>
        </>
      )}

      {state.error && state.errorField === null ? (
        <p id="registration-form-error" className="login-error" role="alert">
          {state.error}
          {lostCodeReply ? <> <Link href="/activate">Check your status</Link></> : null}
        </p>
      ) : null}
      {notice ? <p className="login-helper" role="status">{notice}</p> : null}

      <button ref={submitButtonRef} className="login-submit" type="submit" disabled={pending}>
        <span>
          {pendingKind === "submit"
            ? onCodeStep ? "Verifying…" : "Sending code…"
            : onCodeStep ? "Verify" : "Send code"}
        </span>
        <ArrowRight aria-hidden="true" />
      </button>
      {onCodeStep ? (
        <>
          <button className="totp-switch" type="button" disabled={pending} onClick={sendNewCode}>
            {pendingKind === "resend" ? "Sending a new code…" : "Send a new code"}
          </button>
          <button
            className="totp-switch"
            type="button"
            disabled={pending}
            onClick={() => reopen(registrationDetailsAgain(state))}
          >
            Change details
          </button>
        </>
      ) : null}
    </form>
  )
}
