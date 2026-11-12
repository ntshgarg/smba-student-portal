"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { LogOut } from "lucide-react"

import { clearSession } from "@/app/login/actions"
import { usePresence } from "@/components/motion/use-presence"

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
  /*
   * The platform owner is looking at this person's dashboard. Their account
   * security is not the owner's to open, and every form except Exit preview is
   * switched off, so Log out goes out through the preview's own exit and signs
   * the owner out from there.
   */
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
            {/* During a preview the name is the person being viewed, while
                the sign-in -- and so Log out -- is the owner's. */}
            <span>{previewMode ? "Viewing as" : "Signed in as"}</span>
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
            <form action="/admin/preview/exit" method="post">
              <input type="hidden" name="signOut" value="1" />
              <button type="submit">
                Exit preview and log out
                <LogOut aria-hidden="true" />
              </button>
            </form>
          ) : (
            <form action={clearSession} data-unsaved-work-navigation="true">
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
