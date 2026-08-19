# SMBA production operations

This runbook covers the production controls around `https://smbaacademy.in`. It does not replace
the application-level audit trail or the head coach's operating process.

## Deployment gate

`.github/workflows/quality.yml` runs on every pull request and every push to `main`. It checks:

- ESLint and TypeScript;
- Drizzle migration consistency;
- the complete Vitest suite;
- clean, demo, edge-case and stress database construction and verification;
- a production Next.js build; and
- responsive authentication E2E against an isolated stress database.

Vercel still deploys `main` automatically. For a strict pre-deployment gate, protect `main` in
GitHub, require the `Application regression` check, and merge through a pull request. Direct pushes
start Vercel and GitHub Actions at the same time and therefore are not a true gate.

## Availability monitoring

`GET /api/health` performs a read-only database query. It returns only `{"status":"ok"}` or a
generic 503 response and is never cached. It does not expose counts, credentials or provider names.

`.github/workflows/production-health.yml` checks the database probe and public login page once per
hour without authenticating or mutating data. A failed run appears in GitHub Actions. GitHub
notifications should be enabled for failed Actions runs. For faster paging, connect the same URL to
an external uptime service later.

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

### Quarterly restore drill

1. Create and verify a fresh logical snapshot.
2. Create a disposable Turso database from the snapshot or from a chosen PITR timestamp.
3. Use a temporary deployment or local environment to run migrations, `/api/health`, the fixture
   verifier where applicable, and a read-only login-page smoke check.
4. Record the timestamp, selected recovery point, result and operator.
5. Delete the disposable database only after the result has been recorded and the production
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
