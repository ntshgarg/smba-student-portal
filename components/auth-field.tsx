"use client"

import { useId, type ReactNode } from "react"

type AuthFieldControl = {
  "aria-describedby": string | undefined
  "aria-invalid": true | undefined
  id: string
}

export function AuthField({
  children,
  error = null,
  errorId,
  helper,
  id,
  label,
}: {
  children: (control: AuthFieldControl) => ReactNode
  error?: string | null
  // Names an alert this field shares with the rest of its form. Pass it only
  // while that element is rendered, or aria-describedby would dangle.
  errorId?: string
  helper?: ReactNode
  id?: string
  label: ReactNode
}) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const ownErrorId = `${fieldId}-error`
  const helperId = `${fieldId}-help`
  const ownMessageId = error ? ownErrorId : helper ? helperId : undefined
  const describedBy = [errorId, ownMessageId].filter(Boolean).join(" ")

  return (
    <div className="login-field">
      <label htmlFor={fieldId}>{label}</label>
      {children({
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error || errorId ? true : undefined,
        id: fieldId,
      })}
      {error ? (
        <p id={ownErrorId} className="login-error" role="alert">{error}</p>
      ) : helper ? (
        <p id={helperId} className="login-helper">{helper}</p>
      ) : null}
    </div>
  )
}
