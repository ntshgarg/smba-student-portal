# Authenticated mobile capture harness

This harness captures deterministic coach and player UI states without seeding,
editing, or resetting application data. Start the app against an externally
prepared disposable fixture database, then run Playwright from the project root.

```sh
SMBA_CAPTURE_SCENARIO=loaded \
SMBA_CAPTURE_RUN_LABEL=before \
SMBA_CAPTURE_REFERENCE_DATE=2026-08-03 \
SMBA_CAPTURE_REPORT_MONTH=2026-07 \
npx playwright test -c tests/e2e/playwright.config.ts
```

The default output is
`snapshots/mobile-regression/<run-label>/<scenario>/`. Every run writes:

- `screenshots/`: a 390 px primary capture for every selected state, plus
  320/360/430 px captures for critical states. Short pages get a full-page PNG;
  long pages get overlapping numbered segments. A viewport PNG is also kept for
  dialogs, sticky headers, and debugging.
- `evidence/`: one JSON file per state and viewport with console, page-error,
  request-failure, HTTP error, timing, DOM, image, and overflow evidence.
- `manifest.json`: the expected matrix and all produced artifacts.
- `report.json` and `report.md`: regression-friendly summaries.

## Fixture and authentication contract

Supported scenarios are `default`, `staged`, `registrations`, `enrollments`,
`schedules`, and `loaded`. `staged` is a generic orchestration alias; the named
stages map directly to `scripts/regression/fixture.ts`. The harness may consume a
fixture summary written to `SMBA_CAPTURE_FIXTURE_MANIFEST`, but never invokes the
fixture CLI itself.

Storage state is the preferred authentication input:

```sh
SMBA_CAPTURE_COACH_STORAGE_STATE=/absolute/path/coach.json \
SMBA_CAPTURE_PLAYER_STORAGE_STATE=/absolute/path/player.json \
npx playwright test -c tests/e2e/playwright.config.ts
```

If storage state is omitted, the harness signs in through `/login` with
`SMBA_CAPTURE_COACH_ACADEMY_ID` (default `SMBA#0001`) and
`SMBA_CAPTURE_PLAYER_ACADEMY_ID` (default fixture representative `SMBA#0002`).
UI login creates ordinary session records, so this fallback must only be used
against a disposable fixture database. No credential or session token is written
to the capture manifest.

`default`, `registrations`, and generic `staged` default to coach-only captures
because an approved player may not exist. Override actor selection explicitly
when needed:

```sh
SMBA_CAPTURE_ACTORS=coach,player
```

## Useful controls

| Variable | Default | Purpose |
| --- | --- | --- |
| `SMBA_CAPTURE_BASE_URL` | `http://127.0.0.1:3000` | Already-running fixture server |
| `SMBA_CAPTURE_OUTPUT_DIR` | `snapshots/mobile-regression` | Output root |
| `SMBA_CAPTURE_ONLY` | all applicable IDs | Comma-separated capture IDs |
| `SMBA_CAPTURE_STRICT` | `true` | Fail on page/console/network/image/document-overflow evidence |
| `SMBA_CAPTURE_MAX_FULL_PAGE_HEIGHT` | `12000` | Height above which segmented capture is used |
| `SMBA_CAPTURE_MAX_SEGMENTS` | `80` | Safety cap for long pages |
| `SMBA_CAPTURE_REVISION` | `unlabelled` | Commit/build label stored in reports |

The browser is always the installed system Chrome channel. The harness uses one
worker so the manifest is complete and ordered, and its actions only open or
close disclosure controls; it never submits, publishes, approves, saves, or
changes fixture records.

## Attendance workspace smoke suite

The focused attendance suite verifies the dashboard launch card, the standalone
Record Attendance and Reschedule Attendance destinations, unsaved-draft guards,
legacy deep-link redirects, and adjustment record focus. It expects the loaded
100-player fixture server to already be running and does not save or publish
fixture data.

```sh
npx playwright test -c tests/e2e/playwright.attendance-workspaces.config.ts
```

Override the server when needed with
`SMBA_ATTENDANCE_WORKSPACES_BASE_URL`.

## Responsive overflow regression suite

The focused overflow suite verifies that Announcements remains within every
supported portrait width and that Fee Records owns its table scrolling in
common landscape viewports without widening the document. It also guards the
existing 720px stacked-table breakpoint.

Run it against an already-running disposable copy of the loaded Stress fixture:

```sh
SMBA_RESPONSIVE_OVERFLOW_BASE_URL=http://127.0.0.1:3000 \
npx playwright test -c tests/e2e/playwright.responsive-overflow.config.ts
```

The suite never submits a product mutation. UI login creates an ordinary session
record, so the target server must not use one of the stored canonical fixture
databases directly.
