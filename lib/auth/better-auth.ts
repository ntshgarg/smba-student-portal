import "server-only"

import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { twoFactor, username } from "better-auth/plugins"

import { isAcademyId, normalizeAcademyId } from "@/lib/auth/identity"
import { siteOrigin } from "@/lib/config"
import { initializeDatabase, shouldUseTurso } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"
import { smbaPinLogin } from "@/lib/auth/pin-plugin"
import { secureAuthCookiesRequired } from "@/lib/auth/cookie-policy"

const LOCAL_ONLY_AUTH_SECRET = "smba-local-only-auth-secret-change-before-deployment-2026"

function authSecret() {
  if (process.env.VERCEL === "1"
    && process.env.VERCEL_ENV === "production"
    && process.env.PROTOTYPE_ACADEMY_ID_AUTH === "true") {
    throw new Error("Prototype Academy-ID-only authentication must not be enabled in production.")
  }
  const configured = process.env.BETTER_AUTH_SECRET?.trim()
  if (configured) {
    if (configured.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.")
    }
    return configured
  }

  // `next build` uses NODE_ENV=production even for a local artifact. Vercel is
  // the production boundary where a missing secret must stop deployment.
  if (process.env.VERCEL === "1") {
    throw new Error("BETTER_AUTH_SECRET is required for a Vercel deployment.")
  }
  return LOCAL_ONLY_AUTH_SECRET
}

export function coachTotpRequired(accessLevel: "head_admin" | "junior_coach" = "head_admin") {
  if (accessLevel !== "head_admin") return false
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") return true
  if (process.env.SMBA_REQUIRE_COACH_TOTP === "true") return true
  if (process.env.SMBA_REQUIRE_COACH_TOTP === "false") return false
  return process.env.NODE_ENV === "production"
}

export function principalTotpRequired(
  role: "coach" | "platform_admin" | "player",
  accessLevel: "head_admin" | "junior_coach" | null,
) {
  if (role === "platform_admin") return true
  return role === "coach" && accessLevel === "head_admin" && coachTotpRequired(accessLevel)
}

function createAuth() {
  return betterAuth({
  appName: "SMBA",
  baseURL: siteOrigin.origin,
  basePath: "/api/auth",
  secret: authSecret(),
  database: drizzleAdapter(initializeDatabase(), {
    provider: "sqlite",
    schema,
    // Better Auth's verification-token consume path starts its own atomic
    // SQLite transaction. Advertising an already-transactional adapter causes
    // the nested consume to return no row and breaks password/PIN + TOTP login.
    transaction: false,
  }),
  emailAndPassword: {
    disableSignUp: true,
    enabled: true,
    maxPasswordLength: 128,
    minPasswordLength: 12,
    revokeSessionsOnPasswordReset: true,
  },
  user: {
    modelName: "authUsers",
  },
  session: {
    disableSessionRefresh: true,
    expiresIn: 60 * 60 * 24 * 7,
    modelName: "authRuntimeSessions",
  },
  account: {
    modelName: "authProviderAccounts",
  },
  verification: {
    modelName: "authVerifications",
    storeIdentifier: "hashed",
  },
  rateLimit: {
    enabled: true,
    max: 100,
    modelName: "authRateLimits",
    storage: "database",
    window: 60,
    customRules: {
      "/sign-in/username": { max: 10, window: 60 },
      "/sign-in/pin": { max: 6, window: 60 },
      "/two-factor/*": { max: 6, window: 60 },
    },
  },
  advanced: {
    cookiePrefix: "smba",
    ipAddress: {
      ipAddressHeaders: ["x-vercel-forwarded-for", "cf-connecting-ip", "x-forwarded-for"],
      ipv6Subnet: 64,
    },
    useSecureCookies: secureAuthCookiesRequired(),
  },
  trustedOrigins: [siteOrigin.origin],
  plugins: [
    username({
      displayUsernameNormalization: normalizeAcademyId,
      displayUsernameValidator: isAcademyId,
      maxUsernameLength: 15,
      minUsernameLength: 9,
      usernameNormalization: normalizeAcademyId,
      usernameValidator: isAcademyId,
    }),
    smbaPinLogin(),
    twoFactor({
      accountLockout: {
        durationSeconds: 15 * 60,
        enabled: true,
        maxFailedAttempts: 8,
      },
      issuer: "Sathiya Moorthy Badminton Academy",
      trustDeviceMaxAge: 30 * 24 * 60 * 60,
      twoFactorCookieMaxAge: 10 * 60,
      twoFactorTable: "authTwoFactors",
    }),
    nextCookies(),
  ],
  })
}

// Local SQLite has a process-owned connection and benefits from a shared auth
// runtime. Turso's remote Hrana stream can expire while a serverless worker is
// frozen, so production requests build their adapter against the refreshed
// connection returned by initializeDatabase().
export const auth = createAuth()

export function getAuth() {
  return shouldUseTurso() ? createAuth() : auth
}
