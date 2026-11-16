"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, type ReactNode } from "react"

/**
 * A filter form that applies itself: a choice applies at once and typing applies
 * after a pause, so there is no Apply button. It stays a plain GET form, so the
 * address carries the filters as before.
 */
export function FilterForm({
  action,
  children,
  className,
  label,
}: {
  action: string
  children: ReactNode
  className?: string
  label: string
}) {
  const router = useRouter()
  const pause = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(pause.current), [])

  function apply(form: HTMLFormElement) {
    const search = new URLSearchParams()
    new FormData(form).forEach((value, key) => {
      if (typeof value === "string" && value.trim()) search.set(key, value.trim())
    })
    router.replace(`${action}?${search.toString()}`, { scroll: false })
  }

  return (
    <form
      className={className}
      action={action}
      method="get"
      role="search"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault()
        window.clearTimeout(pause.current)
        apply(event.currentTarget)
      }}
      onChange={(event) => {
        const form = event.currentTarget
        window.clearTimeout(pause.current)
        if (event.target instanceof HTMLInputElement && event.target.type === "search") {
          pause.current = window.setTimeout(() => apply(form), 400)
        } else {
          apply(form)
        }
      }}
    >
      {children}
    </form>
  )
}
