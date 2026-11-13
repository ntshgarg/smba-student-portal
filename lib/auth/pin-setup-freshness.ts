import "server-only"

import { headers } from "next/headers"

import { getAuth } from "@/lib/auth/better-auth"

// A PIN is minted without a password, so only a sign-in that just proved a credential may set one.
export const PIN_SETUP_SESSION_MAX_AGE_MS = 15 * 60 * 1000

/** Whether this sign-in is recent enough to set a first PIN. Anything unexpected (NaN) refuses. */
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
