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

Vercel runs `vercel-build` for every deployment, production and preview alike. It runs `next build`
first and only then `db:prepare:empty`, which migrates and seeds whichever database
`TURSO_DATABASE_URL` names, so a failed build leaves the database alone. Keep every migration safe for
the version before it (remove or rename only in a later release). The academy database must be
reachable from Production only:

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

`GET /api/health` performs a read-only database query that reads one batch row, so it reports 503 for
a database that cannot be reached and also for one that was never set up (no tables, or tables but no
academy set-up). It returns only `{"status":"ok"}` or a generic 503 response and is never cached. It does
not expose counts, credentials or provider names.

`.github/workflows/production-health.yml` checks the database probe, public homepage identity and login
page once per hour without authenticating or mutating data. The scheduled probe retries three times.
After a trusted Vercel Production deployment, `.github/workflows/production-alerts.yml` checks the
canonical domain up to 12 times and synchronizes the `Production health` issue within minutes. Preview,
transitional, forged-actor and non-`main` deployment events are ignored. The workflow checks out the
default branch rather than event-controlled deployment code.

`.github/workflows/operations-monitor.yml` checks sanitized server-error counts, authentication-email
API failures, repeated login lockouts, backup age and restore-verification age
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

Every night at 02:47 IST, `.github/workflows/encrypted-production-backup.yml` snapshots the production
database, encrypts it with GnuPG AES-256 and keeps it for 30 days as a draft release in a **separate
private GitHub repository** (the backup store), never as an artifact of this public repository. It
refuses to upload unless the store is private, and pruning never removes the newest complete backup.
Until the store is set up the nightly run fails at its first step without reading the database. Set it
up once:

1. On GitHub, create a new **private** repository named `smba-backups` under the same account as this
   one, and tick **Add a README file** (the store needs one commit). To use another name, also add a
   repository *variable* (not a secret) `SMBA_BACKUP_STORE_REPOSITORY` here set to `owner/name`.
2. Create a fine-grained personal access token: **Repository access: Only select repositories**, the
   store only; **Repository permissions: Contents: Read and write**. Give it an expiry you will
   remember (a year at most), and renew it before then; the nightly run fails plainly when it lapses.
3. In this repository, under **Settings, Secrets and variables, Actions**, add these secrets:
   - `SMBA_BACKUP_STORE_TOKEN`: the token from step 2;
   - `SMBA_BACKUP_DATABASE_URL`: production Turso database URL;
   - `SMBA_BACKUP_DATABASE_TOKEN`: database-scoped read-only token created with
     `turso db tokens create <database-name> --read-only`; and
   - `SMBA_BACKUP_PASSPHRASE`: a unique random passphrase of at least 24 characters, stored in a
     separate password manager and never in the repository, the store or Vercel. Without it no backup
     can be decrypted, so keep a second copy somewhere safe.
4. Run **Encrypted production backup** by hand and check it succeeds, then run **Encrypted backup
   restore verification** by hand once. After that both run on their own.

Never make the store public or reuse its token elsewhere. Deleting a backup from the store by hand is a
data-recovery decision, not housekeeping.

The operations monitor shares only the two read-only database secrets. It cannot change academy data.

### Automated stored-backup restore verification

`.github/workflows/encrypted-backup-restore.yml` fetches the newest complete backup from the store on
the first day of each month at 10:17 IST, decrypts it in a mode-0700 runner directory, verifies the
archive, manifest, checksum, row counts, integrity and foreign keys, migrates a copy and boots the
application on it for health and login smoke checks. It receives only the store token and
`SMBA_BACKUP_PASSPHRASE`, always removes decrypted material, and a manual run may name a stored backup.

Operations Monitor fails when the latest successful backup run is older than 30 hours or the latest
restore check is older than 35 days. It only warns until the first backup is stored, and counts only
runs from 13 November 2026 onward, when backups started going to the private store.

### Quarterly remote restore drill

Record completed exercises in `docs/RESTORE-DRILL-LOG.md`.

1. Confirm the latest nightly backup and monthly stored-backup restore check are green.
2. Download one encrypted backup from the store's **Releases** page (the drafts are listed there for
   the owner) and decrypt it outside the repository only when the quarterly remote drill requires it:
   `gpg --output smba-restore.tar.gz --decrypt smba-backup-<time>.tar.gz.gpg`, then extract it into a
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
rows into a new mode-0600 local SQLite file. It
deletes everything except the platform owner (named the same way as `scripts/database/reset-academy.ts`
names it: the one approved, unarchived `platform_admin` signing in as `SMBA-ADMIN-0001`) and what that
account signs in with — password, PIN, recovery email, academy ID allocation — plus the batch catalogue
and the update history. Like the "Empty the academy" workflow, it removes the owner's authenticator, so
the outgoing operator's phone stops producing the owner's codes and the next holder pairs their own.
It verifies the result holds exactly one account, no authenticator, zero coaches and zero players,
checks integrity and foreign keys, and deletes the file again if any of that fails.

```bash
TURSO_DATABASE_URL=<academy database> TURSO_AUTH_TOKEN=<read token> \
  SMBA_CONFIRM_ADMIN_ONLY_SNAPSHOT=PREPARE-ADMIN-ONLY-SNAPSHOT \
  node scripts/deployment/prepare-admin-only-snapshot.mjs .data/backups/smba-admin-only-YYYY-MM-DD.db
```

`reset-empty-academy.mjs` is the destructive half: it DELETEs every row of every table in the database
`TURSO_DATABASE_URL` names, except the update history, and re-inserts the source, after writing and
integrity-checking a local backup that is the only recovery path from a mistake here. It refuses,
changing nothing, unless the source is a zero-member academy with no authenticator and the live
database still has the same tables, indexes, update history and owner as the source.

```bash
TURSO_DATABASE_URL=<academy database> TURSO_AUTH_TOKEN=<write token> \
  SMBA_CONFIRM_REMOTE_EMPTY_RESET=RESET-TO-EMPTY-ACADEMY \
  node scripts/deployment/reset-empty-academy.mjs \
    .data/backups/smba-admin-only-YYYY-MM-DD.db .data/backups/smba-pre-reset-YYYY-MM-DD.db
```

1. Take a fresh `npm run db:snapshot:create` snapshot and keep it in private storage. If you run the
   reset from the "Empty the academy" workflow instead, it keeps no copy of its own: it refuses unless
   the private backup store holds a backup from the last 30 hours, and anything saved since that backup
   is not in it, so run "Encrypted production backup" by hand just before. Tick `backup_confirmed` only
   once that run has finished. The script's own backup is an undo, not the record of what the academy held.
2. Build the source with `prepare-admin-only-snapshot.mjs` against the same database you are about to
   reset. Building it elsewhere replaces the owner's credentials, and a schema that differs by one
   table aborts the reset.
3. Run the reset when nobody is using the site: anything saved while the script copies the live
   database is in neither copy. Keep its JSON output — backup path, rows backed up, rows restored and
   the re-read remote counts — with the change record.
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
6. Sign-in security events are deleted automatically after 180 days. If an incident may stay open
   longer than that, take a `npm run db:snapshot:create` snapshot while the events still exist and keep
   it, encrypted, with the incident record.

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
