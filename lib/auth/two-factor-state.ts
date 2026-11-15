import "server-only"

import { and, eq, sql } from "drizzle-orm"

import { endSessionsStartedBefore } from "@/lib/auth/second-factor-reset"
import { initializeDatabase, type SmbaDatabaseExecutor } from "@/lib/db/client"
import { authTwoFactors, authUsers } from "@/lib/db/schema"

/**
 * Whether an account has an authenticator is kept twice: the user's
 * `twoFactorEnabled` flag, which decides whether sign-in asks for a code, and a
 * verified row in auth_two_factors, which holds the secret the code is checked
 * against. Better Auth writes the two separately, flag first, so a failure
 * between them leaves them disagreeing: a flag with no verified authenticator
 * asks for a code nothing can check, and a verified authenticator with the
 * flag off sends a head coach to a setup screen that refuses them.
 *
 * The verified row is the truth. This brings the flag back in line with it
 * before each sign-in, which is always the safe direction: either the code for
 * the authenticator they have is asked for, or an enrolment that never finished
 * is offered again.
 */
export function alignTwoFactorFlag(accountId: string, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  const connected = sql<boolean>`EXISTS (SELECT 1 FROM ${authTwoFactors}
    WHERE ${authTwoFactors.userId} = ${authUsers.id} AND ${authTwoFactors.verified} = 1)`
  // One step: a flag turned on with the purge lost would never purge again.
  database.transaction((tx) => {
    const turnedOn = tx.update(authUsers).set({ twoFactorEnabled: connected })
      .where(and(eq(authUsers.id, accountId), sql`${authUsers.twoFactorEnabled} <> ${connected}`))
      .returning({ enabled: authUsers.twoFactorEnabled }).get()?.enabled === true
    // Sessions opened while the flag was off never passed a code; with it back on
    // they would become full sessions, as confirmTotpSetup also guards against.
    if (turnedOn) endSessionsStartedBefore(accountId, now, { database: tx })
  })
}
