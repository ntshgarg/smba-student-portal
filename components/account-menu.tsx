"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { LogOut } from "lucide-react"

import { clearSession } from "@/app/login/actions"
type AccountIdentity = {
  fullName: string
  firstName: string
  initials: string
}

export function AccountMenu({
  account,
  publicSiteHref,
}: {
  account: AccountIdentity
  publicSiteHref: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !open) return
      setOpen(false)
      buttonRef.current?.focus()
    }

    function handleOutsidePress(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }

    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("pointerdown", handleOutsidePress)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("pointerdown", handleOutsidePress)
    }
  }, [open])

  return (
    <div ref={rootRef} className="account-menu-root">
      <button
        ref={buttonRef}
        className="profile-chip"
        type="button"
        aria-expanded={open}
        aria-controls={open ? "portal-account-menu" : undefined}
        aria-label={`${open ? "Close" : "Open"} account menu for ${account.fullName}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{account.initials}</span>
        <div>
          <strong>{account.firstName}</strong>
        </div>
      </button>

      {open ? (
        <div id="portal-account-menu" className="account-menu">
          <p>
            <span>Signed in as</span>
            <strong>{account.fullName}</strong>
          </p>
          <Link href={publicSiteHref} onClick={() => setOpen(false)}>
            Return to academy
          </Link>
          <form action={clearSession} data-unsaved-work-navigation="true">
            <button type="submit">
              Log out
              <LogOut aria-hidden="true" />
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
