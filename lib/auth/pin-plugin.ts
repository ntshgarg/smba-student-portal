import "server-only"

import { randomBytes } from "node:crypto"

import { createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { z } from "zod"

import { normalizeAcademyId } from "@/lib/auth/identity"
import { verifyPinLogin } from "@/lib/auth/credential-service"

const INVALID_PIN_LOGIN = "SMBA username or PIN is incorrect."

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
        const verified = await verifyPinLogin({ pin: context.body.pin, academyId: username })
        if (!verified) throw context.error("UNAUTHORIZED", { message: INVALID_PIN_LOGIN })

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
