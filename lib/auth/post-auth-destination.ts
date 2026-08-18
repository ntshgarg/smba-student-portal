import "server-only"

import { eq } from "drizzle-orm"

import { principalTotpRequired } from "@/lib/auth/better-auth"
import { hasPinCredential } from "@/lib/auth/credential-service"
import { recoveryEmailEnrollmentRequired } from "@/lib/auth/recovery-service"
import { initializeDatabase, type SmbaDatabaseExecutor } from "@/lib/db/client"
import { coachProfiles } from "@/lib/db/schema"

export function postAuthenticationDestination(input: {
  accessLevel?: "head_admin" | "junior_coach" | null
  accountId: string
  role: "coach" | "platform_admin" | "player"
  twoFactorEnabled: boolean
}, {
  database = initializeDatabase(),
}: {
  database?: SmbaDatabaseExecutor
} = {}) {
  const accessLevel = input.role !== "coach"
    ? null
    : input.accessLevel !== undefined
      ? input.accessLevel
      : database.select({ accessLevel: coachProfiles.accessLevel })
      .from(coachProfiles)
      .where(eq(coachProfiles.accountId, input.accountId))
      .get()?.accessLevel ?? null
  if (principalTotpRequired(input.role, accessLevel) && !input.twoFactorEnabled) {
    return "/auth/two-factor/setup"
  }
  if (recoveryEmailEnrollmentRequired(input.accountId, { database })) {
    return "/account/recovery-email/setup"
  }
  if (input.role === "coach"
    && accessLevel === "head_admin"
    && !hasPinCredential(input.accountId, { database })) {
    return "/auth/pin/setup"
  }
  if (input.role === "platform_admin"
    && !hasPinCredential(input.accountId, { database })) {
    return "/auth/pin/setup"
  }
  if (input.role === "platform_admin") return "/admin"
  return input.role === "coach" ? "/coach" : "/player"
}
