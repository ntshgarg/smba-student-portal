"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, type ReactNode } from "react"

const DATE_PAUSE_MS = 800
const SEARCH_PAUSE_MS = 400

/**
 * A date or month field is applied only once it holds a whole, plausible date
 * (Chrome reports 0002, 0020, 0202 while a year is typed) and a From/To pair
 * still runs forwards. Until then the page keeps what it shows.
 */
export function filterDatesReady(form: HTMLFormElement) {
  const fields = [...form.querySelectorAll<HTMLInputElement>('input[type="date"], input[type="month"]')]
  const plausible = fields.every((field) => {
    if (!field.value) return true
    const pattern = field.type === "month" ? /^(\d{4})-\d{2}$/u : /^(\d{4})-\d{2}-\d{2}$/u
    const year = Number(field.value.match(pattern)?.[1] ?? 0)
    return field.validity.valid && year >= 2000 && year <= 2099
  })
  const from = form.querySelector<HTMLInputElement>('input[name="from"]')?.value
  const to = form.querySelector<HTMLInputElement>('input[name="to"]')?.value
  return plausible && !(from && to && from > to)
}

/**
 * A filter form that applies itself, so there is no Apply button. A choice
 * applies at once and adds a step to history, like the tiles and month arrows
 * beside it; typing a search applies after a pause and replaces the step it is
 * refining; a date applies after a pause or on leaving the field, once it is
 * whole. It stays a plain GET form, so the address carries the filters.
 *
 * A pending search or date is dropped the moment the coach clicks a link (a
 * tile, an arrow, a chip), so it cannot land afterwards and undo that click.
 * Fields whose value can change from outside the form are keyed on it by the
 * caller, so they always show the address they belong to.
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
  const formRef = useRef<HTMLFormElement>(null)
  const pause = useRef<number | undefined>(undefined)
  const refocus = useRef<string | null>(null)

  useEffect(() => {
    const cancelPending = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("a[href]")) return
      window.clearTimeout(pause.current)
      pause.current = undefined
    }
    document.addEventListener("click", cancelPending, true)
    return () => {
      document.removeEventListener("click", cancelPending, true)
      window.clearTimeout(pause.current)
    }
  }, [])

  // A keyed field remounts after its own change applies; give it its focus back.
  useEffect(() => {
    const name = refocus.current
    const form = formRef.current
    if (!name || !form) return
    if (document.activeElement && document.activeElement !== document.body) return
    const field = form.elements.namedItem(name)
    if (field instanceof HTMLElement) {
      field.focus()
      refocus.current = null
    }
  })

  function apply(form: HTMLFormElement, { replace = false } = {}) {
    if (!filterDatesReady(form)) return
    const search = new URLSearchParams()
    new FormData(form).forEach((value, key) => {
      if (typeof value === "string" && value.trim()) search.set(key, value.trim())
    })
    const active = document.activeElement
    refocus.current = active instanceof HTMLInputElement || active instanceof HTMLSelectElement ? active.name : null
    const href = `${action}?${search.toString()}`
    if (replace) router.replace(href, { scroll: false })
    else router.push(href, { scroll: false })
  }

  function later(form: HTMLFormElement, wait: number, options?: { replace?: boolean }) {
    window.clearTimeout(pause.current)
    pause.current = window.setTimeout(() => {
      pause.current = undefined
      apply(form, options)
    }, wait)
  }

  return (
    <form
      ref={formRef}
      className={className}
      action={action}
      method="get"
      role="search"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault()
        window.clearTimeout(pause.current)
        pause.current = undefined
        apply(event.currentTarget)
      }}
      onChange={(event) => {
        const form = event.currentTarget
        const field = event.target
        if (field instanceof HTMLInputElement && field.type === "search") {
          later(form, SEARCH_PAUSE_MS, { replace: true })
        } else if (field instanceof HTMLInputElement && (field.type === "date" || field.type === "month")) {
          later(form, DATE_PAUSE_MS)
        } else {
          window.clearTimeout(pause.current)
          pause.current = undefined
          apply(form)
        }
      }}
      onBlur={(event) => {
        const field = event.target
        if (field instanceof HTMLInputElement && (field.type === "date" || field.type === "month")
          && pause.current !== undefined) {
          window.clearTimeout(pause.current)
          pause.current = undefined
          apply(event.currentTarget)
        }
      }}
    >
      {children}
    </form>
  )
}
