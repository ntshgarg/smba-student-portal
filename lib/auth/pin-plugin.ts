import "server-only"

import { randomBytes } from "node:crypto"

import { createHMAC } from "@better-auth/utils/hmac"
import { createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { z } from "zod"

import { ACADEMY_ID_LABEL, normalizeAcademyId } from "@/lib/auth/identity"
import { findApprovedAccountByAcademyId } from "@/lib/auth/account-service"
import {
  releaseLoginAttempt,
  removePinCredential,
  reserveLoginAttempt,
  validateNewPin,
  verifyPinLogin,
} from "@/lib/auth/credential-service"
import {
  authSubjectHash,
  requestSecurityContext,
  writeAuthSecurityEvent,
} from "@/lib/auth/security-context"

const INVALID_PIN_LOGIN = `${ACADEMY_ID_LABEL} or PIN is incorrect.`
const RATE_LIMITED_PIN_LOGIN =
  "We couldn\u2019t sign you in. Wait a few minutes before trying again."
export const RETIRED_PIN_LOGIN =
  "Your PIN was too easy to guess, so we have switched it off to protect your account. "
  + "Sign in with your password, then choose a new PIN in Account security."

const pinLoginBody = z.object({
  pin: z.string(),
  username: z.string(),
})

export function smbaPinLogin() {
  return {
    id: "smba-pin-login",
    endpoints: {
      signInPin: createAuthEndpoint("/sign-in/pin", {
        body: pinLoginBody,
        method: "POST",
      }, async (context) => {
        const username = normalizeAcademyId(context.body.username)

        // The account/IP lockout lives here rather than in the caller because
        // this endpoint has two of them. `loginWithPin` in app/login/actions.ts
        // reaches it through `auth.api.signInPin`, but the plugin also mounts it
        // at POST /api/auth/sign-in/pin, which app/api/auth/[...all]/route.ts
        // serves to anyone. A guard in the server action protects only the first
        // caller; the public route would keep a six-digit PIN -- the factor a
        // player, i.e. a minor, signs in with -- exposed to unlimited guessing,
        // with nothing written to auth_login_attempts or auth_security_events
        // for check-security-signals.mjs to alert on. Better Auth's own
        // `"/sign-in/pin": { max: 6, window: 60 }` rule is keyed on ip|path, so
        // it caps one address and counts nothing per account.
        const security = requestSecurityContext(context.headers ?? new Headers())
        const subjectHash = authSubjectHash(username)
        const auditBase = {
          ipHash: security.ipHash,
          subjectHash,
          userAgent: security.userAgent,
        }
        // Check and spend in one step, before the slow verify. Checking first and
        // recording the failure afterwards left the verify as a window in which
        // a burst of simultaneous guesses each saw "not blocked", because none
        // had written its failure yet; the ceilings counted them afterwards and
        // stopped nothing. The guess is handed back below if the PIN is right.
        const attempt = { factor: "pin" as const, ipHash: security.ipHash, subjectHash }
        if (!reserveLoginAttempt(attempt)) {
          writeAuthSecurityEvent({
            ...auditBase,
            eventType: "login_rate_limited",
            outcome: "blocked",
            metadata: { factor: "pin" },
          })
          throw context.error("TOO_MANY_REQUESTS", { message: RATE_LIMITED_PIN_LOGIN })
        }

        // Resolved before the verify so a failure against an unknown or
        // unapproved academy ID is still attributable in the audit row.
        const account = findApprovedAccountByAcademyId(username)
        const verified = await verifyPinLogin({ pin: context.body.pin, academyId: username })
        if (!verified) {
          // Already counted by the reservation above.
          writeAuthSecurityEvent({
            ...auditBase,
            accountId: account?.accountId,
            eventType: "login_failed",
            metadata: { factor: "pin" },
            outcome: "failure",
          })
          throw context.error("UNAUTHORIZED", { message: INVALID_PIN_LOGIN })
        }
        // A PIN chosen before the strength rules existed is still accepted at
        // the door (validatePin is shape-only so old PINs keep working), which
        // left 123456 and birthday PINs signing children in. The PIN is right,
        // so this is the holder or someone who guessed it; either way it stops
        // working now. No session is issued: the password, which every PIN
        // holder also has, is the way in, and a new PIN must pass the rules.
        // The reservation is deliberately not handed back -- nobody signed in,
        // so this must not clear the account's other failure counters.
        if (validateNewPin(context.body.pin)) {
          removePinCredential(verified.accountId, { reason: "weak_legacy_pin" })
          writeAuthSecurityEvent({
            ...auditBase,
            accountId: verified.accountId,
            eventType: "login_failed",
            metadata: { factor: "pin", reason: "weak_legacy_pin" },
            outcome: "blocked",
          })
          throw context.error("FORBIDDEN", { message: RETIRED_PIN_LOGIN })
        }

        releaseLoginAttempt({ factor: "pin", ipHash: security.ipHash, subjectHash })
        writeAuthSecurityEvent({
          ...auditBase,
          accountId: verified.accountId,
          eventType: "login_succeeded",
          metadata: { factor: "pin" },
          outcome: "success",
        })

        const user = await context.context.internalAdapter.findUserById(verified.accountId)
        if (!user) throw context.error("UNAUTHORIZED", { message: INVALID_PIN_LOGIN })
        /*
         * "Trust this private device" is offered on the code page whichever way
         * the person signed in, but only the password door honoured it: Better
         * Auth's own check sits on its /sign-in paths and never sees this one.
         * So a coach who ticked the box after a PIN sign-in was asked for the
         * code every time. The same check is made here -- the signed cookie,
         * its HMAC over this account, and a live trust row for this account.
         * The trust is not renewed here, so it still ends on the date it was
         * first given.
         */
        const trustedBrowser = verified.twoFactorEnabled && await (async () => {
          try {
            const trustCookie = context.context.createAuthCookie("trust_device")
            const signed = await context.getSignedCookie(trustCookie.name, context.context.secret)
            const [token, trustIdentifier] = typeof signed === "string" ? signed.split("!") : []
            if (!token || !trustIdentifier) return false
            const expected = await createHMAC("SHA-256", "base64urlnopad")
              .sign(context.context.secret, `${user.id}!${trustIdentifier}`)
            if (token !== expected) return false
            const trust = await context.context.internalAdapter.findVerificationValue(trustIdentifier)
            return Boolean(trust && trust.value === user.id && trust.expiresAt > new Date())
          } catch {
            return false
          }
        })()
        if (verified.twoFactorEnabled && !trustedBrowser) {
          const maxAge = 10 * 60
          const identifier = `2fa-${randomBytes(20).toString("base64url")}`
          const expiresAt = new Date(Date.now() + maxAge * 1_000)
          await context.context.internalAdapter.createVerificationValue({
            value: user.id,
            identifier,
            expiresAt,
          })
          await context.context.internalAdapter.createVerificationValue({
            value: "0",
            identifier: `2fa-attempts-${identifier}`,
            expiresAt,
          })
          const twoFactorCookie = context.context.createAuthCookie("two_factor", { maxAge })
          await context.setSignedCookie(
            twoFactorCookie.name,
            identifier,
            context.context.secret,
            twoFactorCookie.attributes,
          )
          return context.json({
            twoFactorMethods: ["totp"],
            twoFactorRedirect: true,
            user,
          })
        }
        const session = await context.context.internalAdapter.createSession(user.id)
        if (!session) throw context.error("INTERNAL_SERVER_ERROR", {
          message: "A secure session could not be created.",
        })
        await setSessionCookie(context, { session, user })
        return context.json({ token: session.token, user })
      }),
    },
  } as const
}
