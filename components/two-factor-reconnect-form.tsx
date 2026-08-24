"use client"

import { useEffect, useRef } from "react"
import { ArrowRight } from "lucide-react"

import {
  beginAuthenticatorReconnect,
  type TotpReconnectState,
} from "@/app/auth/two-factor/actions"
import { PasswordInput } from "@/components/password-input"
import { useResilientActionState } from "@/lib/client/use-resilient-action-state"

const initialState: TotpReconnectState = { error: null, errorField: null }

export function TwoFactorReconnectForm() {
  const [state, formAction, pending] = useResilientActionState(
    beginAuthenticatorReconnect,
    initialState,
    {
      // Neither credential was rejected, so neither field is marked invalid.
      fold: (state, error) => ({ ...state, error, errorField: null }),
      retained: "Your current authenticator and recovery codes still work",
      subject: "Your authenticator reconnect",
    },
  )
  const passwordRef = useRef<HTMLInputElement>(null)
  const factorRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.errorField === "password") passwordRef.current?.focus()
    if (state.errorField === "secondFactor") factorRef.current?.focus()
  }, [state])

  return (
    <form className="login-form" action={formAction} noValidate>
      <div className="login-field">
        <label htmlFor="reconnect-password">Current password</label>
        <PasswordInput
          ref={passwordRef}
          id="reconnect-password"
          name="password"
          autoComplete="current-password"
          required
          aria-invalid={state.errorField === "password" ? true : undefined}
        />
      </div>
      <div className="login-field">
        <label htmlFor="reconnect-second-factor">Authenticator or recovery code</label>
        <input
          ref={factorRef}
          id="reconnect-second-factor"
          name="secondFactor"
          type="text"
          autoComplete="one-time-code"
          required
          aria-describedby="reconnect-factor-help"
          aria-invalid={state.errorField === "secondFactor" ? true : undefined}
        />
        <p id="reconnect-factor-help" className="login-helper">
          If the app entry was deleted, use one of the recovery codes saved during setup.
          If neither is available, secure support recovery is required.
        </p>
      </div>
      {state.error ? <p className="login-error" role="alert">{state.error}</p> : null}
      <aside className="totp-reconnect-note">
        Your old authenticator connection and recovery codes will stop working. Other signed-in devices will be logged out.
      </aside>
      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Checking security…" : "Reconnect authenticator"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}
