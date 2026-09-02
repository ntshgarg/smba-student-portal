# Security work — checkpoint

**Written:** 2026-09-02, mid-cycle.
**Branch:** `fix/security-audit-p0-p2` — pushed, 3 commits, no PR opened yet.
**Base:** `main` at `4263bf1` (the merged email-verified registration work).
**Local state:** clean. Everything is on the remote; nothing lives only on this machine.

---

## Where this stopped

A fresh whole-application security audit was run against `main`, replacing the earlier one at
`48b5853` (which was discarded and re-derived blind, so anything still true was re-found rather
than inherited). It produced **17 findings**, written up in `docs/audit/security.md`.

Fixing them is running as a **loop**: fix → test → re-attack → fix what the re-attack finds. Three
rounds are done. **Round 3's audit was still running when this checkpoint was written.**

| round | what it found | what was fixed |
|---|---|---|
| 1 | 17 findings (1 P0, 2 P1, 4 P2, 10 P3) | 7 — the P0, both P1s, three P2s, security headers |
| 2 | **2 P0 and 1 P1, all three caused by round 1's own fixes** | 5 — including all three regressions |
| 3 | *in flight* — task `w60lj1s9h` | — |

### Round 2 is the important story

Two of round 1's fixes were worse than the bugs they replaced. This is the whole reason the loop
exists, and it is worth reading before trusting any single round:

- **The lockout fix became an account takeover.** Moving the login budget from `subject:<hash>` to
  `subject:<hash>:<ip>` removed the only ceiling counting failures against an account across
  sources — and the address comes from a header the caller writes. Rotating it bought a fresh
  five-guess budget every five guesses. Measured against a live build: **76 guesses per second**
  with nothing refusing them, which takes a six-digit PIN in hours.
- **The PIN fix handed the thief the door.** Removing the PIN on session revocation looked right,
  but that action is gated on a session alone — so a stolen cookie could delete the victim's PIN
  and mint its own, because `setupPinAction` had been relying on "a PIN already exists" as its only
  obstacle. Reproduced end to end: the attacker's new PIN signed in from a client holding no cookie
  and no password.

Both are repaired in `aa01e11`, with regressions that fail against the code as it stood.

---

## What is done

**Round 1 — `e04a84a`**

- **P0** Nightly production-database snapshots were published as GitHub Actions artifacts on a
  public repo. 15 were live, up to 35 days old, each a `SELECT *` of every table: children's names,
  dates of birth, guardian mobile numbers, password and PIN hashes, and TOTP secrets and backup
  codes in plaintext. **Artifacts deleted, passphrase rotated by the owner, schedule off.**
- **P1** Five requests locked any account out of both the password and PIN doors.
- **P1** Every `/api/auth/*` request 500ed and wrote an unauthenticated row into the database; all
  four configured rate limits were dead code. The router was deleted — nothing called it.
- **P2** A stranger could silence registration and status lookup for any address they knew.
- **P2** A stolen cookie left a permanent PIN as a second door.
- **P2** `/api/client-errors` grew without bound.
- **P3** No response carried any security header.

**Round 2 — `05c114e`**

- The forwarded-IP header is opt-in (`SMBA_FORWARDED_IP_HEADER`); unset, everyone shares one bucket.
- Telemetry redaction gained Indian phone numbers, JWTs, hex and base64url runs, and the lowercase
  and `SMBA#0001` Academy ID spellings. Two attempts were wrong and the repo's own tests caught
  both — one ate 300 characters of padding, the other took 517ms on 32 KB against a 150ms budget.
- `npm audit` gate in CI; `preview-smoke` no longer trusts `dependabot/*` branch heads.

**Round 3 — `aa01e11`**

- Account-wide login ceiling restored at **50** per 15 minutes (was 5, then absent).
- Forwarded header read from the **last** hop — an appending proxy puts the client's own claim
  first, which is what made the bucket rotatable.
- `revokeOtherSessionsAction` no longer destroys a credential on a session-only gate.
- Minting a first PIN now needs a session younger than 15 minutes.
- Client-error ceiling counted per route, not globally (a global one let a stranger mute all
  telemetry).
- Spent throttle rows are cleared instead of accumulating for ever.

**Verification:** 1387 unit tests across 196 files, `tsc` and `eslint` clean. No browser or CI run
yet on this branch.

---

## What is left

**Not fixed, deliberately:**

| | |
|---|---|
| Child and guardian PII plaintext at rest | There is still **no encryption helper anywhere** in this codebase. The design is written up in `docs/audit/security.md` §7 — split table, AES-256-GCM, blind index for the three predicates that filter by address value, expand/backfill/contract across three deploys. This is a project, not a patch. |
| No erasure path | An archived member keeps DOB, contacts and coach narrative for ever. |
| Coach report drafts in `localStorage` | Free text about a named child, surviving sign-out for 7 days on a shared device. |
| Admin-preview gate keys on cookie presence, not validity | Harmless today (impersonation requires `platform_admin`) but the wrong predicate. |
| Identity object over-serialized to client components | Coach layout was narrowed; student and admin were not. |
| CSP keeps `'unsafe-inline'` on `script-src` | So it stops no XSS execution. Tightening needs a nonce. |

**Known residual on the login throttle, stated plainly:** the account-wide ceiling of 50 means a
determined stranger can still deny one account for 15 minutes, at ten times the old cost. That is a
deliberate trade. A cap no request attribute can rotate is the only thing between a six-digit PIN
and an afternoon, and a denial is recoverable where a takeover is not.

---

## For whoever picks this up

**1. Collect round 3.** The audit was running when this was written:

```bash
# results land here; parse result.dimensions[].report / .verdicts
cat /private/tmp/claude-502/-Users-nitishg-smba-student-portal/12afb116-e749-47b6-8e01-a25f28b94cc7/tasks/w60lj1s9h.output
```

It carries a **ship-readiness** lens that does not hunt bugs — it answers "what does a competent
attacker get today, what should block the launch, and is this safe enough to serve real families".
Read that first.

**2. Assume round 3's fixes are wrong too.** Two rounds running, a fix has been worse than the bug.
Do not merge a round without re-attacking it.

**3. Rebuild the rig** if you need to attack a live build:

```bash
cp .data/academy-stress.db /tmp/smba-attack-registration-rig.db
BETTER_AUTH_SECRET=smba-attack-rig-secret-not-used-anywhere-else-2026 \
NEXT_PUBLIC_SMBA_SITE_ORIGIN=https://ci.smbaacademy.in \
SMBA_AUTH_MAIL_TRANSPORT=memory SMBA_REQUIRE_RECOVERY_EMAIL=false \
BETTER_AUTH_SECURE_COOKIES=false SMBA_REQUIRE_COACH_TOTP=false \
SMBA_ACCESSIBILITY_PROFILE=registration SMBA_FORWARDED_IP_HEADER=x-forwarded-for \
DB_FILE_NAME=/tmp/smba-attack-registration-rig.db npx next start -p 3210
```

Fixture password for every seeded account: `SMBA fixture access 2026!`

**4. No PR is open.** The branch is pushed but unopened, and CI has never run on it. Open it, get
CI green, then merge — `main` auto-deploys to production.

---

## Owner's outstanding decision

**Where should backups go?** The nightly job is **off**, so there is no backup being taken at all
right now. One encrypted snapshot from 2 Sep is retained locally at
`~/smba-backups/smba-production-33603032642-1.tar.gz.gpg` (mode 600) — it is encrypted with the
**old** passphrase, so keep that passphrase somewhere retrievable or re-encrypt the file.

Three options, unchanged:

1. **Turso point-in-time restore**, if the plan includes it — then nothing else is needed.
2. **Private object storage** (R2/S3 with OIDC short-lived credentials) — needs a bucket and a
   secret; the workflow change is small.
3. **Leave it off** — acceptable for a few days, not for a term.
