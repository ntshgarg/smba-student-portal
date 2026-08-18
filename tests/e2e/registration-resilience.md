# Registration resilience browser regression

This focused suite permanently covers registration idempotency and recoverable transport failures.
It deliberately has no Playwright-managed `webServer`; the caller must start a production build against
a fresh disposable clone of the Clean database.

## Safety contract

- `SMBA_REGISTRATION_RESILIENCE_DB` must be an absolute path outside the project's `.data` directory.
- The database must contain only the approved head coach before the run.
- Symlinks and hard links back to a canonical `.data/*.db` file are rejected.
- The server must use a loopback URL with an explicit port other than `3000`.
- The database path supplied to Playwright must be the same path supplied to the external server as
  `DB_FILE_NAME`.

## Example

Create the disposable clone with SQLite's online backup facility while opening the canonical source
read-only, then start the already-built app:

```sh
mkdir -p /private/tmp/smba-registration-resilience
sqlite3 -readonly .data/academy-clean.db \
  ".backup '/private/tmp/smba-registration-resilience/clean.db'"
```

```sh
SMBA_REQUIRE_COACH_TOTP=false \
BETTER_AUTH_SECURE_COOKIES=false \
DB_FILE_NAME=/private/tmp/smba-registration-resilience/clean.db \
NEXT_PUBLIC_SMBA_SITE_ORIGIN=https://smba.example.test \
./node_modules/.bin/next start -p 3141
```

In another terminal:

```sh
SMBA_REGISTRATION_RESILIENCE_BASE_URL=http://127.0.0.1:3141 \
SMBA_REGISTRATION_RESILIENCE_DB=/private/tmp/smba-registration-resilience/clean.db \
./node_modules/.bin/playwright test \
  -c tests/e2e/playwright.registration-resilience.config.ts
```

The suite covers:

- empty validation associating its error and returning focus to Full Name without writing;
- two synchronous `requestSubmit()` calls producing one pending account;
- two consecutive intercepted HTTP 503 responses preserving the exact name, writing nothing, then
  succeeding once on retry;
- an action that commits successfully but whose browser response is aborted, followed by an idempotent retry;
- direct SQLite verification of persisted rows, integrity, and foreign keys.

The response-abort case models an ambiguous network outcome at the Server Action boundary. It does not
inject a SQLite failure inside the transaction. Chrome is the permanent automated browser for this suite.
