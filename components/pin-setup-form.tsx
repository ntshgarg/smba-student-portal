"use client"

import { useActionState, useEffect, useRef } from "react"
import { ArrowRight } from "lucide-react"

import {
  setupPinAction,
  skipPinSetupAction,
  type PinSetupState,
} from "@/app/auth/pin/actions"

const initialState: PinSetupState = { error: null, errorField: null }

export function PinSetupForm({ allowSkip = true }: { allowSkip?: boolean }) {
  const [state, formAction, pending] = useActionState(setupPinAction, initialState)
  const pinRef = useRef<HTMLInputElement>(null)
  const confirmPinRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (state.errorField === "pin") pinRef.current?.focus()
    else if (state.errorField === "confirmPin") confirmPinRef.current?.focus()
  }, [state])
  return (
    <div className="pin-setup">
      <form className="login-form" action={formAction} noValidate>
        <div className="login-field">
          <label htmlFor="setup-pin">Enter PIN</label>
          <input
            ref={pinRef}
            className="login-pin-input"
            id="setup-pin"
            name="pin"
            type="password"
            autoComplete="new-password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            aria-invalid={state.errorField === "pin" ? true : undefined}
          />
        </div>
        <div className="login-field">
          <label htmlFor="confirm-pin">Confirm PIN</label>
          <input
            ref={confirmPinRef}
            className="login-pin-input"
            id="confirm-pin"
            name="confirmPin"
            type="password"
            autoComplete="new-password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            aria-invalid={state.errorField === "confirmPin" ? true : undefined}
          />
        </div>
        {state.error ? <p className="login-error" role="alert">{state.error}</p> : null}
        <div className="pin-setup-actions">
          <button className="login-submit" type="submit" disabled={pending}>
            <span>{pending ? "Saving PIN…" : "Set up PIN"}</span>
            <ArrowRight aria-hidden="true" />
          </button>
          {allowSkip ? (
            <button className="login-secondary" type="submit" formAction={skipPinSetupAction}>
              Skip for now
            </button>
          ) : null}
        </div>
      </form>
      <p className="login-helper">{allowSkip
        ? "You can add or remove a PIN later in Account security."
        : "The head-coach account requires both password and PIN recovery options."}</p>
    </div>
  )
}
