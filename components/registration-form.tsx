"use client"

import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import { ArrowRight, Check } from "lucide-react"
import Link from "next/link"

import {
  submitRegistration,
  type RegistrationFormState,
} from "@/app/login/actions"

const initialState: RegistrationFormState = {
  error: null,
  errorField: null,
  submitted: false,
}

const SUBMISSION_FAILURE_MESSAGE =
  "We couldn’t send your request. Your name is still here—please try again."

export function RegistrationForm() {
  const [state, setState] = useState(initialState)
  const [fullName, setFullName] = useState("")
  const [pending, setPending] = useState(false)
  const fullNameRef = useRef<HTMLInputElement>(null)
  const registrationRequestKey = useRef<string | null>(null)
  const submitButtonRef = useRef<HTMLButtonElement>(null)
  const submissionInFlight = useRef(false)

  useEffect(() => {
    if (state.error && state.errorField === "fullName") fullNameRef.current?.focus()
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
    setState(initialState)
    const formData = new FormData(event.currentTarget)
    registrationRequestKey.current ??= window.crypto.randomUUID()
    formData.set("registrationRequestKey", registrationRequestKey.current)

    try {
      setState(await submitRegistration(initialState, formData))
    } catch {
      setState({
        error: SUBMISSION_FAILURE_MESSAGE,
        errorField: null,
        submitted: false,
      })
    } finally {
      submissionInFlight.current = false
      setPending(false)
    }
  }

  if (state.submitted) {
    return (
      <div className="registration-confirmation" role="status">
        <span><Check aria-hidden="true" /></span>
        <h2>Registration received.</h2>
        <p>Your coach will review the request and share your Academy ID after approval.</p>
        <Link href="/login">Return to login</Link>
      </div>
    )
  }

  const fullNameError = state.errorField === "fullName" ? state.error : null
  const formError = state.errorField === null ? state.error : null

  return (
    <form className="login-form" method="post" onSubmit={(event) => void submit(event)} noValidate>
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
          aria-describedby={fullNameError ? "full-name-error" : undefined}
          aria-invalid={fullNameError ? true : undefined}
          disabled={pending}
          placeholder="Enter your full name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />
      </div>

      {fullNameError ? (
        <p id="full-name-error" className="login-error" role="alert">{fullNameError}</p>
      ) : null}
      {formError ? (
        <p id="registration-form-error" className="login-error" role="alert">{formError}</p>
      ) : null}

      <button ref={submitButtonRef} className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Sending request…" : "Request registration"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
