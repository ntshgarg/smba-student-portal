import { LogOut } from "lucide-react"

import { clearSession } from "@/app/login/actions"

/**
 * The way off a forced-enrollment interstitial.
 *
 * These three pages -- /account/recovery-email/setup, /auth/pin/setup and
 * /auth/two-factor/setup -- are redirect targets, not destinations: the coach,
 * player and admin layouts bounce into them and every other route stays shut
 * until the credential exists. Their only link was the SMBA logo, which leads
 * to the marketing homepage and, still signed in, straight back through the
 * same redirect. So a coach who cannot finish enrolment -- a blocked mailbox, a
 * phone with no authenticator app -- had no way to hand the device to a coach
 * who can, courtside, while the session runs.
 *
 * `clearSession` is the same server action the portal account menu submits, and
 * it clears a session Better Auth has not yet promoted past a second factor as
 * readily as a complete one. The menu itself does not fit here: it is a header
 * chip whose 260px panel is absolutely positioned under a `.portal-header` that
 * an interstitial has none of, and it is built from a `SessionIdentity` --
 * full name and initials -- that /auth/two-factor/setup deliberately does not
 * read, because `getCurrentIdentity` returns null until the factor is
 * connected. What is worth reusing is the action, not the chrome, so this
 * borrows the `.login-back` affordance the other authentication cards already
 * close with -- /login, /register, /activate, /recover and both authenticator
 * pages. That class has carried anchors until now and declares no button
 * reset, which it does not need: Tailwind's Preflight, the whole of what
 * `@import "tailwindcss"` contributes at app/globals.css:1, already zeroes
 * `border` and `background-color` for `button`, so the submit renders as the
 * same quiet 44px steel line.
 */
export function InterstitialSignOut() {
  return (
    <form action={clearSession}>
      <button className="login-back" type="submit">
        <LogOut aria-hidden="true" />
        Sign out
      </button>
    </form>
  )
}
