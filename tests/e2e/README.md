# Authenticated responsive capture harness

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

The default mobile output is
`snapshots/mobile-regression/<run-label>/<scenario>/`. Set
`SMBA_CAPTURE_VIEWPORT_SET=responsive` to create separate 1440 px web, 820 px
tablet, and 390 px mobile evidence under `snapshots/responsive-regression/`.
Every run writes:

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
`SMBA_CAPTURE_COACH_ACADEMY_ID` (default `SMBA-HC-0001`) and
`SMBA_CAPTURE_PLAYER_ACADEMY_ID` (default fixture representative `SMBA-PL-0001`).
Loaded fixtures use `SMBA_FIXTURE_PASSWORD` (default
`SMBA fixture access 2026!`). Fixture start scripts disable mandatory coach TOTP
only for this disposable browser regression path.
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
| `SMBA_CAPTURE_VIEWPORT_SET` | `mobile` | Use `responsive` for web, tablet, and mobile captures |
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
Record Attendance and Reschedule Attendance destinations, stale-write protection,
unsaved-draft guards, legacy deep-link redirects, adjustment record focus, responsive
roll-call controls, and document overflow. It expects the loaded 100-player fixture
server to run against a disposable database copy. One test saves and restores a
roll-call choice, and UI login creates ordinary session records; never point this
suite at a canonical fixture or production database.

```sh
npm run regression:attendance
```

Override the server when needed with
`SMBA_ATTENDANCE_WORKSPACES_BASE_URL`.

## Responsive overflow regression suite

The focused overflow suite verifies that Announcements remains within every
supported portrait width and that neither Fee Records register widens the
document in common landscape viewports. It also guards each register's own
stacked-table breakpoint: 720px for the Collections day book, 980px for the fee
register, which `.registrationTable` stacks a breakpoint earlier than the plain
records table. Its configuration additionally schedules
`accessibility-hardening.spec.ts` and
`phase3c-interface-correctness.spec.ts`; it deliberately does not schedule
`authentication-responsive.spec.ts`, which `npm run regression:authentication`
already gates at its own three viewports.

Run it against an already-running disposable copy of the loaded Stress fixture:

```sh
SMBA_RESPONSIVE_OVERFLOW_BASE_URL=http://127.0.0.1:3000 \
npm run regression:responsive-overflow
```

The suite leaves no product row behind, but it does now submit a product
mutation: since G-27 was un-quarantined, `accessibility-hardening.spec.ts` posts
a replacement of 22:00 for 300 minutes to `replaceSessionOccurrenceAction`
(`app/coach/actions.ts:326`), which `lib/sessions/service.ts:949-955` refuses for
crossing midnight before it opens a transaction. The case counts the day's
session cards either side of that submit, so a rule change that started accepting
it fails there rather than two CI steps later inside the follow-up suite's
payload budgets. UI login does create an ordinary session record, so the target
server must not use one of the stored canonical fixture databases directly.

Neither this suite nor the follow-up suite below keeps a trace, a video or a raw
screenshot: every spec they schedule imports `support/failure-evidence`, which
stages a masked screenshot and sanitized JSON under `SMBA_FAILURE_EVIDENCE_ROOT`.
That is the only tree `quality.yml` uploads, and `outputDir` is one it is
forbidden to upload, so a diagnostic written there could never be read.

## Phase 8 follow-up suite

The follow-up suite holds the route payload budgets for Attendance and Calendar,
the progressive reveal of the published report archive, and the single history
entry an announcement publication is allowed to leave behind. It **publishes a
real announcement** — the only suite here that publishes one, though not the only
one that writes: `attendance-workspaces.spec.ts` saves the 2026-07-31 player
register — so its configuration refuses to load unless
`SMBA_PHASE8_DISPOSABLE_DB` names an existing file inside a temporary directory
and outside the repository.

In CI it runs last against the shared port 3000 workspace, after the responsive
suite whose dashboard and archive measurements that announcement would otherwise
move underneath them. The order couples the other way too: the 379,350-byte
Attendance budget reads
`/coach/attendance/players/register?year=2026&batch=Weekday&level=Beginner`,
which renders the rows the attendance suite has already saved. Neither budget has
been re-measured since `42aa041` introduced them, so read an overrun as a
measurement to take rather than a regression to assume. Every run prints what it
measured as a `[payload-budget]` line in the step log, green runs included; that
line, not the budget in the spec, is the number to re-measure against.

```sh
SMBA_PHASE8_BASE_URL=http://127.0.0.1:3000 \
SMBA_PHASE8_DISPOSABLE_DB=/tmp/smba-stress-clone.db \
npm run regression:phase8-followup
```

## The five cases G-27 quarantined

All 19 cases across the two suites above now run; nothing here is marked
`test.fixme`. The five that were quarantined are listed with what was wrong,
because in three of them the recorded reason was not the only one, and each
carries the same account in a comment above it:

| Spec | Case | Recorded reason | What repairing it also found |
| --- | --- | --- | --- |
| `responsive-overflow.spec.ts` | Fee Records landscape overflow | `getByRole("table", { name: "Player fee records" })` — the caption became `<period> monthly fee records` in `f3ca2e1` | the geometry underneath asked the fee register for horizontal scrolling at 844px and 932px, where it has stacked since the same commit |
| `responsive-overflow.spec.ts` | Fee Records breakpoint | same locator | "720px" was the plain records table's breakpoint; the fee register's is 980px, so 721px asserted a shape it does not have |
| `accessibility-hardening.spec.ts` | Member Directory groups of twelve | searches `SMBA#`, which no role-prefixed fixture Academy ID contains since `d9d8dbf` | the register holds 99 members, not 100 — one of the stress profile's 100 players is archived — so it failed three assertions before the search |
| `accessibility-hardening.spec.ts` | Replacement validation stays inline | hard-codes `2026-08-10`, a session date the wall clock has passed, so "Replace session" is no longer rendered | a duration of 15 fails the input's own `min={30}`, so the submit event never fired and the Server Action was never reached |
| `accessibility-hardening.spec.ts` | Player attendance month and year restore | hard-codes `View July 2026`, the previous-month label only while the wall clock is inside August 2026 | — |

The last two dated cases now read the reference date the page renders instead of
naming a month. That does not make the calendar one immortal: the stress fixture
schedules 2026-07-01 to 2026-09-30, and past its last occurrence nothing in it is
upcoming, so "Replace session" is rendered for nobody. What deriving buys is that
it stops failing on dates inside the window, and that when the window ends it
fails on a named count with the reason attached rather than on a click that times
out.

None of the five has been executed against a running fixture server. Each was
repaired by reading the spec against the components, CSS and fixture it
addresses; the first browser run is still the thing that confirms them, and the
geometry in the two Fee Records cases is where to look first.
