"use client"

import { forwardRef, useId, useState, type ComponentPropsWithoutRef } from "react"
import { Eye, EyeOff } from "lucide-react"

type PasswordInputProps = Omit<ComponentPropsWithoutRef<"input">, "type">

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ id, name, ...props }, ref) {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const [visible, setVisible] = useState(false)
    const action = visible ? "Hide" : "Show"
    const accessibleAction = visible ? "Mask entered characters" : "Reveal entered characters"

    return (
      <div className="password-input-shell">
        <input
          {...props}
          ref={ref}
          id={inputId}
          name={name}
          type={visible ? "text" : "password"}
        />
        <button
          className="password-visibility-toggle"
          type="button"
          aria-controls={inputId}
          aria-label={accessibleAction}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          <span>{action}</span>
        </button>
      </div>
    )
  },
)
