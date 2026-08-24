# SMBA production operations

This runbook covers the production controls around `https://smbaacademy.in`. It does not replace
the application-level audit trail or the head coach's operating process.

## Deployment gate

`.github/workflows/quality.yml` runs on every pull request and every push to `main`. It isolates
static validation, Vitest, and browser regression work on separate pinned runners so database setup
and production builds cannot starve the unit-test worker pool. It checks:

- ESLint and TypeScript;
- Drizzle migration consistency;
- the complete Vitest suite, with ordinary tests bounded to two workers and the fixture lifecycle
  suite run separately on one worker;
- clean, demo, edge-case and stress database construction and verification;
- a production Next.js build; and
- registration and activation E2E against an isolated clean database, plus responsive authentication,
  onboarding and attendance E2E against an isolated stress database.

The final `Application regression` job is a stable aggregate check and passes only when all three
isolated jobs pass. Browser failures retain only masked PNG files and sanitized text/JSON evidence for
14 days. Passwords, PINs, recovery material, inputs and QR codes are masked; raw traces, video, HTML
reports, reporter JSON, databases and storage state are never uploaded. Successful runs upload no
diagnostic artifact.

Vercel deploys `main` automatically. Merge through a pull request so the required `Application
regression` and `UI accessibility / WCAG 2.2 AA` checks complete before a production deployment.

`main` is protected with strict status checks, administrator enforcement, pull requests, linear history,
conversation resolution and force-push/deletion prevention. Do not weaken those rules to bypass a failure.

## Environment separation

Vercel runs `vercel-build` for every deployment, production and preview alike, and its
`db:prepare:empty` step migrates and seeds whichever database `TURSO_DATABASE_URL` names in that
environment. The academy database must therefore be reachable from Production only:

| Variable | Production | Preview | Development |
| --- | --- | --- | --- |
| `TURSO_DATABASE_URL` | academy database | preview database, otherwise unset | unset |
| `TURSO_AUTH_TOKEN` | academy database | preview database, otherwise unset | unset |
| `SMBA_ALLOW_REMOTE_DB_MIGRATION` | unset | `true` only when Preview owns a disposable database | unset |

The Turso Marketplace integration owns the two database variables. Scoping them means installing a
separate integration resource per environment, or overriding the integration's values with
manually-created Production-scoped variables. Confirm in the Vercel dashboard which of the two applies
before editing; a variable the integration still manages can be rewritten on its next sync.

`remoteDatabasePreparationBlocked()` in `lib/db/setup.ts` is the defence in depth behind that scoping.
A Vercel deployment that is not `VERCEL_ENV=production` skips migration and seeding whenever it holds
remote database credentials, unless that environment sets `SMBA_ALLOW_REMOTE_DB_MIGRATION=true` to
declare the database its own. The build itself does not need a prepared database — every
database-backed route is server-rendered on demand — so a skipped preparation still produces a
reviewable preview deployment. Local development, CI and the restore drills are unaffected because
they set no `VERCEL` variable.

A preview database is populated from a synthetic fixture, never from academy data:

```bash
npm run preview:seed:turso
```

## Availability monitoring

`GET /api/health` performs a read-only database query. It returns only `{"status":"ok"}` or a
generic 503 response and is never cached. It does not expose counts, credentials or provider names.

`.github/workflows/production-health.yml` checks the database probe, public homepage identity and login
page once per hour without authenticating or mutating data. The scheduled probe retries three times.
After a trusted Vercel Production deployment, `.github/workflows/production-alerts.yml` checks the
canonical domain up to 12 times and synchronizes the `Production health` issue within minutes. Preview,
transitional, forged-actor and non-`main` deployment events are ignored. The workflow checks out the
default branch rather than event-controlled deployment code.

`.github/workflows/operations-monitor.yml` checks sanitized server-error counts, authentication-email
API failures, repeated login lockouts, backup age, restore-verification age and artifact availability
twice per hour. `.github/workflows/production-alerts.yml`
turns failed default-branch quality, accessibility, health, monitoring, backup and production-deployment
events into one assigned, deduplicated `production-alert` issue. Pull-request and fork runs cannot open or
resolve production incidents. A successful default-branch recovery closes the corresponding issue. The repository
owner must keep GitHub issue and Actions email or mobile notifications enabled.
Test delivery quarterly by manually running `Production alerts` with `open`, confirming the assigned issue
notification arrives, and immediately running it again with `resolved`.

Manual check:

```bash
npm run ops:smoke -- https://smbaacademy.in --attempts 3 --delay-ms 5000
```

Vercel's Production Branch must remain `main`. GitHub's `Production` environment is restricted to
`main` without a manual reviewer. If Vercel's SHA-based deployment reference is ever rejected by that
environment policy, remove only the GitHub environment branch policy, retain Vercel's restriction and
the workflow's runtime SHA-ancestry validation, and record the integration limitation here.

## Database recovery

Turso creates point-in-time recovery data automatically at commits. The free plan currently keeps a
24-hour recovery window; longer retention depends on the Turso plan. A point-in-time restore creates
a **new** database, after which Vercel must be switched to its new URL and token. Never test a restore
over the live database.

SMBA also includes a provider-independent, read-only logical snapshot tool:

```bash
npm run db:snapshot:create -- .data/backups/smba-YYYY-MM-DD.db
npm run db:snapshot:verify -- .data/backups/smba-YYYY-MM-DD.db
```

The command reads `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, refuses to overwrite an existing
snapshot, copies schema and rows, checks SQLite integrity and foreign keys, and writes a SHA-256
manifest. Prefer a database-scoped, read-only Turso token (`turso db tokens create <database>
--read-only`) for this job.

The snapshot contains personal, financial and authentication data. It must never be committed,
emailed or uploaded unencrypted. Store an encrypted copy in an access-controlled backup vault and
keep its decryption key in a separate password manager.

### Scheduled encrypted backups

`.github/workflows/encrypted-production-backup.yml` creates and verifies a logical snapshot every day at
08:17 IST,
encrypts the database and manifest with GnuPG AES-256 before upload, removes every plaintext runner copy,
and retains the encrypted artifact for 35 days (approximately 35 daily restore points). A repository
administrator who deletes workflow runs can also delete their artifacts; GitHub-only storage is the
accepted boundary for this phase. Configure these GitHub Actions secrets:

- `SMBA_BACKUP_DATABASE_URL`: production Turso database URL;
- `SMBA_BACKUP_DATABASE_TOKEN`: database-scoped read-only token created with
  `turso db tokens create <database-name> --read-only`; and
- `SMBA_BACKUP_PASSPHRASE`: a unique random passphrase of at least 24 characters, stored in a separate
  password manager and never in the repository or Vercel.

The operations monitor shares only the two read-only database secrets. It cannot change academy data.
Trigger the workflow manually after configuring the secrets and retain its successful run as the first
backup record.

### Automated stored-artifact restore verification

`.github/workflows/encrypted-backup-restore.yml` downloads the newest successful, unexpired `main`
backup on the first day of each month at 10:17 IST. It validates the selected run and artifact, decrypts
inside a mode-0700 runner directory, rejects unsafe or unexpected archive entries, verifies the manifest,
checksum, row counts, integrity and foreign keys, migrates a copy, builds against a separate empty
database, and boots the application against the restored copy for health and login smoke checks. The
workflow receives only `SMBA_BACKUP_PASSPHRASE`, never production database credentials, and always
removes decrypted material. A manual run may select a specific successful backup workflow run ID.

Operations Monitor fails when the latest successful backup is older than 30 hours, the latest successful
stored-artifact restore is older than 35 days, or the referenced artifact is missing or expired.

### Quarterly remote restore drill

Record completed exercises in `docs/RESTORE-DRILL-LOG.md`.

1. Confirm the latest automated daily backup and monthly stored-artifact restore are green.
2. Download one encrypted workflow artifact and decrypt it outside the repository only when the
   quarterly remote drill requires it:
   `gpg --output smba-restore.tar.gz --decrypt smba-production-<run>.tar.gz.gpg`, then extract it into a
   temporary directory and run `npm run db:snapshot:verify -- <snapshot> <manifest>`.
3. Create a disposable Turso database from the snapshot or from a chosen PITR timestamp. This remains
   manual because automating database creation and deletion would require a write-capable management token.
4. Use a temporary deployment or local environment to run migrations, `/api/health`, the fixture
   verifier where applicable, and a read-only login-page smoke check.
5. Record the timestamp, selected recovery point, result and operator.
6. Delete the disposable database only after the result has been recorded and the production
   database URL has been double-checked.

## Resetting the academy to an empty state

Two `scripts/deployment` commands cover the one operation with no self-service equivalent: returning
the live academy to zero members while keeping the platform owner able to log in. They are manual by
design, wired into no npm script and no workflow, and neither starts without its own confirmation
variable. `reset-empty-academy.mjs` needs a write-capable Turso token, so that step is the one procedure
that cannot run on the read-only backup credentials. `prepare-admin-only-snapshot.mjs` only reads
from the remote and should be given a read token.

`prepare-admin-only-snapshot.mjs` is read-only against the remote database. It clones the schema and
rows into a new mode-0600 local SQLite file, deletes everything except the single active
`platform_admin` account and the material that account logs in with — PIN, recovery email, verified
authenticator, academy ID allocation — plus the batch catalogue, verifies the result holds exactly one
account and zero coaches and zero players, checks integrity and foreign keys, and deletes the file
again if any of that fails.

```bash
TURSO_DATABASE_URL=<academy database> TURSO_AUTH_TOKEN=<read token> \
  SMBA_CONFIRM_ADMIN_ONLY_SNAPSHOT=PREPARE-ADMIN-ONLY-SNAPSHOT \
  node scripts/deployment/prepare-admin-only-snapshot.mjs .data/backups/smba-admin-only-YYYY-MM-DD.db
```

`reset-empty-academy.mjs` is the destructive half. It DELETEs every row of every table in the database
`TURSO_DATABASE_URL` names and re-inserts the source, so against production it destroys every account,
enrollment, attendance mark, fee, payment and refund the academy holds. Before the first delete it
requires the source to already be a zero-member academy, requires the two schemas to name exactly the
same tables, and writes and integrity-checks a complete local backup of the remote. That backup is the
only recovery path from a mistake here; give it a durable location and handle it as a snapshot.

```bash
TURSO_DATABASE_URL=<academy database> TURSO_AUTH_TOKEN=<write token> \
  SMBA_CONFIRM_REMOTE_EMPTY_RESET=RESET-TO-EMPTY-ACADEMY \
  node scripts/deployment/reset-empty-academy.mjs \
    .data/backups/smba-admin-only-YYYY-MM-DD.db .data/backups/smba-pre-reset-YYYY-MM-DD.db
```

1. Confirm the latest automated daily backup is green and take a fresh `npm run db:snapshot:create`
   snapshot as well. The script's own backup is an undo, not the record of what the academy held.
2. Build the source with `prepare-admin-only-snapshot.mjs` against the same database you are about to
   reset. Building it elsewhere replaces the owner's credentials, and a schema that differs by one
   table aborts the reset.
3. Run the reset and keep its JSON output — backup path, rows backed up, rows restored and the
   re-read remote counts — with the change record.
4. Log in as the platform owner, confirm the academy is empty, and only then delete either file.

Both files contain authentication material. They must never be committed, emailed or stored
unencrypted, and the same vault rules as `npm run db:snapshot:create` apply.

## Incident order

1. Stop making data changes and record the time the problem was first observed.
2. Check Vercel deployment state, GitHub `Production health`, Resend delivery logs and Turso status.
3. If the latest deployment is at fault, promote the last known-good Vercel deployment without
   changing the database.
4. If data is at fault, create a new PITR database from immediately before the incident and verify it
   before changing Vercel environment variables.
5. Rotate any exposed token, revoke sessions when account security is affected, and record the
   recovery action in the incident log.

## Account recovery boundary

- Players and junior coaches recover through their verified email.
- Head coaches require verified email plus authenticator or a backup code.
- A head coach who has lost the authenticator and backup codes can submit a verified recovery request
  for platform-owner approval and then reconnect a new authenticator.
- Losing the platform owner's verified email, authenticator and every backup code has no
  self-service bypass. Store the owner's backup codes offline. A separately authorized operator
  recovery procedure must be designed before delegating platform ownership.

## Secrets

Keep `BETTER_AUTH_SECRET` stable. Losing or rotating it invalidates encrypted TOTP material and signed
sessions. Production database, Resend and authentication secrets belong in Vercel. Backup credentials
must be read-only and separate from the application's write token.
