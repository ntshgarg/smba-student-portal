"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { LogOut } from "lucide-react"

import { clearSession } from "@/app/login/actions"
import { usePresence } from "@/components/motion/use-presence"
import { clearAttendanceDrafts } from "@/lib/client/attendance-draft-storage"

type AccountIdentity = {
  fullName: string
  firstName: string
  initials: string
}

export function AccountMenu({
  account,
  previewMode = false,
  publicSiteHref,
}: {
  account: AccountIdentity
  // During a preview, Log out goes through Exit preview, the one allowed form.
  previewMode?: boolean
  publicSiteHref: string
}) {
  const [open, setOpen] = useState(false)
  const menu = usePresence(open)
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

      {menu.mounted ? (
        <div
          id="portal-account-menu"
          className="account-menu"
          data-state={menu.state}
          inert={!open}
        >
          <p>
            <span>{previewMode ? "Previewing as" : "Signed in as"}</span>
            <strong>{account.fullName}</strong>
          </p>
          <Link href={publicSiteHref} onClick={() => setOpen(false)}>
            Return to academy
          </Link>
          {previewMode ? null : (
            <Link href="/account/security" onClick={() => setOpen(false)}>
              Account security
            </Link>
          )}
          {previewMode ? (
            <form action="/admin/preview/exit" method="post" onSubmit={() => clearAttendanceDrafts()}>
              <input type="hidden" name="signOut" value="1" />
              <button type="submit">
                Exit preview and log out
                <LogOut aria-hidden="true" />
              </button>
            </form>
          ) : (
            // Unsaved attendance marks stay on the device for whoever made
            // them; signing out hands the device on, so they go with the session.
            <form
              action={clearSession}
              data-unsaved-work-navigation="true"
              onSubmit={() => clearAttendanceDrafts()}
            >
              <button type="submit">
                Log out
                <LogOut aria-hidden="true" />
              </button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  )
}
