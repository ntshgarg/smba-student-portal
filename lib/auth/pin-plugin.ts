import "server-only"

import { randomBytes } from "node:crypto"

import { createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { z } from "zod"

import { ACADEMY_ID_LABEL, normalizeAcademyId } from "@/lib/auth/identity"
import { findApprovedAccountByAcademyId } from "@/lib/auth/account-service"
import {
  loginIsBlocked,
  recordLoginFailure,
  recordLoginSuccess,
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
        if (loginIsBlocked({ ipHash: security.ipHash, subjectHash })) {
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
          recordLoginFailure({ ipHash: security.ipHash, subjectHash })
          writeAuthSecurityEvent({
            ...auditBase,
            accountId: account?.accountId,
            eventType: "login_failed",
            metadata: { factor: "pin" },
            outcome: "failure",
          })
          throw context.error("UNAUTHORIZED", { message: INVALID_PIN_LOGIN })
        }
        recordLoginSuccess(subjectHash)
        writeAuthSecurityEvent({
          ...auditBase,
          accountId: verified.accountId,
          eventType: "login_succeeded",
          metadata: { factor: "pin" },
          outcome: "success",
        })

        const user = await context.context.internalAdapter.findUserById(verified.accountId)
        if (!user) throw context.error("UNAUTHORIZED", { message: INVALID_PIN_LOGIN })
        if (verified.twoFactorEnabled) {
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
