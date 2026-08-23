"use client"

import { useActionState, useEffect, useRef } from "react"
import { ArrowRight } from "lucide-react"

import { AuthField } from "@/components/auth-field"

import {
  setupPinAction,
  skipPinSetupAction,
  type PinSetupState,
} from "@/app/auth/pin/actions"

const initialState: PinSetupState = { error: null, errorField: null }
const pinSetupErrorId = "pin-setup-error"

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
        <AuthField
          id="setup-pin"
          label="Enter PIN"
          errorId={state.error && state.errorField === "pin" ? pinSetupErrorId : undefined}
        >
          {(control) => (
            <input
              {...control}
              ref={pinRef}
              className="login-pin-input"
              name="pin"
              type="password"
              autoComplete="new-password"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
            />
          )}
        </AuthField>
        <AuthField
          id="confirm-pin"
          label="Confirm PIN"
          errorId={state.error && state.errorField === "confirmPin" ? pinSetupErrorId : undefined}
        >
          {(control) => (
            <input
              {...control}
              ref={confirmPinRef}
              className="login-pin-input"
              name="confirmPin"
              type="password"
              autoComplete="new-password"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
            />
          )}
        </AuthField>
        {state.error ? <p id={pinSetupErrorId} className="login-error" role="alert">{state.error}</p> : null}
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
