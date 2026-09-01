"use client"

import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import { ArrowRight, Check, Clock, X } from "lucide-react"
import Link from "next/link"

import { confirmRegistrationCode, requestRegistrationCode } from "@/app/login/actions"
import {
  EMPTY_REGISTRATION_STATE,
  EMPTY_REGISTRATION_VALUES,
  type RegistrationFormState,
} from "@/lib/auth/registration-form"

const initialState = EMPTY_REGISTRATION_STATE

const SUBMISSION_FAILURE_MESSAGE =
  "We couldn’t send your request. Your details are still here—please try again."

/**
 * Two steps in one component rather than two routes, so a wrong code returns the
 * person to the code field with everything they typed intact. The step is read
 * from the action's reply instead of inferred locally: only the server knows
 * whether a code actually went out.
 */
export function RegistrationForm() {
  const [state, setState] = useState(initialState)
  const [values, setValues] = useState(EMPTY_REGISTRATION_VALUES)
  const [code, setCode] = useState("")
  const [pending, setPending] = useState(false)
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionInFlight.current) return

    submissionInFlight.current = true
    setPending(true)
    const formData = new FormData(event.currentTarget)
    const onCodeStep = state.step === "code"
    // The details ride along with the code so the server can rebuild the identity
    // key without trusting a cookie or a hidden request id.
    for (const [field, value] of Object.entries(values)) formData.set(field, value)

    try {
      setState(onCodeStep
        ? await confirmRegistrationCode(state, formData)
        : await requestRegistrationCode(state, formData))
    } catch {
      setState({
        ...state,
        error: SUBMISSION_FAILURE_MESSAGE,
        errorField: null,
      })
    } finally {
      submissionInFlight.current = false
      setPending(false)
    }
  }

  if (state.step === "done") {
    const heading = {
      approved: "Approved.",
      new: "Registration received.",
      pending: "Already in review.",
      rejected: "Not approved.",
    }[state.standing ?? "new"]
    const body = {
      approved: "Your coach is setting up training. You’ll be able to sign in once onboarding is complete.",
      new: `Your coach will review this ${state.values.requestedRole === "coach" ? "assistant-coach" : "player"} request. You can check the status any time with this name and email.`,
      pending: `${state.values.fullName}’s request is already with your coach. Nothing new was created.`,
      rejected: "Please speak to your coach at the academy.",
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
        {state.academyId ? (
          <p className="registration-academy-id">
            <span>Academy ID</span>
            <strong>{state.academyId}</strong>
          </p>
        ) : null}
        {state.standing === "pending" ? (
          <p className="login-helper">
            Registering a different player? Go back and enter their full name.
          </p>
        ) : null}
        <Link href="/activate">View activation status</Link>
      </div>
    )
  }

  const onCodeStep = state.step === "code"
  const fieldError = (field: RegistrationFormState["errorField"]) =>
    state.errorField === field ? state.error : null

  return (
    <form className="login-form" method="post" onSubmit={(event) => void submit(event)} noValidate>
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
            take a minute to arrive — if nothing comes, go back and send again.
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
        <p id="registration-form-error" className="login-error" role="alert">{state.error}</p>
      ) : null}

      <button ref={submitButtonRef} className="login-submit" type="submit" disabled={pending}>
        <span>
          {pending
            ? onCodeStep ? "Verifying…" : "Sending code…"
            : onCodeStep ? "Verify" : "Send code"}
        </span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
