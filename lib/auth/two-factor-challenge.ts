import "server-only"

import { getAuth } from "@/lib/auth/better-auth"

/*
 * Every value the request carries under one cookie name, read leniently: names
 * and values trimmed, surrounding quotes dropped, percent-decoded. Lenient on
 * purpose -- Next's cookie parser and the one Better Auth verifies with disagree
 * about duplicates, padding and quotes, so reading the challenge with either
 * parser alone let a crafted Cookie header show this code one value (or none)
 * while Better Auth checked another. Collecting every candidate and accepting
 * only exactly one leaves nothing for the two to disagree about.
 */
function cookieValues(cookieHeader: string | null, name: string) {
  const values: string[] = []
  for (const pair of (cookieHeader ?? "").split(";")) {
    const separator = pair.indexOf("=")
    if (separator === -1 || pair.slice(0, separator).trim() !== name) continue
    let value = pair.slice(separator + 1).trim()
    if (value.startsWith("\"")) value = value.slice(1, -1)
    try {
      values.push(decodeURIComponent(value))
    } catch {
      values.push(value)
    }
  }
  return values
}

// The account a half-finished sign-in is waiting on, from the challenge cookie; null if none or ambiguous.
// Kept out of "use server" so it is never a public endpoint.
export async function challengedAccountId(requestHeaders: Pick<Headers, "get">) {
  try {
    const authContext = await getAuth().$context
    const name = authContext.createAuthCookie("two_factor").name
    const values = cookieValues(requestHeaders.get("cookie"), name)
    if (values.length !== 1) return null
    const signatureStart = values[0]!.lastIndexOf(".")
    if (signatureStart < 1) return null
    const challenge = await authContext.internalAdapter
      .findVerificationValue(values[0]!.slice(0, signatureStart))
    if (!challenge || challenge.expiresAt <= new Date()) return null
    return challenge.value
  } catch {
    return null
  }
}

// Whether the half-finished sign-in began with a PIN. Better Auth skips the code for a
// trusted device on a password sign-in only, so a PIN one is always asked for it.
export async function challengeStartedWithPin(requestHeaders: Pick<Headers, "get">) {
  try {
    const authContext = await getAuth().$context
    const name = authContext.createAuthCookie("two_factor").name
    const values = cookieValues(requestHeaders.get("cookie"), name)
    return values.length === 1 && values[0]!.startsWith("2fa-pin-")
  } catch {
    return false
  }
}
