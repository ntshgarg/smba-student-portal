import "server-only"

import {
  operationalActionFailure,
  SessionExpiredError,
  type SessionExpiredFailure,
} from "@/lib/actions/operational-result"
import { requireHeadAdminAction } from "@/lib/auth/current-coach"
import type { SessionIdentity } from "@/lib/auth/identity"

/**
 * The single place a coach guard's expiry becomes a value.
 *
 * Sessions run a fixed seven-day clock, so every guarded action is crossed at
 * expiry on a schedule rather than by exception, and there are 42 of them: 14
 * here in `app/coach/actions.ts`, 20 in `app/coach/financials/actions.ts`, 3
 * each in `app/coach/announcements` and `app/coach/onboarding`, 2 in
 * `app/coach/attendance/adjustments`. A conversion written per action would be
 * 42 catch blocks that have to agree; this is one.
 *
 * Opting an action in is one edit or two, and which it is was measured rather
 * than assumed. Its `await requireCoach()` moves inside the call; then, if it
 * declares a domain result of its own, that result gains
 * `| SessionExpiredFailure`. Moving `runFinanceAction`
 * (`app/coach/financials/actions.ts:108`) in and changing nothing else fails
 * `npm run typecheck` with 17 TS2322s, one per action returning
 * `Promise<FinanceActionResult>` -- "Type '"SESSION_EXPIRED"' is not assignable
 * to type 'FinanceServiceErrorCode'" -- and adding the one member to
 * `FinanceActionResult` clears all 17 with no consumer of that type changed.
 * Across the remaining 40 actions that is six members in all:
 * `FinanceActionResult` and `FinanceDataActionResult` (20 actions),
 * `AnnouncementActionResult` (3), and `MemberMutationResult`,
 * `ArchiveMemberResult` and `ReportMutationResult` (4). The other 13 already
 * return `OperationalActionResult`, whose code union carries `SESSION_EXPIRED`
 * already, so they cost the one edit -- which is what both registers cost.
 *
 * `operation` is deliberately unconstrained. The obvious alternative -- putting
 * `SESSION_EXPIRED` into each surface's own error-code union -- does not
 * survive contact with the finance actions: `FinanceActionFailure.code` is
 * `FinanceServiceErrorCode` (`lib/finance/types.ts:823-834`, 11 members, none
 * of them an authentication code), and widening that union means widening the
 * type every `FinanceServiceError` in `lib/finance/service.ts` is constructed
 * with. Returning `Result | SessionExpiredFailure` instead leaves every domain
 * code union exactly as it was and adds one member beside the result it
 * describes, so an action opts in without its service layer being touched at
 * all -- none of the six results above carries an authentication code, and none
 * of them has to start.
 *
 * The guard still throws, so this cannot let an unguarded mutation run:
 * `operation` is only reached on the branch where a coach came back. A refusal
 * that is not an expiry -- being denied head-coach access -- keeps throwing,
 * because it has no correction the coach can make and repeating the request
 * cannot change it.
 */
export async function runCoachAction<Result>(
  operation: (coach: SessionIdentity) => Result | Promise<Result>,
): Promise<Result | SessionExpiredFailure> {
  let coach: SessionIdentity
  try {
    coach = await requireHeadAdminAction()
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) throw error
    // The code is re-stated so the returned value carries the literal rather
    // than the whole `OperationalActionErrorCode` union; `SessionExpiredError`
    // is constructed with this exact code and no other.
    return { ...operationalActionFailure(error), code: "SESSION_EXPIRED" }
  }
  return operation(coach)
}
