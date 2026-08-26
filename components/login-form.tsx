"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

import { PasswordInput } from "@/components/password-input"
import { useResilientActionState } from "@/lib/client/use-resilient-action-state"

import {
  loginWithAcademyId,
  loginWithPin,
  type LoginFormState,
} from "@/app/login/actions"

const initialState: LoginFormState = { error: null }

const signInFailureCopy = {
  retained: "Nothing was sent and you are still signed out",
  subject: "Your sign-in",
}

/** The Academy ID is owned by `LoginForm`, not by either method's form. */
type AcademyIdCarrier = {
  academyId: string
  onAcademyIdChange: (value: string) => void
}

/**
 * The Academy ID survives both a failed submit and a switch between the two
 * login methods, and it does so through `defaultValue` rather than `value`.
 *
 * Two mechanisms erase an uncontrolled field here. React resets a form once its
 * action settles, so a refused sign-in returns every control to its default --
 * correct for the password, wrong for the identifier the user just typed. And
 * `PasswordLoginForm` and `PinLoginForm` are distinct component types rendered
 * at one slot, so toggling the method unmounts one subtree and mounts the
 * other rather than reconciling them.
 *
 * Holding the value in `LoginForm` and feeding it back as `defaultValue`
 * answers both: the reset restores the attribute React has been keeping current
 * from `onChange`, and the newly mounted form mounts with it already in place.
 * Deliberately not a controlled input -- this field carries
 * `autoComplete="username"`, and forcing `value` back on every render fights a
 * password manager filling it.
 */
function AcademyIdField({
  academyIdRef,
  defaultValue,
  error,
  onValueChange,
}: {
  academyIdRef: React.RefObject<HTMLInputElement | null>
  defaultValue: string
  error: string | null
  onValueChange: (value: string) => void
}) {
  return (
    <div className="login-field">
      <label htmlFor="academy-id">SMBA username</label>
      <input
        ref={academyIdRef}
        id="academy-id"
        name="academyId"
        type="text"
        autoComplete="username"
        inputMode="text"
        maxLength={15}
        required
        aria-describedby={error ? "academy-id-error" : "academy-id-help"}
        aria-invalid={error ? true : undefined}
        placeholder="SMBA-HC-0001"
        defaultValue={defaultValue}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {error ? (
        <p id="academy-id-error" className="login-error" role="alert">{error}</p>
      ) : (
        <p id="academy-id-help" className="login-helper">Use your permanent SMBA username.</p>
      )}
    </div>
  )
}

function PasswordLoginForm({ academyId, onAcademyIdChange }: AcademyIdCarrier) {
  const [state, formAction, pending] = useResilientActionState(
    loginWithAcademyId,
    initialState,
    signInFailureCopy,
  )
  const academyIdRef = useRef<HTMLInputElement>(null)
  const submissionStartedRef = useRef(false)
  useEffect(() => {
    if (pending) {
      submissionStartedRef.current = true
      return
    }
    if (!submissionStartedRef.current || !state.error) return
    submissionStartedRef.current = false
    const timeout = window.setTimeout(() => academyIdRef.current?.focus(), 0)
    return () => window.clearTimeout(timeout)
  }, [pending, state])
  return (
    <form className="login-form" action={formAction} noValidate>
      <AcademyIdField
        academyIdRef={academyIdRef}
        defaultValue={academyId}
        error={state.error}
        onValueChange={onAcademyIdChange}
      />
      <div className="login-field">
        <label htmlFor="password">Password</label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          maxLength={128}
          required
          aria-describedby="password-help"
        />
        <p id="password-help" className="login-helper">Passwords are case-sensitive.</p>
      </div>
      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Opening your portal…" : "Continue"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}

function PinLoginForm({ academyId, onAcademyIdChange }: AcademyIdCarrier) {
  const [state, formAction, pending] = useResilientActionState(
    loginWithPin,
    initialState,
    signInFailureCopy,
  )
  const academyIdRef = useRef<HTMLInputElement>(null)
  const submissionStartedRef = useRef(false)
  useEffect(() => {
    if (pending) {
      submissionStartedRef.current = true
      return
    }
    if (!submissionStartedRef.current || !state.error) return
    submissionStartedRef.current = false
    const timeout = window.setTimeout(() => academyIdRef.current?.focus(), 0)
    return () => window.clearTimeout(timeout)
  }, [pending, state])
  return (
    <form className="login-form" action={formAction} noValidate>
      <AcademyIdField
        academyIdRef={academyIdRef}
        defaultValue={academyId}
        error={state.error}
        onValueChange={onAcademyIdChange}
      />
      <div className="login-field">
        <label htmlFor="pin">6-digit PIN</label>
        <input
          className="login-pin-input"
          id="pin"
          name="pin"
          type="password"
          autoComplete="off"
          inputMode="numeric"
          pattern="[0-9]{6}"
          minLength={6}
          maxLength={6}
          required
          aria-describedby="pin-help"
        />
        <p id="pin-help" className="login-helper">Forgot your PIN? Use your password instead.</p>
      </div>
      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Opening your portal…" : "Continue"}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  )
}

export function LoginForm() {
  const [method, setMethod] = useState<"password" | "pin">("password")
  const [academyId, setAcademyId] = useState("")
  return (
    <>
      <div className="login-method-switch" role="group" aria-label="Login method">
        <button
          type="button"
          aria-pressed={method === "password"}
          onClick={() => setMethod("password")}
        >
          Password
        </button>
        <button
          type="button"
          aria-pressed={method === "pin"}
          onClick={() => setMethod("pin")}
        >
          6-digit PIN
        </button>
      </div>
      {method === "password"
        ? <PasswordLoginForm academyId={academyId} onAcademyIdChange={setAcademyId} />
        : <PinLoginForm academyId={academyId} onAcademyIdChange={setAcademyId} />}
      <nav className="login-register-link" aria-label="Account access">
        <span className="login-register-prompt">First visit?</span>
        <Link href="/activate">Activate your account</Link>
        <span className="login-register-separator" aria-hidden="true"> · </span>
        <Link href="/register">Request registration</Link>
        <span className="login-register-separator" aria-hidden="true"> · </span>
        <Link href="/recover">Forgot password?</Link>
      </nav>
    </>
  )
}
