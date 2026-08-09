"use client"

import { useActionState, useEffect, useRef } from "react"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

import { loginWithAcademyId, type LoginFormState } from "@/app/login/actions"

const initialLoginFormState: LoginFormState = { error: null }

export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    loginWithAcademyId,
    initialLoginFormState,
  )
  const academyIdRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.error) academyIdRef.current?.focus()
  }, [state])

  return (
    <form className="login-form" action={formAction} noValidate>
      <div className="login-field">
        <label htmlFor="academy-id">Academy ID</label>
        <input
          ref={academyIdRef}
          id="academy-id"
          name="academyId"
          type="text"
          autoComplete="username"
          inputMode="text"
          maxLength={9}
          required
          aria-describedby={state.error ? "academy-id-error" : "academy-id-help"}
          aria-invalid={state.error ? true : undefined}
          placeholder="SMBA#0001"
        />
        {state.error ? (
          <p id="academy-id-error" className="login-error" role="alert">{state.error}</p>
        ) : (
          <p id="academy-id-help" className="login-helper">Use the ID shared by your coach.</p>
        )}
      </div>

      <button className="login-submit" type="submit" disabled={pending}>
        <span>{pending ? "Opening your portal…" : "Continue"}</span>
        <ArrowRight aria-hidden="true" />
      </button>

      <p className="login-register-link">
        New to the portal? <Link href="/register">Request registration</Link>
      </p>
    </form>
  )
}
