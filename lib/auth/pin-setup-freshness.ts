import "server-only"

import { headers } from "next/headers"

import { getAuth } from "@/lib/auth/better-auth"

/*
 * How fresh a session has to be to mint a first PIN.
 *
 * A PIN is a complete sign-in factor, and the setup action asks for no
 * password. The only thing that made that defensible was that it refuses when a
 * PIN already exists -- so a thief holding a stolen cookie could not replace
 * one. That is thin, and it broke the moment another action removed a PIN on a
 * session-only gate: the thief deleted the victim's and minted their own, and it
 * signed in from a client with no cookie and no password.
 *
 * The two paths that legitimately reach the setup form -- activation, and
 * recovery -- both arrive seconds after a credential was proved. An old cookie
 * does not.
 */
export const PIN_SETUP_SESSION_MAX_AGE_MS = 15 * 60 * 1000

/**
 * Whether this request's sign-in is recent enough to set a first PIN.
 *
 * Shared by the setup action, which enforces it, and the setup page, which
 * otherwise offered a form the action would always refuse -- with no Skip for a
 * head coach, that left them stuck on it.
 *
 * Computed so that anything unexpected refuses. The first version subtracted an
 * unparseable date and got NaN, and `NaN > MAX_AGE` is false -- so a control
 * whose entire job is to say no degraded to "yes" on bad input.
 */
export async function sessionFreshEnoughForPinSetup(now = Date.now()) {
  let session: Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>> | null
  try {
    session = await getAuth().api.getSession({ headers: await headers() })
  } catch {
    session = null
  }
  const createdAt = session?.session?.createdAt
    ? new Date(session.session.createdAt).getTime()
    : Number.NaN
  const sessionAge = now - createdAt
  return Number.isFinite(sessionAge)
    && sessionAge >= 0
    && sessionAge <= PIN_SETUP_SESSION_MAX_AGE_MS
}
