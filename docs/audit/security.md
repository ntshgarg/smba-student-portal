# Security audit — smba-player-journal

**Target:** `smba-player-journal` (Next.js 16.3.1 App Router, Drizzle ORM over SQLite/Turso, better-auth 1.7)
**Repository:** `ntshgarg/smba-student-portal` — **public**
**Commit audited:** `4263bf1` (`main`), 2026-09-02 — the merge of the email-verified registration flow
**Method:** two independent passes. A read-only whole-application pass over nine dimensions, then a
live attack pass driving a disposable production build (100-player stress fixture, port 3210) with
real sessions, forged cookies, replayed server actions and injected payloads. Every finding from
both passes was handed to a separate verifier instructed to *refute* it and to default to refuted
under uncertainty.
**Supersedes** the audit of `48b5853`. That document was discarded and this pass ran blind, so
anything still true was re-derived rather than inherited.

53 agents, 34 raw findings, 2 refuted outright, 12 downgraded on verification.

---

## 1. Findings at a glance

| # | Pri | Finding | Anchor |
|---|---|---|---|
| 1 | **P0** | Nightly full production-database snapshots are published as GitHub Actions artifacts on a **public** repository — 15 live right now | [.github/workflows/encrypted-production-backup.yml:71](../../.github/workflows/encrypted-production-backup.yml#L71) |
| 2 | **P1** | Any stranger locks any account — including the head coach — out of **both** the password and PIN doors with five requests | [lib/auth/credential-service.ts:615](../../lib/auth/credential-service.ts#L615) |
| 3 | **P1** | Every `/api/auth/*` request 500s **and writes an unauthenticated row** into the production database; all four configured rate limits are dead code | [lib/db/schema.ts:200](../../lib/db/schema.ts#L200) |
| 4 | **P2** | A stranger who knows an email address silently suppresses its owner's registration and status lookup, indefinitely | [lib/auth/recovery-service.ts:524](../../lib/auth/recovery-service.ts#L524) |
| 5 | **P2** | A stolen session cookie mints a permanent PIN login factor, and neither password change nor "log out other devices" revokes it | [app/auth/pin/actions.ts:22](../../app/auth/pin/actions.ts#L22) |
| 6 | **P2** | Every identifying field about a child and their guardian is plaintext; there is **no encryption helper in the codebase at all** | [lib/db/schema.ts:17](../../lib/db/schema.ts#L17) |
| 7 | **P2** | `/api/client-errors` grows unboundedly: the caller controls the fingerprint that is supposed to bound it | [lib/telemetry/error-report.ts:179](../../lib/telemetry/error-report.ts#L179) |
| 8 | P3 | IP throttles key on a client-supplied header with no trusted-proxy check (not exploitable on Vercel; is on self-host) | [lib/auth/security-context.ts:25](../../lib/auth/security-context.ts#L25) |
| 9 | P3 | No CSP, HSTS, X-Frame-Options, Referrer-Policy or X-Content-Type-Options on any HTML response | [next.config.ts:3](../../next.config.ts#L3) |
| 10 | P3 | No erasure path: archived children keep DOB, contacts and narrative forever; abandoned challenges are never pruned | [lib/coach/member-service.ts:430](../../lib/coach/member-service.ts#L430) |
| 11 | P3 | Coach assessment drafts about named minors persist in `localStorage` across sign-out | [lib/coach/report-draft.ts](../../lib/coach/report-draft.ts) |
| 12 | P3 | Admin-preview read-only gate keys on cookie **presence**, not validity | [proxy.ts](../../proxy.ts) |
| 13 | P3 | Student and admin layouts serialize the whole identity object across the client boundary | [app/(student)/layout.tsx](../../app/(student)/layout.tsx) |
| 14 | P3 | Telemetry redaction has no phone-number rule and misses base64/JWT/hex tokens | [lib/telemetry/redaction.ts](../../lib/telemetry/redaction.ts) |
| 15 | P3 | No dependency-vulnerability gate in CI; the merge gate cannot fail on a new advisory | [.github/workflows/quality.yml](../../.github/workflows/quality.yml) |
| 16 | P3 | `preview-smoke` treats any branch head in this repo as reviewed code, including Dependabot's | [.github/workflows/preview-smoke.yml](../../.github/workflows/preview-smoke.yml) |
| 17 | P3 | Every destructive confirmation token is a compile-time constant published in this public repo | [scripts/database/reset-academy.ts](../../scripts/database/reset-academy.ts) |

**Refuted on verification, recorded so they are not re-filed:** `shouldUseTurso()` keying on `VERCEL=1`
without `VERCEL_ENV` (a preview cannot reach production credentials — the claim did not survive);
npm `overrides` excluding postcss/sharp from Dependabot (they are not excluded).

---

## 2. What held up

This matters as much as the list above, because it is the part the audit was aimed at hardest.

**There is no player-to-player IDOR.** This was attacked exhaustively against a live build, not
reasoned about:

- **Every report PDF.** All 50 `monthly_reports.id` values from the fixture, requested with a
  player's cookie: exactly one `200` (their own), 49 × `404 Report not found`. Mutated ids —
  `' OR '1'='1`, `%00`, `%20`, trailing quote, 5000 × `A`, `../`, `%2f..` — all refused. Under
  concurrency (40 interleaved requests, two players, own and cross): no bleed.
- **Every server action.** `.next/server/server-reference-manifest.json` maps all 83 action ids to
  their file and export, so nothing had to be guessed. 82 were replayed with a player's cookie and
  a payload carrying another child's ids. All 82 threw; none returned data. The destructive ones
  were then checked against the database: report draft unchanged, member name unchanged,
  registration still `pending`, another player's session row still present.
- **Coach routes with a player's cookie**, using the victim's real ids: `307 → /player`, and zero
  occurrences of the victim's name in any body. Download and CSV routes: `401`, 24 bytes.
- **A forged but validly signed admin-preview cookie.** Minted with the rig's own
  `BETTER_AUTH_SECRET` naming a player as actor and another child as target: inert. The
  impersonation branch sits inside `if (result.role === "platform_admin")`.
- **No over-fetching filtered in the browser.** Every UUID in the RSC payloads of `/player`,
  `/player/financials` and `/player/reports` was extracted and looked up: all belonged to the
  signed-in child.

All 42 coach actions were read; none is missing its `requireHeadAdminAction()` / `runCoachAction()` /
`runFinanceAction()` guard. **No SQL injection was found** — there are zero raw `sql\`\`` fragments
carrying user input, and the one dynamic `LIKE` escapes its metacharacters. **No XSS was found** —
no `dangerouslySetInnerHTML` reachable by user content. CSV exports **do** neutralise formula
injection.

---

## 3. P0 — fix before anything else

### 3.1 Production database snapshots are published on a public repository

**Anchor:** [.github/workflows/encrypted-production-backup.yml:71](../../.github/workflows/encrypted-production-backup.yml#L71)

`encrypted-production-backup.yml` runs daily at 02:47 and uploads the snapshot with
`actions/upload-artifact`, `retention-days: 35`. The repository is public
(`gh api repos/... → "private": false`).

**Live at the time of writing — verified by direct query:**

```
smba-production-backup-33603032642-1  56654B  created 2026-09-02  expires 2026-10-07
smba-production-backup-33484790747-1  48876B  created 2026-09-01  expires 2026-10-06
…14 more, back to 2026-08-20, including pre-reset-snapshot-33249862151
```

**What is in them.** `scripts/operations/database-snapshot.mjs:31-47` selects every table from
`sqlite_master` with no exclusion list and copies every row. So:

| | |
|---|---|
| `accounts` | children's full names, **dates of birth**, contact emails, contact phones |
| `player_enrollments` | guardian name, relationship, **mobile number** — 100 of 100 rows populated |
| `auth_provider_accounts.password`, `auth_pin_credentials.pin_hash` | credential hashes |
| `auth_two_factors.secret`, `.backup_codes` | **plaintext.** `grep -rn "createCipheriv\|aes-256-gcm" lib/` returns nothing — there is no encryption anywhere in this codebase |
| `report_publications.report_text` | a coach's prose about a named minor |

**Who can read it.** Fully anonymous callers get the artifact *list* (HTTP 200 — ids, sizes,
sha256, `archive_download_url`). Download returns 401 anonymously, but on a public repository
`actions:read` is granted to **any authenticated GitHub account**; the verifier confirmed this by
downloading an artifact from an unrelated public repo with a token holding no rights on it, and
receiving a 302 to signed blob storage. So: any free GitHub account, no relationship to this
project.

The only control is one symmetric passphrase, `SMBA_BACKUP_PASSPHRASE`, never rotated.

**Fix — in this order. Rotating without deleting is pointless; old ciphertext stays attackable
under the old passphrase.**

1. **Delete the 15 live artifacts** — `DELETE /repos/{owner}/{repo}/actions/artifacts/{id}` for
   every `smba-production-backup-*` and `pre-reset-snapshot-*`.
2. **Rotate `SMBA_BACKUP_PASSPHRASE`.**
3. **Stop publishing.** Remove the upload step from both workflows:

```diff
-      - name: Upload encrypted snapshot
-        uses: actions/upload-artifact@v4
-        with:
-          name: smba-production-backup-${{ github.run_id }}-${{ github.run_attempt }}
-          path: .data/smba-production-*.tar.gz.gpg
-          retention-days: 35
+      - name: Push encrypted snapshot to private object storage
+        env:
+          AWS_ROLE_ARN: ${{ secrets.SMBA_BACKUP_ROLE_ARN }}   # OIDC, short-lived
+        run: aws s3 cp .data/smba-production-*.tar.gz.gpg "s3://$SMBA_BACKUP_BUCKET/" --sse aws:kms
```

   The requirement is that a read is **authenticated, logged and revocable**. Artifacts on a public
   repo are none of those. Same change at `empty-academy.yml:86-92`.
4. Move from a symmetric passphrase to public-key encryption (`age` or `gpg --recipient`), so the CI
   job can only *write* backups, never read them.

---

## 4. P1

### 4.1 Five requests lock any account out of both doors

**Anchor:** [lib/auth/credential-service.ts:615](../../lib/auth/credential-service.ts#L615)

`attemptKeys` returns `subject:<hash>` at threshold 5 and `ip:<hash>` at threshold 20. The subject
counter is spent by **whoever** submits a wrong credential for that Academy ID, and it produces a
hard refusal.

Reproduced live against a victim the first auditor never touched (`SMBA-PL-0055`):

```
control  — victim's real password, own IP        → 200, x-action-redirect: /player;push
attack   — 5 wrong guesses, 5 different IPs      → "Academy ID or password is incorrect." ×5
victim   — real password again, own IP           → "We couldn’t sign you in. Wait a few minutes…"

auth_login_attempts:
  subject:a1c52ed8… | 5 | blocked_until 09:37:09
  ip:1428108e… | 1    ip:cb326cea… | 1    ip:0be24cd6… | 1    …
```

The five attacker IP rows sit at 1 each — the whole cost lands on the victim. It covers the PIN
door too, and the head coach was verified vulnerable by the same five-request recipe. 15-minute
block, renewable indefinitely at 20 requests/hour.

**Fix.** A per-subject counter must not produce a hard refusal an unauthenticated party controls:

```diff
 function attemptKeys(subjectHash: string, ipHash: string) {
   return [
-    { key: `subject:${subjectHash}`, threshold: 5 },
+    // Blocking must be keyed on the pair. A stranger's failures from another
+    // address must never refuse the client that holds the real credential.
+    { key: `subject:${subjectHash}:${ipHash}`, threshold: 5 },
     { key: `ip:${ipHash}`, threshold: 20 },
   ]
 }
```

Keep a global per-subject counter for *alerting and escalation* — progressive delay, then a
CAPTCHA or an emailed confirm-it-was-you — but never a refusal. Exempt a client presenting a valid
known-device cookie, and clear the blocked state on a successful proof of the credential.

### 4.2 `/api/auth/*` 500s on every request and writes a row each time

**Anchor:** [lib/db/schema.ts:200](../../lib/db/schema.ts#L200)

`lib/auth/better-auth.ts:117` sets `rateLimit: { storage: "database", modelName: "authRateLimits" }`.
The Drizzle adapter's `create()` always injects a generated `id`; `auth_rate_limits` declares only
`key`/`count`/`last_request`, so `checkMissingFields` throws. The throw happens in better-call's
`onRequest`, **outside** the try/catch and **before routing** — so every path and method faults:

```
$ for p in get-session ok sign-in/pin x; do curl -s -o /dev/null -w "$p -> %{http_code}\n" \
    http://127.0.0.1:3210/api/auth/$p; done
get-session -> 500     ok -> 500     sign-in/pin -> 500     x -> 500
select count(*) from auth_rate_limits;  →  0     (after hundreds of requests)
```

Next catches, calls `onRequestError`, which persists an `operational_events` row, then rethrows.
Measured: **exactly one durable row per unauthenticated request**, no session, no rate limit, no
dedupe. 97 rows accumulated during the audit alone. Two consequences: unauthenticated write
amplification into Turso, and all four configured rate-limit rules have never executed.

**Fix.** Three changes, each covering something the others do not:

```diff
 export const authRateLimits = sqliteTable("auth_rate_limits", {
-  key: text("key").primaryKey(),
+  id: text("id").primaryKey(),
+  key: text("key").notNull(),
   count: integer("count").notNull(),
   lastRequest: integer("last_request").notNull(),
-})
+}, (table) => [uniqueIndex("auth_rate_limits_key_idx").on(table.key)])
```

with a migration that rebuilds the table. **Do not ship that alone** — fixing it brings the whole
better-auth router up for the first time, including `POST /api/auth/sign-in/email`, which
`usernameLoginHooks` does not match (it keys on `path !== "/sign-in/username"`) and which therefore
has no per-account lockout and writes no `auth_login_attempts` row. Extend the matcher to
`/sign-in/email` and `/sign-in/pin` and set `disabledPaths` for everything this product does not
use — **or** delete `app/api/auth/[...all]/route.ts` entirely, since nothing in `app/`,
`components/` or `lib/` calls it and every flow runs through server actions.

Independently, dedupe the server-side error recorder the way the client one already is
(`lib/operations/record-request-error.node.ts`), and do not persist expected authorisation
refusals at all — they are decisions, not faults, and they are the cheapest row to force.

---

## 5. P2

### 5.1 A stranger silently suppresses registration for any address they know

**Anchor:** [lib/auth/recovery-service.ts:524](../../lib/auth/recovery-service.ts#L524)

*Introduced by `a299df2` in this branch, replacing a worse lock. Found by three independent
verifiers.*

The resend cooldown selects the newest challenge filtered **only** by
`eq(authEmailChallenges.email, email)` — no `subjectHash`, no requester, no `consumedAt`. Line 537
returns silently, and both callers still answer `{accepted:true}` and still say a code was sent.
Because a fresh junk name mints a fresh identity key, the per-identity ceiling of 5 never binds.

Reproduced on a strictly chronological clock, one attacker IP, 20 simulated minutes: 241 attacker
requests → 21 mails delivered to the victim's inbox, one per minute; 24 interleaved victim
attempts across `/register` and `/activate`, each from a distinct IP → **zero** codes.

**Fix.** Do not reinstate an address-scoped *ceiling* — that was the previous, worse bug, and
`tests/registration-attack-regressions.test.ts` correctly forbids it. Scope the *cooldown* to the
pair:

```diff
   const latest = database.select({ createdAt: authEmailChallenges.createdAt })
     .from(authEmailChallenges)
     .where(and(
       eq(authEmailChallenges.email, email),
+      eq(authEmailChallenges.subjectHash, hashedSubject),
+      isNull(authEmailChallenges.consumedAt),
       eq(authEmailChallenges.purpose, "verify_email"),
     ))
```

Then replace the flood bound it was doing with one a stranger cannot spend: cap the number of
*distinct identities* mailed to one address per hour, and when that is exceeded still serve any
identity that already has an account row or a live challenge for that address — so the address's
genuine owners always get through.

### 5.2 A stolen cookie mints a permanent second door

**Anchor:** [app/auth/pin/actions.ts:22](../../app/auth/pin/actions.ts#L22)

`setupPinAction` gates on a session and nothing else — no password, no step-up. Its sibling
`savePinAction` *does* require the current password, and the file's own comment concedes the
asymmetry. Neither `changePasswordAction` nor `revokeOtherSessionsAction` removes a PIN, so the
remediation a worried user reaches for does not close the door the attacker installed. A player has
no second factor in the way.

**Fix.**

```diff
 // app/account/security/actions.ts — changePasswordAction and revokeOtherSessionsAction
+  // The PIN is a login factor. Rotating the password or revoking sessions must
+  // revoke it too, or the success copy is false. completePasswordRecovery
+  // already does exactly this.
+  removePinCredential(identity.subjectId, { database })
```

and make first-time PIN setup a step-up as well, so a stolen cookie alone cannot mint one.

### 5.3 Every field about a child is plaintext

**Anchor:** [lib/db/schema.ts:17](../../lib/db/schema.ts#L17) — see §7 for the design.

### 5.4 `/api/client-errors` grows without bound

**Anchor:** [lib/telemetry/error-report.ts:179](../../lib/telemetry/error-report.ts#L179)

The duplicate-suppression window is keyed on a fingerprint that includes the caller-supplied
`summary`. Controlled A/B on the live rig, everything else byte-identical:

```
identical summary ×10  →  rows 4320 → 4321   (9 suppressed — the window works)
unique   summary ×10   →  rows 4321 → 4331   (0 suppressed)
```

The route's comment claims "the duplicate window bounds how many rows the table can gain". It does
not. Unauthenticated, `account_id NULL`, with attacker-chosen `boundary`, `routePath` and
`errorName` — so the telemetry a coach would consult during an incident can also be fabricated.

*(The rate-limit bypass reported alongside this is rig-specific: on Vercel, `x-vercel-forwarded-for`
is set by the platform and read first, so header rotation does not work there. Downgraded to §6.1.)*

**Fix.** Add an absolute per-window insert ceiling that does not depend on caller entropy, and
bucket the summary coarsely in the fingerprint rather than using it verbatim.

---

## 6. P3

**6.1 IP header trust** ([lib/auth/security-context.ts:25](../../lib/auth/security-context.ts#L25)) —
`x-vercel-forwarded-for ?? cf-connecting-ip ?? x-forwarded-for ?? "unknown"`, with no trusted-proxy
allow-list and no socket-peer fallback. Not exploitable on Vercel, where the platform sets the first
header. It is exploitable on any self-hosted or bare `next start` deployment, where 300 requests
with rotating `x-forwarded-for` produced 300 × 204 and 300 rows. Gate the header chain on an env var
naming the one header this deployment's proxy actually sets; read nothing when it is unset.

**6.2 No security response headers** — no CSP, HSTS, X-Frame-Options/`frame-ancestors`,
Referrer-Policy or X-Content-Type-Options on any HTML response, including the sign-in page. Add them
in `next.config.ts`; `frame-ancestors 'none'` and `Referrer-Policy: same-origin` are free.

**6.3 No erasure path** — archiving keeps DOB, contacts and coach narrative forever, and abandoned
registration challenges are never pruned. For data about minors this is the difference between a
retention policy and an accumulation. Add a scheduled prune for consumed/expired challenges and
`auth_login_attempts`, and a real erase for an archived member.

**6.4 `localStorage` survives sign-out** — coach report drafts (free-text assessment about a named
child), the resume pointer and attendance marks persist for 7 days across sign-out on a shared
device. Clear them on sign-out.

**6.5 Admin-preview gate keys on presence, not validity** — a planted `smba_admin_preview` cookie
flips the read-only branch without being a valid token. Harmless today (the impersonation branch
requires `platform_admin`), but it is the wrong predicate. Verify the signature before acting on it.

**6.6 Identity DTO over-serialized** — student and admin layouts pass the whole identity object into
a client component that declares three fields. Pass the three.

**6.7 Telemetry redaction gaps** — `sanitizeFailureText` has no phone-number rule at all and misses
base64/JWT/hex tokens and lowercase/legacy Academy IDs. No leak was demonstrated, but the redactor
is the control and it is incomplete for Indian mobile formats.

**6.8 CI** — no dependency-vulnerability gate (the merge gate cannot fail on a new advisory);
`preview-smoke` treats any branch head in this repo as reviewed code, so an unreviewed Dependabot
branch is handed the automation bypass secret; every destructive confirmation token is a
compile-time constant published in this public repo.

---

## 7. Splitting sensitive data into its own table

This is the design you asked for. The short answer first.

### 7.1 A one-way hash is the wrong tool for what you want to protect

Hashing is right when you only ever **compare** a value and never need it back. Passwords, PINs and
codes are already hashed here, correctly.

Every column you want to protect fails that test, because the product must show the value:

| Column | Where the original value is needed |
|---|---|
| `accounts.full_name` | every coach screen; both CSV exports; the session identity on every request |
| `accounts.contact_email` | displayed on the approval screen; a code is mailed to it |
| `accounts.contact_phone` | displayed as "Contact mobile" — the point is that a coach dials it |
| `accounts.date_of_birth` | displayed on the approval screen |
| `player_enrollments.primary_contact_{name,phone,relationship}` | read back into the member record and re-submitted on every edit |
| `auth_recovery_emails.email` | must be **masked** (`ra••••@gmail.com`), which needs both halves |

Hash any of these and the value is gone forever. **Your instinct to split the table is right** — it
is real defence in depth — but the split must carry **encryption**, not a hash:

- **AES-256-GCM** for the values, key in custody separate from the database token.
- **A keyed blind index** (`HMAC-SHA256`) as a *side-car column*, only where SQL filters by value.
- **One-way hashing** only where the value is never needed back — already done.

### 7.2 What actually filters by value — this is what decides the design

Exhaustive grep across `lib`, `app`, `scripts`. **Exactly three** SQL predicates compare an address:

1. `lib/auth/recovery-service.ts:341` — confirming a verification code
2. `lib/auth/recovery-service.ts:524` — the resend cooldown (§5.1)
3. `lib/auth/recovery-service.ts:767` — the recovery join proving the caller owns the address

Everything else about contacts is compared **in application memory** and is therefore transparent to
encryption. And `grep -rnE '(eq|ne|like|inArray)\(\s*accounts\.(contactEmail|contactPhone|dateOfBirth|fullName)'`
returns **nothing** — no predicate at all on the account-level contact columns.

**One site cannot be served by a blind index and must move first:** the substring `LIKE` on
`accounts.full_name` in the coach finance search (`lib/finance/repository.ts:1147`). A blind index
matches whole values, never substrings. The codebase already does the in-memory equivalent for the
sibling read at `lib/finance/records.ts:194`, and the query already `.all()`s every row — so filter
decrypted names in the pass that exists, and land that change *before* the encryption change so the
two can be reviewed apart.

Same for `ORDER BY`: ten sort sites use `accounts.full_name` / `normalized_name`, and **every one
already materialises the full result set** with no SQL `LIMIT` depending on the order. Sorting moves
into the application for free.

### 7.3 Two columns need no crypto at all — just a different value

- **`accounts.normalized_name`** is a second plaintext copy of the child's name whose only job in
  the entire codebase is `ORDER BY`. No `WHERE`, `JOIN`, `GROUP BY` or `DISTINCT` anywhere. The
  registration identity key does **not** read it — it recomputes from the submitted name. Drop the
  column and sort in the application. *(A verifier disputed the P1 rating here; the factual claim —
  sort-only — held.)*
- **`auth_users.name`** is a **third** plaintext copy of every child's real name that no application
  code ever reads back. Write the Academy ID there instead:
  `UPDATE auth_users SET name = display_username`. A column nothing reads should not be
  re-derivable at all. *(By contrast `auth_users.email` is synthetic —
  `<accountId>@accounts.smba.invalid` — and needs no treatment.)*

### 7.4 The shape

One table, keyed on `account_id`, matching the existing 1:1 pattern (`coach_profiles`,
`auth_credential_states`). Both sets must move: `accounts.contact_*` is populated on only **1 of 108**
rows (self-registered accounts only), while `player_enrollments.primary_contact_*` is populated on
**100 of 100** — a coach-entered player's guardian phone lives there. Split only one and you cover
1% of the phone numbers.

```sql
CREATE TABLE `account_personal_details` (
  `account_id` text PRIMARY KEY NOT NULL,
  `full_name_cipher` text, `contact_email_cipher` text, `contact_phone_cipher` text,
  `date_of_birth_cipher` text, `guardian_name_cipher` text, `guardian_phone_cipher` text,
  `guardian_relationship_cipher` text,
  `key_version` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL, `updated_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`)
);
ALTER TABLE `auth_email_challenges` ADD `email_index` text;   -- blind index
ALTER TABLE `auth_recovery_emails`  ADD `email_index` text;   -- NON-unique: siblings share an address
```

**Key custody.** `BETTER_AUTH_SECRET` is the wrong key — it is already load-bearing for session
signing, the admin-preview HMAC, the audit hashes and the challenge digests. Introduce
`SMBA_PII_KEY` (32 bytes) and derive per-purpose subkeys with HKDF:

```
k_enc = HKDF(SMBA_PII_KEY, salt="smba-pii-v1", info="aes-gcm:"      + column)
k_bi  = HKDF(SMBA_PII_KEY, salt="smba-pii-v1", info="blind-index:"  + column)
```

**Bind the AAD to the row and column** — `"account_personal_details:full_name:" + accountId`.
Without it, anyone with write access can move one child's ciphertext onto another child's row and
the application decrypts it happily. That is the attack the split otherwise invites.

Be honest about the limit: on Vercel a second env var read by the same runtime is *organisational*
separation, not cryptographic. It defends against a leaked database token — which is exactly the
threat in §3.1 — and not against code execution in the app.

### 7.5 It cannot be one migration

SQLite has no AES and no HMAC, so no `.sql` file can move the data, and migrations here land with
the deploy while old and new code are briefly both live. **Expand → backfill → contract, three
deploys:** add the table and index columns (nullable); deploy code that writes both and reads
ciphertext-if-present; run a Node backfill script; then deploy code that reads only the new columns;
then drop the old ones.

**The cheapest, highest-value part:** `report_publications.report_text`, `monthly_reports.draft_text`
and both `internal_note` columns are never filtered, sorted or grouped in SQL. They need **no blind
index and no query changes at all** — four read sites and two writers. That is the most sensitive
data in the database and the least work to protect.

---

## 8. Remediation plan

**Before the next deploy (P0/P1)**

1. Delete the 15 live backup artifacts; rotate `SMBA_BACKUP_PASSPHRASE`; remove the
   `upload-artifact` steps from both workflows. *(§3.1)*
2. Key the login block on `subject+ip` so a stranger cannot lock an account out. *(§4.1)*
3. Either delete `app/api/auth/[...all]/route.ts` or fix `auth_rate_limits` **together with** the
   `/sign-in/email` matcher and `disabledPaths`; dedupe the server error recorder. *(§4.2)*
4. Scope the registration resend cooldown to `(address, identity)`. *(§5.1)*

**Defence in depth, next**

5. Revoke the PIN on password change and session revocation; make first-time setup a step-up. *(§5.2)*
6. Security response headers. *(§6.2)* — an afternoon, and it closes four findings.
7. Per-window insert ceiling on `/api/client-errors`. *(§5.4)*
8. Gate the forwarded-IP header on explicit configuration. *(§6.1)*
9. **Encryption at rest**, in the order of §7: move the `LIKE` in-memory → expand → backfill →
   contract. Start with the free-text report columns.
10. Retention and erasure: prune consumed challenges and login attempts; erase an archived member.
11. Least-privilege database token: the snapshot job needs read-only; only migrations need write.
12. CI: add an `npm audit` gate; stop `preview-smoke` trusting Dependabot branches.

**Regression tests worth adding, so each P0/P1 cannot silently return**

| Test | Asserts |
|---|---|
| `tests/login-lockout.test.ts` | five failures from IP-A leave a correct credential from IP-B able to sign in |
| `tests/auth-router-http.test.ts` | `GET /api/auth/ok` returns 200; repeated sign-ins eventually 429. **Nothing exercises `auth.handler` over HTTP today — that is how §4.2 shipped** |
| `tests/operational-events-bound.test.ts` | N identical unauthenticated faults add ≤1 row |
| extend `registration-attack-regressions` | a junk-name send never suppresses the real identity's code *(the inverse of the existing case, which correctly forbids the address ceiling)* |
| `tests/pin-revocation.test.ts` | password change and "log out other devices" both remove the PIN |
| `tests/client-error-ceiling.test.ts` | 500 unique-summary posts add ≤ the window ceiling |
| a workflow assertion | no `upload-artifact` step names a production snapshot |
