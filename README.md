# SMBA Website and Portal

One Next.js application for Sathiya Moorthy Badminton Academy's public website,
Player Journal and Coach Workspace.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Application routes

- `/` — public academy website
- `/login` and `/register` — shared portal access
- `/player`, `/player/reports` and `/player/financials` — authenticated Player Journal
- `/coach`, `/coach/calendar`, `/coach/schedules`, `/coach/schedules/new`,
  `/coach/attendance/players/register`, `/coach/attendance/players/record`,
  `/coach/attendance/staff/register`, `/coach/attendance/staff/record`,
  `/coach/attendance/adjustments`, `/coach/reports`, `/coach/financials`,
  `/coach/financials/record`, `/coach/financials/records`, focused player fee records,
  and `/coach/members` — coach-only workspace

The former public `site` project remains in the parent workspace as a temporary rollback copy,
but this application is now the canonical local server.

The implemented finance contracts are recorded in
[`docs/SMBA-Financials-Proposal.txt`](docs/SMBA-Financials-Proposal.txt) (Phase 1) and
[`docs/SMBA-Financials-Phase-2.txt`](docs/SMBA-Financials-Phase-2.txt) (Phase 2), and
[`docs/SMBA-Financials-Phase-3.txt`](docs/SMBA-Financials-Phase-3.txt) (Phase 3).

Copy `.env.example` to `.env.local` for a new environment. Local development uses:

```env
DB_FILE_NAME=.data/academy-empty.db
NEXT_PUBLIC_SMBA_SITE_ORIGIN=http://localhost:3000
SMBA_REQUIRE_COACH_TOTP=true
```

The empty local academy contains only the separately provisioned platform owner
`SMBA-ADMIN-0001`; it has no head coach, junior coaches, or players. Provision
the owner once with `npm run db:provision:admin`, then connect an authenticator
on first login. The owner can then open the one-time first head-coach setup from
`/admin`. Loaded regression profiles use
`SMBA fixture access 2026!`, overridable with `SMBA_FIXTURE_PASSWORD`.

Local `npm run dev` uses the zero-member academy in
`.data/academy-empty.db`. Demo remains the canonical loaded academy for UI and
workflow review. The clean `.data/smba.db` remains an untouched source for
rebuilding fixtures.

`npm run dev` explicitly migrates that local database and preserves its separately
provisioned owner. For another configured database, run
`npm run db:migrate`. Application requests only open an already prepared database;
they never run migrations or seed writes.

### Deterministic academy profiles

```bash
# Build the clean profile, one loaded profile, or every profile.
npm run fixture:build:clean
npm run fixture:build:demo
npm run fixture:build:edge
npm run fixture:build:stress
npm run fixture:build:all

# Verify one profile, or every profile.
npm run fixture:verify:clean
npm run fixture:verify:demo
npm run fixture:verify:edge
npm run fixture:verify:stress
npm run fixture:verify:all

# Serve a selected profile after `npm run build`.
npm run fixture:start:demo
npm run fixture:start:edge
npm run fixture:start:stress
```

- **Clean** is the deterministic legacy fixture with only its test head coach.
- **Demo** is the canonical 40-player academy for loaded-state development and screenshots.
- **Edge** is the compact, feature-diverse profile with supported happy and exceptional paths.
- **Stress** combines the 100-player scale workload with a small, deterministic set of supported variations so large-list and complete-workflow regression can run against the same profile; regression commands remain Stress aliases.

Each build publishes a versioned sibling `.manifest.json` with the exact
migration fingerprint, expected counts, and representative Academy-ID logins.
Builds use isolated temporary databases and
never overwrite `.data/smba.db` or the former regression database.
Stop any server using a named profile before rebuilding it. Publication refuses
to replace a profile while it has an open SQLite file handle and removes only
closed WAL/SHM sidecars immediately before atomic promotion.

Development and tests fall back to `http://localhost:3000` when
`NEXT_PUBLIC_SMBA_SITE_ORIGIN` is omitted. Production builds fail immediately unless
the variable is an explicit absolute HTTPS origin. Production values cannot use
localhost or a loopback address and cannot contain credentials, a query string, a
fragment or a path.

The configured origin is used by canonical metadata, Open Graph URLs, `robots.txt`,
`sitemap.xml` and public structured data. It is never inferred from a request `Host`
header. Keep the locality-only address in structured data until SMBA's full street
address, postal code and coordinates have been verified.

## Remote development preview

The Vercel deployment is available at
[`https://smba-student-portal.vercel.app`](https://smba-student-portal.vercel.app).
Its Turso database is prepared as an empty academy with separate platform-owner
access. Do not import a synthetic Stress fixture into a real academy database.

Vercel injects `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` through its Marketplace
integration. Local development remains on `DB_FILE_NAME` unless
`SMBA_USE_TURSO=true` is explicitly set. To populate a newly provisioned, empty
preview database after pulling Vercel's development environment, run:

```bash
npm run preview:seed:turso
```

The copier omits authentication sessions, one-time codes and security telemetry and refuses to modify a database
containing application data. It accepts either a completely empty database or an
empty schema already prepared by the Vercel build.

Vercel runs migrations and the idempotent reference-data bootstrap as
an explicit build step before starting application functions. Request handling
never migrates or seeds the remote database. The local SQLite database is ignored by Git.

## Authentication and account activation

The platform owner signs in as **`SMBA-ADMIN-0001`** and is not an academy
member. The one-time first coach setup creates **`SMBA-HC-0001`**. Approved
junior coaches receive random `SMBA-JC-0001–SMBA-JC-9999` usernames and players
receive random `SMBA-PL-0001–SMBA-PL-9999` usernames.

Authentication uses the SMBA username plus password. Registration stores a secure,
browser-bound activation receipt; after approval, that browser creates the first
password without a coach-shared code. Players and junior coaches may then add an
optional six-digit PIN. The platform owner is provisioned with an initial password
and mandatory PIN, then connects an authenticator on first login. Both credentials
remain changeable from Account Security. The head coach creates a password and
mandatory PIN during first setup and must connect an authenticator. Password recovery uses a verified email,
revokes existing sessions and removes the PIN. Head-coach and platform-owner resets
also require their existing authenticator or one unused backup code. The platform owner
always requires password or PIN plus authenticator and has audited, read-only dashboard
preview rather than an academy role. Sessions expire after seven days.

When recovery-email enforcement is enabled, an existing platform owner completes
password and authenticator sign-in first, then verifies a recovery address before
opening `/admin`. Verification codes expire after ten minutes; password-reset links
expire after twenty minutes and are invalidated by a newer request. Public recovery
requests deliberately return the same response for unknown, inactive and mismatched
account/email combinations.

Production requires these values:

```env
BETTER_AUTH_SECRET=<at-least-32-random-characters>
SMBA_REQUIRE_COACH_TOTP=true
SMBA_REQUIRE_RECOVERY_EMAIL=true
RESEND_API_KEY=<resend-api-key>
SMBA_AUTH_EMAIL_FROM=SMBA Security <security@your-verified-domain.example>
```

The separately provisioned platform owner then opens the one-time head-coach setup;
the coach verifies a recovery email and enters their
own name, password and PIN. Players and junior coaches verify their recovery email
in the browser that submitted registration. Shared parent email addresses are supported.
Keep `BETTER_AUTH_SECRET` stable and store it in the deployment secret manager;
rotating or losing it invalidates encrypted TOTP material and signed sessions.
Losing access to the verified email, authenticator and all backup codes has no
self-service bypass; a separately designed support workflow is required.

Rebuilding a disposable fixture such as `.data/academy-stress.db` recreates its
authentication rows, including TOTP enrollment. Ordinary logins, application restarts,
migrations and production operation preserve the existing encrypted authenticator secret.

An authenticator app scans a QR code containing a unique TOTP secret. It stores
that secret on the phone and generates a six-digit code roughly every 30 seconds,
even without internet. SMBA stores an encrypted copy and accepts only the current
code after the password or head-coach PIN succeeds. The QR code, secret and
one-use recovery codes must not be shared or photographed.

## Account workflow

1. A player or junior coach requests registration with their full name and retains a secure browser receipt.
2. The request remains pending and cannot sign in.
3. The head coach reviews it in **Coach Workspace → Player onboarding**.
4. Approval allocates a random, permanent `SMBA-JC-xxxx` or `SMBA-PL-xxxx` username; the registration browser can then create the password.
5. A new player begins as **Unassigned**. Approval alone does not make the player attendance-eligible.
6. The coach records one Level, one Weekday or Weekend Batch and an informational Academy Plan, then continues directly to matching recurring-session assignment. Weekday plans require an exact union of 3, 4 or 5 distinct weekdays across active assignments; the first complete assignment makes the player Active.
7. Saved attendance is read from the same database by the player dashboard and coach report workflow.

Duplicate names are allowed. Internal relationships use immutable account UUIDs, never Academy IDs.
Academy IDs are immutable, human-friendly academy identifiers that are never edited or reused. Roster
membership does not depend on an Academy ID authentication method remaining active.

## Data boundaries

- `accounts` represents who a person is.
- `auth_methods` maps Academy IDs to domain accounts. Better Auth credential, TOTP and
  runtime-session tables prove identity and maintain secure sessions.
- `player_enrollments` represents academy participation and the Unassigned / Active / Paused lifecycle.
- Public registration accepts player and junior-coach requests. Both require head-coach approval;
  an approved coach is always created with restricted `junior_coach` access.
- Member archival is non-destructive and available only after active assignments end. It revokes login
  access while preserving the account, Academy ID allocation, attendance, reports and training history.
- Academy Plan represents the enrolled pricing option. It validates the exact 3/4/5-day Weekday union while assignments are created, but it never drives attendance after those assignment weekdays are saved. Weekend remains flexible at one or two days.
- Recurring schedules generate their complete bounded occurrence set in the schedule-creation transaction;
  dashboard, calendar, attendance and report reads never materialize or mutate occurrences. The explicit,
  idempotent legacy backfill treats every existing series/date row—including cancellations—as historical truth.
- Level and Batch determine assignment eligibility; session assignments determine participation.
- players may hold multiple matching, non-overlapping active session assignments, and each assignment owns its effective-dated weekday selection. Each occurrence is counted independently.
- attendance eligibility requires a real, scheduled, non-cancelled occurrence covered by the player's assignment and on or after their joining date.
- late assignment can expose already-existing past occurrences from its effective date, but it never invents sessions or marks them absent automatically.
- attendance uses Asia/Kolkata date-only rules and is committed transactionally against occurrence and player UUIDs.
- unmarked completed sessions remain pending and do not reduce the recorded attendance rate.
- make-up attendance is published as an auditable adjustment against one saved absence. It changes attendance accounting without changing schedules, assignments, rosters, eligibility, or the fixed scheduled denominator; reversals are soft-voided.
- adjustment completion is recorded at date level within the following 14 India-calendar days. If ordinary presence supporting that date is later removed, the adjustment is retained and marked for coach review rather than deleted automatically.
- report drafts can change; every publication is an immutable revision with an append-only versioned attendance snapshot.
- Financials uses an append-only ledger of Fee Agreements, Charges, receipt-level Payments,
  immutable Payment Allocations, Refunds, Refund Allocations, Adjustments, Concessions and audit
  events. Balances and statuses are derived rather than stored, records are never hard-deleted,
  and financial state never controls training, attendance, scheduling, reports or account access.
- Financial tracking begins through one irreversible academy activation. Monthly fees are prepared
  explicitly and idempotently. A receipt can settle multiple Charges, while corrections use explicit
  Payment/Refund reversal, Charge void, Adjustment and Concession facts so the original history
  remains visible. Human receipt and refund references are presentation identifiers; UUIDs remain
  the canonical relationship keys.
- Coach Financial Records provides a calculator-backed Fee Register, Collections Day Book and
  readable Activity History. Private receipt and player-statement PDFs and CSV exports are generated
  on demand and never persisted. Fee Plans end through an explicit effective-dated, audited action;
  restarting creates a new non-overlapping agreement rather than rewriting history.
- business records are never stored in browser local storage. Only the coach's “continue where I left off” hint is local.
- account, attendance and published-report records use archive/status transitions rather than hard deletion.

The repository and session interfaces keep page components independent from SQLite and the Better Auth
adapter. Credential, TOTP and session storage can evolve without changing historical academy records.

## Stress and regression harness

The regression tooling builds deterministic academy profiles beside the clean local database.
It never seeds `.data/smba.db`: targets must be the named Clean, Demo, Edge or Stress database,
or an isolated test database under `.data/regression/`.

```bash
# Clone the clean coach-only database into the Stress profile target.
npm run regression:prepare

# Build the complete 100-player stress state, or stop at an intermediate stage.
npm run regression:seed
npm run regression:fixture -- seed --stage registrations
npm run regression:fixture -- seed --stage enrollments
npm run regression:fixture -- seed --stage schedules

# Recheck domain invariants and fixture repeatability.
npm run regression:verify
npm run regression:test

# Serve the loaded regression database on localhost:3000. Before this step, replace
# the local origin setting with SMBA's final canonical HTTPS origin because `next build`
# runs with production validation.
npm run build
npm run regression:start
```

The loaded fixture contains 100 approved players: 94 active, three paused, two unassigned and one
archived. It also contains three pending player registrations, two junior coaches with forty daily
present/absent staff-attendance facts plus one cleared-state representative (41 records total), eight one-hour sessions
on every weekday, four on every weekend day,
deterministic assignments, July attendance, one active and one voided attendance adjustment, and
cancelled plus cross-weekday replacement-session examples. The report queue contains fifty reports,
thirty-one immutable publications and one multi-revision report. Its complete financial ledger covers
settled, partial and outstanding balances as well as Payment replacement, manual credit/debit,
Refund, Concession and ended/restarted Fee Plan lifecycles. Five announcements cover active and pinned,
Homepage-only, Player Dashboard-only, expired, withdrawn and both-channel presentation states.
Re-running the loaded seed is idempotent and produces the same logical checksum.

With the regression server running, capture the authenticated mobile workspace:

```bash
SMBA_CAPTURE_SCENARIO=loaded \
SMBA_CAPTURE_RUN_LABEL=regression \
SMBA_CAPTURE_REFERENCE_DATE=2026-08-03 \
SMBA_CAPTURE_REPORT_MONTH=2026-07 \
SMBA_CAPTURE_FIXTURE_MANIFEST=.data/regression/loaded-fixture.json \
npm run regression:capture
```

See [`tests/e2e/README.md`](tests/e2e/README.md) for viewport selection, evidence files, strict checks,
and storage-state options. Normal local `npm run dev` uses the Clean database.
The clean `.data/smba.db` remains the fixture source, while `npm run regression:start` selects the
Stress database explicitly.
