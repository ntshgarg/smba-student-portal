"use client"

import { useActionState, useEffect, useRef } from "react"
import { ArrowRight } from "lucide-react"

import { activateAccount, type ActivationFormState } from "@/app/login/actions"
import { PasswordInput } from "@/components/password-input"

const initialState: ActivationFormState = { error: null, errorField: null }

export function ActivationForm({ academyId }: { academyId: string }) {
  const [state, formAction, pending] = useActionState(activateAccount, initialState)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.errorField === "password") passwordRef.current?.focus()
    else if (state.errorField === "confirmPassword") confirmPasswordRef.current?.focus()
  }, [state])

  const errorId = state.error ? "activation-error" : undefined
  return (
    <form className="login-form" action={formAction} noValidate>
      <div className="login-field">
        <label htmlFor="activation-academy-id">Academy ID</label>
          <input id="activation-academy-id" name="academyId" value={academyId} readOnly />
      </div>
      <div className="login-field">
        <label htmlFor="activation-password">Create password</label>
        <PasswordInput
          ref={passwordRef}
          id="activation-password"
          name="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          aria-describedby={errorId ?? "activation-password-help"}
          aria-invalid={state.errorField === "password" ? true : undefined}
        />
        {!state.error ? (
          <p id="activation-password-help" className="login-helper">
            Use at least 12 characters. Spaces and password managers are supported.
          </p>
        ) : null}
      </div>
      <div className="login-field">
        <label htmlFor="activation-password-confirmation">Confirm password</label>
        <PasswordInput
          ref={confirmPasswordRef}
          id="activation-password-confirmation"
          name="confirmPassword"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          aria-describedby={errorId}
          aria-invalid={state.errorField === "confirmPassword" ? true : undefined}
        />
      </div>
      {state.error ? <p id="activation-error" className="login-error" role="alert">{state.error}</p> : null}
      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Securing your account…" : "Continue"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
