import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"

import { createAuthMiddleware, isAPIError } from "better-auth/api"

import { findApprovedAccountByAcademyId } from "@/lib/auth/account-service"
import { isAcademyId, normalizeAcademyId } from "@/lib/auth/identity"
import {
  loginIsBlocked,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/auth/credential-service"
import {
  authSubjectHash,
  requestSecurityContext,
  writeAuthSecurityEvent,
} from "@/lib/auth/security-context"

const SIGN_IN_USERNAME_PATH = "/sign-in/username"
const RATE_LIMITED_USERNAME_LOGIN =
  "We couldn’t sign you in. Wait a few minutes before trying again."

/** Set only inside {@link signInWithJustWrittenPassword}. */
const justWrittenPassword = new AsyncLocalStorage<true>()

/**
 * Run a sign-in for a password this process wrote milliseconds earlier, exempt
 * from the block in `before` below. Only the block: the outcome still goes
 * through `after`, so the session it opens is still audited.
 *
 * Account activation (app/login/actions.ts) and first-run head-coach setup
 * (app/setup/head-coach/actions.ts) both write a password the person just chose
 * and immediately present that same password to `/sign-in/username` to open the
 * session. There is no guess in that, so there is nothing for a lockout to slow
 * down, and neither path was subject to one before this guard existed. Leaving
 * them subject to it would let twenty failures from anywhere behind the same
 * NAT or carrier address stop a new player activating at all for fifteen
 * minutes -- a register nobody can reach is worse than a guess nobody made.
 *
 * The flag rides an AsyncLocalStorage store rather than a header or a body
 * field, so it cannot be spoofed from outside: `POST /api/auth/sign-in/username`
 * enters the dispatcher with no store set, whatever the request carries.
 */
export function signInWithJustWrittenPassword<T>(run: () => Promise<T>) {
  return justWrittenPassword.run(true, run)
}

/**
 * The Academy ID this request is guessing at, or null when the request is not
 * the password door at all.
 *
 * Better Auth normalizes and validates the username with the same
 * `normalizeAcademyId` / `isAcademyId` pair configured on the plugin
 * (lib/auth/better-auth.ts:140-147) and answers UNPROCESSABLE_ENTITY for
 * anything that fails, before it reads a single row. Such a request can never
 * authenticate anybody, so counting it would only spend a budget that exists to
 * slow guesses at real accounts; the ip|path rule keeps that noise capped.
 */
function attemptedAcademyId(path: string, body: unknown) {
  if (path !== SIGN_IN_USERNAME_PATH) return null
  const username = (body as { username?: unknown } | undefined)?.username
  if (typeof username !== "string") return null
  const academyId = normalizeAcademyId(username)
  return isAcademyId(academyId) ? academyId : null
}

/**
 * The account/IP lockout and the audit rows for password sign-in, spent at the
 * endpoint rather than in the caller, because `POST /sign-in/username` has two
 * callers. `loginWithAcademyId` (app/login/actions.ts) reaches it through
 * `auth.api.signInUsername`, and app/api/auth/[...all]/route.ts mounts the same
 * endpoint publicly. A guard in the server action covers the first caller and
 * leaves the second open, which is what it did: six wrong passwords driven at
 * the endpoint through `auth.api.signInUsername`, bypassing the action the way
 * the router does, answered UNAUTHORIZED six times, left auth_login_attempts
 * and auth_security_events empty, and locked nothing.
 * Writing nothing also meant scripts/operations/check-security-signals.mjs,
 * which alerts on `login_rate_limited`, stayed blind for the whole run.
 *
 * `/sign-in/username` belongs to Better Auth's `username()` plugin, so unlike
 * the PIN door (lib/auth/pin-plugin.ts) there is no handler of ours to put the
 * guard inside. `accountLockout` in lib/auth/better-auth.ts is configured on the
 * twoFactor plugin and counts second-factor codes only, and the rate-limit rule
 * `"/sign-in/username": { max: 10, window: 60 }` is keyed on ip|path -- 14,400
 * attempts a day from one address and nothing per account -- so nothing counted
 * a guess against the account being guessed at. That rule is router middleware
 * in any case: it never sees an `auth.api.*` call, and today it never sees an
 * HTTP one either, because every request to /api/auth/* faults first with
 * `BetterAuthError: The field "id" does not exist in the "authRateLimits"
 * Drizzle schema` (lib/db/schema.ts stores key/count/last_request and no id).
 * That storage fault predates this guard and is left to its own change; it is
 * named here so nobody reads the rule as cover the endpoint actually has.
 *
 * `hooks.before` and `hooks.after` run inside `dispatchAuthEndpoint`, which both
 * the HTTP router and every `auth.api.*` call pass through, so one budget now
 * covers both callers. A refusal from `before` skips the handler and the `after`
 * hook with it, so a blocked attempt is never also counted as a failure.
 */
export const usernameLoginHooks = {
  after: createAuthMiddleware(async (context) => {
    const academyId = attemptedAcademyId(context.path, context.body)
    if (!academyId) return

    const security = requestSecurityContext(context.headers ?? new Headers())
    const subjectHash = authSubjectHash(academyId)
    const auditBase = {
      accountId: findApprovedAccountByAcademyId(academyId)?.accountId,
      ipHash: security.ipHash,
      subjectHash,
      userAgent: security.userAgent,
    }

    // `returned` carries the handler's payload when it answered and the APIError
    // it threw when it refused. Anything else is counted as a refusal, so an
    // outcome this hook does not recognise can never clear a spent budget.
    const returned = context.context.returned
    if (!returned || isAPIError(returned)) {
      /*
       * Recorded for every syntactically valid Academy ID, whether or not it
       * names an account, and that is deliberate.
       *
       * Skipping the write for an unresolvable ID was tried, to stop an
       * anonymous caller minting a throttle row per invented ID. It fixed
       * nothing -- this hook is only reached for IDs that already resolved, so
       * the branch never ran -- and it armed a trap: a real account would start
       * answering "wait a few minutes" from the sixth attempt while an invented
       * one answered "incorrect" for ever, which enumerates the whole roster at
       * six credential-free requests per ID. Six-thousand children's Academy IDs
       * are sequential.
       *
       * The row growth it aimed at is real but bounded: the ID space is
       * `SMBA-(HC|JC|PL)-\d{4}`, the rows live fifteen minutes, and the sweep
       * over them is indexed. A bounded, self-clearing cost is the right trade
       * against an unbounded disclosure.
       */
      recordLoginFailure({ ipHash: security.ipHash, subjectHash })
      writeAuthSecurityEvent({
        ...auditBase,
        eventType: "login_failed",
        metadata: { factor: "password" },
        outcome: "failure",
      })
      return
    }

    // A correct password that still owes an authenticator code answers
    // `twoFactorRedirect` rather than a session, and it clears the budget here
    // exactly as the login form cleared it before: the password was right, and
    // the code that follows is metered separately by the twoFactor plugin's own
    // eight-attempt `accountLockout`.
    recordLoginSuccess(subjectHash)
    writeAuthSecurityEvent({
      ...auditBase,
      eventType: "login_succeeded",
      metadata: { factor: "password" },
      outcome: "success",
    })
  }),
  before: createAuthMiddleware(async (context) => {
    // Read first, and read from the store rather than from the request, because
    // there is no guess here to slow down: activation and first-run head-coach
    // setup present the password this process wrote a moment ago. Without it a
    // brand-new player behind a carrier address that had already spent its
    // twenty failures would finish activation and then be refused their first
    // session, with the claim already consumed.
    if (justWrittenPassword.getStore()) return

    const academyId = attemptedAcademyId(context.path, context.body)
    if (!academyId) return

    const security = requestSecurityContext(context.headers ?? new Headers())
    const subjectHash = authSubjectHash(academyId)
    if (!loginIsBlocked({ ipHash: security.ipHash, subjectHash })) return
    writeAuthSecurityEvent({
      eventType: "login_rate_limited",
      ipHash: security.ipHash,
      metadata: { factor: "password" },
      outcome: "blocked",
      subjectHash,
      userAgent: security.userAgent,
    })
    throw context.error("TOO_MANY_REQUESTS", { message: RATE_LIMITED_USERNAME_LOGIN })
  }),
}
