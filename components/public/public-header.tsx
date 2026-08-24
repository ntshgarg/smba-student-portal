"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { ArrowRight, ChevronRight, Menu, X } from "lucide-react"

import { clearSession } from "@/app/login/actions"
import type { SessionSummaryResponse } from "@/lib/auth/session-summary"

const navItems = [
  { label: "Academy", href: "#academy" },
  { label: "Programs", href: "#programs" },
  { label: "Why SMBA", href: "#why-smba" },
  { label: "Contact", href: "#contact" },
] as const

const portalLoginHref = "/login"

export type HeaderAccount = {
  name: string
  initials: string
  dashboardHref: string
  dashboardLabel: string
}

function accountFromSessionSummary(value: unknown): HeaderAccount | null {
  if (!value || typeof value !== "object") return null

  const summary = value as Partial<SessionSummaryResponse>
  if (summary.status !== "authenticated" || !summary.account) return null

  const { name, initials, role } = summary.account
  if (
    typeof name !== "string"
    || !name.trim()
    || typeof initials !== "string"
    || !initials.trim()
    || (role !== "coach" && role !== "player")
  ) return null

  return {
    name,
    initials,
    dashboardHref: role === "coach" ? "/coach" : "/player",
    dashboardLabel: role === "coach" ? "Coach Workspace" : "Player Journal",
  }
}

export function Header({ homePath = "" }: { homePath?: "" | "/" }) {
  const [account, setAccount] = useState<HeaderAccount | null>(null)
  const [open, setOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const accountButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function resolveAccount() {
      try {
        const response = await fetch("/api/session-summary", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        })
        if (!response.ok) return

        const resolvedAccount = accountFromSessionSummary(await response.json())
        if (!controller.signal.aborted && resolvedAccount) setAccount(resolvedAccount)
      } catch {
        // Login is the deliberate fallback when the display-only summary is unavailable.
      }
    }

    void resolveAccount()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    function closeMenus(event: KeyboardEvent) {
      if (event.key !== "Escape" || (!open && !accountOpen)) return

      setOpen(false)
      setAccountOpen(false)

      if (accountOpen) accountButtonRef.current?.focus()
      else menuButtonRef.current?.focus()
    }

    function closeOnOutsidePress(event: PointerEvent) {
      if (headerRef.current?.contains(event.target as Node)) return
      setOpen(false)
      setAccountOpen(false)
    }

    document.addEventListener("keydown", closeMenus)
    document.addEventListener("pointerdown", closeOnOutsidePress)

    return () => {
      document.removeEventListener("keydown", closeMenus)
      document.removeEventListener("pointerdown", closeOnOutsidePress)
    }
  }, [accountOpen, open])

  return (
    <>
      <header ref={headerRef} className="site-header">
        <a className="brand-link" href={homePath || "#top"}>
          <Image
            src="/images/smba-logo.png"
            alt="Sathiya Moorthy Badminton Academy"
            width={720}
            height={488}
            sizes="(max-width: 640px) 98px, 112px"
            priority
          />
        </a>

        <nav className="desktop-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <a key={item.href} href={`${homePath}${item.href}`}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="header-actions">
          <div className="header-account-slot">
            {account ? (
              <>
                <button
                  ref={accountButtonRef}
                  className="header-account-button"
                  type="button"
                  aria-expanded={accountOpen}
                  aria-controls={accountOpen ? "header-account-menu" : undefined}
                  aria-label={`${accountOpen ? "Close" : "Open"} account menu for ${account.name}`}
                  onClick={() => {
                    setOpen(false)
                    setAccountOpen((value) => !value)
                  }}
                >
                  <span aria-hidden="true">{account.initials}</span>
                </button>

                {accountOpen ? (
                  <nav
                    id="header-account-menu"
                    className="header-account-menu"
                    aria-label="Account navigation"
                  >
                    <p>
                      <span>Account</span>
                      <strong>{account.name}</strong>
                    </p>
                    <a href={account.dashboardHref} onClick={() => setAccountOpen(false)}>
                      {account.dashboardLabel}
                    </a>
                    <form action={clearSession}>
                      <button
                        className="header-account-signout"
                        type="submit"
                      >
                        Sign out
                      </button>
                    </form>
                  </nav>
                ) : null}
              </>
            ) : (
              <a className="header-login" href={portalLoginHref}>
                Log in
              </a>
            )}
          </div>

          <a className="header-cta" href={`${homePath}#trial`}>
            Book a free trial
            <ArrowRight aria-hidden="true" />
          </a>
        </div>

        <button
          ref={menuButtonRef}
          className="menu-button"
          type="button"
          aria-expanded={open}
          aria-controls={open ? "mobile-navigation" : undefined}
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => {
            setAccountOpen(false)
            setOpen((value) => !value)
          }}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>

        {open ? (
          <nav id="mobile-navigation" className="mobile-nav" aria-label="Mobile navigation">
            {navItems.map((item) => (
              <a key={item.href} href={`${homePath}${item.href}`} onClick={() => setOpen(false)}>
                {item.label}
                <ChevronRight aria-hidden="true" />
              </a>
            ))}
              <a className="mobile-nav-cta" href={`${homePath}#trial`} onClick={() => setOpen(false)}>
              Book a free trial
            </a>
          </nav>
        ) : null}
      </header>

      {open ? <div className="mobile-nav-overlay" aria-hidden="true" /> : null}
    </>
  )
}
