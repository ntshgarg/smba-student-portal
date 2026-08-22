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
isolated jobs pass. Vercel still deploys `main` automatically. For a strict pre-deployment gate,
protect `main` in GitHub, require `Application regression`, and merge through a pull request. Direct
pushes start Vercel and GitHub Actions at the same time and therefore are not a true gate.

`main` is protected with strict status checks, administrator enforcement, pull requests, linear history,
conversation resolution and force-push/deletion prevention. Do not weaken those rules to bypass a failure.

## Availability monitoring

`GET /api/health` performs a read-only database query. It returns only `{"status":"ok"}` or a
generic 503 response and is never cached. It does not expose counts, credentials or provider names.

`.github/workflows/production-health.yml` checks the database probe and public login page once per
hour without authenticating or mutating data. A failed run appears in GitHub Actions. GitHub
notifications should be enabled for failed Actions runs. For faster paging, connect the same URL to
an external uptime service later.

`.github/workflows/operations-monitor.yml` checks sanitized server-error counts, authentication-email
API failures and repeated login lockouts twice per hour. `.github/workflows/production-alerts.yml`
turns failed quality, health, monitoring, backup and production-deployment events into one assigned,
deduplicated `production-alert` issue. A successful recovery closes the corresponding issue. The repository
owner must keep GitHub issue and Actions email or mobile notifications enabled.
Test delivery quarterly by manually running `Production alerts` with `open`, confirming the assigned issue
notification arrives, and immediately running it again with `resolved`.

Manual check:

```bash
npm run ops:smoke -- https://smbaacademy.in
```

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

`.github/workflows/encrypted-production-backup.yml` creates and verifies a logical snapshot every Sunday,
encrypts the database and manifest with GnuPG AES-256 before upload, removes every plaintext runner copy,
and retains the encrypted artifact for 35 days. Configure these GitHub Actions secrets:

- `SMBA_BACKUP_DATABASE_URL`: production Turso database URL;
- `SMBA_BACKUP_DATABASE_TOKEN`: database-scoped read-only token created with
  `turso db tokens create <database-name> --read-only`; and
- `SMBA_BACKUP_PASSPHRASE`: a unique random passphrase of at least 24 characters, stored in a separate
  password manager and never in the repository or Vercel.

The operations monitor shares only the two read-only database secrets. It cannot change academy data.
Trigger the workflow manually after configuring the secrets and retain its successful run as the first
backup record.

### Quarterly restore drill

Record completed exercises in `docs/RESTORE-DRILL-LOG.md`.

1. Create and verify a fresh logical snapshot.
2. Download one encrypted workflow artifact and decrypt it outside the repository:
   `gpg --output smba-restore.tar.gz --decrypt smba-production-<run>.tar.gz.gpg`, then extract it into a
   temporary directory and run `npm run db:snapshot:verify -- <snapshot> <manifest>`.
3. Create a disposable Turso database from the snapshot or from a chosen PITR timestamp.
4. Use a temporary deployment or local environment to run migrations, `/api/health`, the fixture
   verifier where applicable, and a read-only login-page smoke check.
5. Record the timestamp, selected recovery point, result and operator.
6. Delete the disposable database only after the result has been recorded and the production
   database URL has been double-checked.

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
