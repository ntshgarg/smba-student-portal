# SMBA Student Portal — Performance Audit

Lens: **performance hotspots** across server data access, rendering, and client payload.
Branch: `audit/fresh-pass` @ `fa88c08`. Read-only pass. No dev server, no `next build`, no test suite.

---

## 1. Method

### 1.1 The deployment fact that drives every severity below

Production reads and writes go to **Turso over the network** through the *synchronous* `libsql`
driver. This is not an incidental detail — it is the single most important thing about this
codebase's performance profile.

```1:11:lib/db/client.ts
import "server-only"

import fs from "node:fs"
import path from "node:path"

import BetterSqlite3 from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import LibsqlDatabase from "libsql"
```

```21:32:lib/db/client.ts
function openSqliteConnection(): BetterSqlite3.Database {
  if (shouldUseTurso()) {
    const url = process.env.TURSO_DATABASE_URL?.trim()
    const authToken = process.env.TURSO_AUTH_TOKEN?.trim()
    ...
    return new LibsqlDatabase(url, { authToken } as never) as unknown as BetterSqlite3.Database
```

The driver's statement API is synchronous — `run`/`get`/`all` return values directly, not promises:

```
$ rg -n 'class Statement|statementRun.call|statementAll.call' node_modules/libsql/index.js | head
294:class Statement
330:        return statementRun.call(this.stmt, bindParameters[0]);
332:        return statementRun.call(this.stmt, bindParameters.flat());
$ node -e "console.log(require('./node_modules/libsql/package.json').version)"
0.5.29
```

Three consequences that I rely on throughout:

1. **Every query is one blocking network round trip.** N queries in a loop is N *serialised* RTTs.
2. **`Promise.all` cannot help.** Every data function in `lib/` is synchronous underneath, so
   `await Promise.all([...])` in a page (e.g. `app/(student)/player/page.tsx:37-43`) provides no
   concurrency at all. There is no overlapping to hide latency behind.
3. **Round trips inside `database.transaction(...)` hold the write lock for the whole duration.**
   Everything in `lib/finance/service.ts` and `lib/sessions/service.ts` runs `{ behavior: "immediate" }`,
   which takes the write lock up front.

I therefore rank round-trip amplification above all other costs, and I express every query finding
as a formula in data size.

### 1.2 What I examined

- All 294 `.ts`/`.tsx`/`.css` files under `app/`, `components/`, `lib/`.
- `lib/db/schema.ts` (1,203 lines, 125 index declarations) and all 29 migrations in `drizzle/`.
- All 46 route pages, all route handlers, all 62 `"use client"` modules.
- `app/globals.css`, `app/public-home.css`, all CSS Modules, `public/fonts/`.

### 1.3 Commands run, with real output

**AST call-graph scan for query-per-iteration** (I wrote `output/audit/.perf-callgraph.mjs`, a
TypeScript-compiler-API pass that resolves every function reaching a `db.select/insert/update/delete`
transitively, then reports loops containing such a call. It filters out the batched shape
`db.select()...all().map(...)`, where the "loop" is iterating a result set):

```
$ node output/audit/.perf-callgraph.mjs loops suspect
... (44 sites; full list drives §2)
LOOPS WITH QUERY WORK: 44
```

**Client-boundary scan** (`output/audit/.perf-client.mjs`, classifies every `"use client"` module by
React hooks, browser globals, `on*` handlers, and — critically — lists *custom* hooks separately so
they can be resolved to their definitions):

```
$ node output/audit/.perf-client.mjs suspects
=== 'use client' modules with NO hook, NO browser global, NO on* handler ===

suspects: 0 / 62 client modules

=== modules whose ONLY client signal is a CUSTOM hook (verify the hook) ===
app/(student)/error.tsx  hooks=useErrorReport (custom) handlers=1
app/(student)/player/financials/error.tsx  hooks=useErrorReport (custom) handlers=1
app/coach/error.tsx  hooks=useErrorReport (custom) handlers=1
app/coach/financials/error.tsx  hooks=useErrorReport (custom) handlers=1
app/error.tsx  hooks=useErrorReport (custom) handlers=1
app/global-error.tsx  hooks=useErrorReport (custom) handlers=1
components/coach/coach-welcome-hero.tsx  hooks=useReducedMotion (custom) handlers=0
components/coach/junior-coach-welcome-hero.tsx  hooks=useReducedMotion (custom) handlers=0
components/coach/reports-card.tsx  hooks=useReportResume (custom) handlers=0
components/dashboard/welcome-hero.tsx  hooks=useReducedMotion (custom) handlers=0
```

I then resolved each of those custom hooks to its definition rather than concluding from the
absence of a visible `useState`:

```
$ rg -n 'useReducedMotion|useReportResume|useErrorReport' components lib app
components/dashboard/welcome-hero.tsx:4:import { motion, useReducedMotion } from "motion/react"
components/coach/reports/report-resume.ts:44:export function useReportResume() {
lib/telemetry/use-error-report.ts:16:export function useErrorReport(boundary: ClientErrorBoundary, error: unknown) {
```

`useReducedMotion` is `motion/react`'s own hook; `useReportResume` and `useErrorReport` are
React-state/effect hooks in this repo. **Every one of the 62 `"use client"` modules genuinely needs
the client runtime. I found no component that could be moved to the server.** (This is the trap the
brief warned about; the answer is that there is nothing there.)

**Byte counts (real source paths only):**

```
$ wc -c app/globals.css app/public-home.css
  290029 app/globals.css
   42104 app/public-home.css
  332133 total

$ find app components -name '*.module.css' | wc -l
      10
$ find app components -name '*.module.css' -exec wc -c {} \; | awk '{s+=$1} END {print s}'
194696

$ find public -type f \( -name '*.woff2' -o -name '*.ttf' -o -name '*.otf' \) -exec wc -c {} \;
    1212 public/fonts/newsreader-normal-rupee.woff2
    1200 public/fonts/newsreader-italic-rupee.woff2
    1032 public/fonts/manrope-normal-rupee.woff2
```

Note: the brief said "100 CSS Modules". The measured count is **10**. I report the measured number.

**CSS split delta** (`output/audit/.perf-css-delta.mjs` — partitions `app/globals.css` into
top-level rule blocks and classifies a block "portal-only" when *every* class token in its selector
appears in a coach/admin/student/auth source tree and nowhere else; blocks with no class token in the
selector are conservatively counted "shared", so the portal-only figure is a lower bound):

```
$ node output/audit/.perf-css-delta.mjs
app/globals.css (whole)
  raw       = 290029
  raw gzip  = 41867
  raw brotli= 32010
  min       = 236256
  min gzip  = 35212
  min brotli= 27737
app/globals.css minus portal-only blocks
  raw       = 122591
  min       = 96879
  min brotli= 14011
portal-only blocks alone
  raw       = 167437
  min       = 139377
  min brotli= 16727

DELTA if portal-only rules moved out of the root-layout stylesheet:
  minified raw   : 236256 -> 96879  (-139377)
  minified gzip  : 35212 -> 16408  (-18804)
  minified brotli: 27737 -> 14011  (-13726)
  blocks: 1500 total, 1147 portal-only, 353 shared/unknown
```

`min` here is my own conservative minifier proxy (comments stripped, whitespace collapsed around
structural punctuation), not Next's minifier. It is an approximation and I label it as such.

**Client JS: real tree-shaken bundle measurement.** `esbuild` is present in `node_modules`, so I
bundled exactly the import that `components/dashboard/welcome-hero.tsx` makes, with React external:

```
$ cat output/audit/.perf-motion-entry.mjs
import { motion, useReducedMotion } from "motion/react"
export { motion, useReducedMotion }

$ ./node_modules/.bin/esbuild output/audit/.perf-motion-entry.mjs --bundle --format=esm \
    --minify --external:react --external:react-dom --external:react/jsx-runtime \
    --platform=browser --target=es2022 | (compute sizes)
motion/react { motion, useReducedMotion } tree-shaken+minified:
  raw    = 123845
  gzip   = 40926
  brotli = 36615
```

**Index proofs.** I did *not* open the shared `.data/*.db` fixtures. Instead I built a throwaway
`:memory:` SQLite with the exact DDL from `lib/db/schema.ts` and ran `EXPLAIN QUERY PLAN`
(`output/audit/.perf-eqp.mjs`):

```
$ node output/audit/.perf-eqp.mjs
--- A1 lib/attendance/database.ts:56 — occurrenceDate LIKE 'YYYY-MM%'
    select id from session_occurrences where occurrence_date like '2026-08%'
    PLAN: SCAN session_occurrences

--- A2 same predicate written as a half-open range
    select id from session_occurrences where occurrence_date >= '2026-08-01' and occurrence_date < '2026-09-01'
    PLAN: SEARCH session_occurrences USING INDEX session_occurrences_date_idx (occurrence_date>? AND occurrence_date<?)

--- A3 lib/attendance/database.ts:64 — attendance join filtered by LIKE on the joined date
    PLAN: SEARCH r USING INDEX session_attendance_account_occurrence_idx (account_id=?)
    PLAN: SEARCH o USING INDEX sqlite_autoindex_session_occurrences_1 (id=?)

--- B1 lib/finance/repository.ts:859 — concession applications for one player
    PLAN: SCAN a
    PLAN: SEARCH n USING INDEX sqlite_autoindex_concessions_1 (id=?)
    PLAN: SEARCH c USING COVERING INDEX sqlite_autoindex_financial_charges_1 (id=?)

--- B2-after (index added) — same query
    PLAN: SEARCH n USING INDEX concessions_player_period_idx (player_account_id=?)
    PLAN: SEARCH a USING INDEX tmp_ca_concession_idx (concession_id=?)
    PLAN: SEARCH c USING COVERING INDEX sqlite_autoindex_financial_charges_1 (id=?)

--- D1 lib/finance/repository.ts:1122 — approved, non-archived players ordered by name
    PLAN: SEARCH a USING INDEX accounts_role_idx (role=?)
    PLAN: SEARCH e USING COVERING INDEX sqlite_autoindex_player_enrollments_1 (account_id=?)
    PLAN: USE TEMP B-TREE FOR ORDER BY
```

Caveat: these plans come from empty tables with no `ANALYZE` statistics. A1/A2 is structural (see
PERF-13) and not stats-dependent. B1 is a planner choice and could differ with real statistics, but
either way no index exists that can serve `concession_applications.concession_id`.

**CPU microbenchmark** for `Intl` formatter construction (`output/audit/.perf-intl-bench.mjs`), using
the exact option objects from `lib/format.ts`:

```
$ node output/audit/.perf-intl-bench.mjs
getAcademyDateKey  (constructs per call, as written)  986.8 ms total  49.339 µs/call
getAcademyDateKey  (cached formatter)                  61.1 ms total   3.054 µs/call
formatAcademyDate  (constructs per call, as written) 1018.7 ms total  50.935 µs/call
formatAcademyDate  (cached formatter)                  17.7 ms total   0.885 µs/call
Intl.NumberFormat  (constructs per call, as written)  462.5 ms total  23.123 µs/call
Intl.NumberFormat  (cached formatter)                   8.4 ms total   0.422 µs/call

ratios (construct-per-call / cached):
  getAcademyDateKey : 16.2x
  formatAcademyDate : 57.6x
  NumberFormat      : 54.8x

node v22.17.0
```

### 1.4 `.next/` is stale — I did not use it

```
$ stat -f '%Sm %N' .next/BUILD_ID
Aug 23 21:26:57 2026 .next/BUILD_ID
$ find app components lib -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -newer .next/BUILD_ID | wc -l
      49
```

49 source files, including `app/globals.css` and `app/layout.tsx`, are newer than the last build.
**No byte count in this report comes from `.next/`.** Every measurement is either a real source path
or a bundle I produced myself with `esbuild`.

### 1.5 What honestly needs a running server or browser

I have not measured, and do not claim, any of the following. Each finding that depends on them is
marked Low or Medium confidence with an exact reproduction command:

- Actual Turso round-trip latency, and therefore any wall-clock number for the query findings.
  I give round-trip **counts** as formulas; multiply by your measured RTT.
- Next's real minified/compressed CSS and JS chunk sizes and how they split per route.
- Lighthouse / Core Web Vitals, LCP, TBT, hydration cost.
- Real row counts in production (roster size, charges per player, audit-event volume). Formulas are
  in terms of these; I never assume a value.

---

## 2. Findings

25 findings: **2 Critical, 10 High, 8 Medium, 5 Low.**

Ordered by severity, and within each severity band by cost mechanism — network round-trip
amplification first, then payload, then database CPU. One deviation from strict
severity-then-confidence ordering: PERF-10 sits inside the High band at Medium confidence, because
its severity rests on byte counts I measured on real source while its *served* size depends on
Next's minifier, which I could not run. Everything else in the High band is High confidence.

### PERF-1 — Coach attendance save issues 7 queries per player row inside one write transaction
- **Classification:** query pattern
- **Cost mechanism:** round trips
- **Type:** Objective defect
- **Severity:** Critical
- **Location:** `lib/sessions/service.ts:555` (the loop) with per-iteration queries at
  `lib/sessions/service.ts:598`, `:621`, `:627`, `:646`, `:661`, `:677`, `:694`; follow-up loop at
  `lib/sessions/service.ts:709`. Entry point `app/coach/actions.ts:176`
  (`saveAttendanceRegisterAction`), invoked from `components/coach/coach-portal-provider.tsx:214`.
- **Evidence:**

```555:560:lib/sessions/service.ts
    changes.forEach((change) => {
      const key = `${change.playerId}:${change.occurrenceId}`
      if (unique.has(key)) {
        operationalActionError(
          "INVALID_INPUT",
          "Attendance contains duplicate changes.",
```

Seven separate statements execute per iteration:

```598:606:lib/sessions/service.ts
      const enrollment = tx.select({ trainingStartOn: playerEnrollments.trainingStartOn })
        .from(playerEnrollments)
        .innerJoin(accounts, eq(accounts.id, playerEnrollments.accountId))
        .where(and(
          eq(playerEnrollments.accountId, change.playerId),
          eq(accounts.role, "player"),
          eq(accounts.approvalStatus, "approved"),
          isNull(accounts.archivedAt),
        )).get()
```

```621:631:lib/sessions/service.ts
      const assignments = tx.select().from(sessionAssignments).where(and(
        eq(sessionAssignments.accountId, change.playerId),
        eq(sessionAssignments.seriesId, occurrence.seriesId),
      )).all()
      const assignmentIds = assignments.map((assignment) => assignment.id)
      const assignedWeekdays = assignmentIds.length
        ? tx.select().from(sessionAssignmentWeekdays).where(inArray(
            sessionAssignmentWeekdays.assignmentId,
            assignmentIds,
          )).all()
        : []
```

…plus `:646` (`stored` choice), `:661` (`activeSourceAdjustment`), `:677` (`hadOrdinaryPresence`,
once per distinct player+date), `:694` (the upsert). Then `:709` runs
`reconcileAttendanceAdjustmentReviewState` per affected player+date, which is itself `1 + 2A`
(see PERF-16).

The whole thing is wrapped in an immediate write transaction:

```540:541:lib/sessions/service.ts
  return database.transaction((tx) => {
    let applied = 0
```

- **Magnitude:** For `C` changed rows over `D` distinct (player, date) pairs with `A` active
  adjustments per pair:
  **`2 + 7C + D × (1 + 2A)` sequential network round trips, all inside one write transaction.**
  A coach marking a full 24-player roster (C = D = 24, A = 0) issues **194 round trips** and holds
  the Turso write lock for all of them. The batched form is a fixed **~10**: six `inArray` reads
  across the whole change set, one multi-row upsert using `excluded.choice`, and two reads for the
  reconcile pass — i.e. `O(1)` instead of `O(C)`.
- **Why it matters:** This is the highest round-trip amplification in the codebase and it sits on the
  most-used coach workflow. Because the driver is synchronous the round trips cannot be overlapped,
  and because the transaction is `immediate` the write lock is held for the entire serialised chain,
  serialising *other* coaches too. It is also the likeliest candidate to hit a serverless function
  timeout as the academy grows.
- **User impact:** A head coach finishing a session presses Save on the roll call and waits while the
  server performs one blocking network call per player. Any second coach saving concurrently blocks
  behind the write lock.
- **Effort:** L
- **Confidence:** High (proved by reading the loop; the round-trip count follows directly from the
  synchronous driver)
- **How to prove wall-clock cost:** wrap the driver and count/time statements against a real Turso
  endpoint — `SMBA_USE_TURSO=true node --conditions=react-server -e "…"` with a proxy on
  `Statement.prototype.all/get/run` logging `performance.now()` deltas — then submit a roster-sized
  change set.

---

### PERF-2 — Monthly fee preparation runs ~10 queries per player inside a single transaction
- **Classification:** query pattern
- **Cost mechanism:** round trips
- **Type:** Objective defect
- **Severity:** Critical
- **Location:** `lib/finance/service.ts:1839` (the loop), with per-iteration queries at
  `lib/finance/service.ts:1844`, `:1859`, `:1866` (`monthlyChargeBasis` →
  `readFirstMonthSessionProration`, `lib/finance/repository.ts:195`), `:1877` (`issueCharge`,
  `lib/finance/service.ts:507`), `:1852`/`:1892` (`applyRecurringConcessionForCharge`,
  `lib/finance/service.ts:3499`). Transaction opened at `lib/finance/service.ts:1802`.
- **Evidence:**

```1839:1849:lib/finance/service.ts
    candidates.forEach(({ agreement, enrollment, hasAssignment }) => {
      if (!hasAssignment) {
        result.awaitingAssignment += 1
        return
      }
      const existing = tx.select().from(financialCharges).where(and(
        eq(financialCharges.playerAccountId, agreement.playerAccountId),
        eq(financialCharges.type, "monthly_training"),
        eq(financialCharges.billingPeriod, input.period),
        eq(financialCharges.lifecycle, "issued"),
      )).get()
```

`issueCharge` alone is five round trips:

```535:564:lib/finance/service.ts
  const existing = database.select().from(financialCharges).where(and(
  ...
  database.insert(financialCharges).values({
    id,
    feeReference: nextFeeReference(database, createFeeReference),
  ...
  const charge = readCharge(database, id)
  if (!charge) throw new Error("The issued charge could not be read.")
  insertAudit(database, {
```

and `nextFeeReference` is itself a retry loop with a query per attempt:

```495:502:lib/finance/service.ts
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const reference = createFeeReference().toUpperCase()
    ...
    const existing = database.select({ id: financialCharges.id }).from(financialCharges)
      .where(sql`lower(${financialCharges.feeReference}) = lower(${reference})`).get()
    if (!existing) return reference
```

- **Magnitude:** For `P` preparation candidates: **`~8–12P` sequential round trips in one write
  transaction** (1 existing-charge probe + 1 billed-earlier probe + 0–3 proration + 5 `issueCharge`
  + 1+ recurring-concession probe). 200 players ≈ **2,000 round trips** in a single transaction.
  Batched: existing charges, prior-period charges and recurring concessions are all one `inArray`
  read each; fee references can be pre-allocated in one pass; the inserts collapse to bulk
  `values([...])`. That is `O(1)` reads plus a handful of bulk writes.
- **Why it matters:** This is the one path most likely to *fail outright* rather than merely be slow.
  Serverless functions have hard time limits and the whole chain is serialised inside a write
  transaction. Note the batching migration was *started* here — `monthlyPreparationCandidates` at
  `lib/finance/service.ts:684` already uses the batched `loadPeriodAssignmentIndex`
  (`lib/finance/repository.ts:149`) — and then stopped at the loop body. This is precisely the
  partial-migration hole.
- **User impact:** Head coach clicks "Prepare monthly fees" at the start of a month and the request
  hangs, or times out mid-transaction, for the whole academy.
- **Effort:** XL
- **Confidence:** High
- **How to prove:** instrument the driver as in PERF-1 and run `prepareMonthlyCharges` against a
  seeded database with a realistic candidate count.

---

### PERF-3 — `getPlayerFeeStatement` calls the single-charge loader per charge when the batched loader already exists
- **Classification:** query pattern
- **Cost mechanism:** round trips
- **Type:** Objective defect
- **Severity:** High
- **Location:** `lib/finance/documents.ts:210-237`, specifically the call at
  `lib/finance/documents.ts:216`. Reached from
  `app/coach/financials/players/[playerId]/statement/download/route.ts:45`.
- **Evidence:**

```210:217:lib/finance/documents.ts
  const charges = database.select({ id: financialCharges.id })
    .from(financialCharges)
    .where(eq(financialCharges.playerAccountId, playerId))
    .orderBy(asc(financialCharges.dueDate), asc(financialCharges.issuedAt), asc(financialCharges.id))
    .all()
    .flatMap(({ id }) => {
      const charge = loadChargeView(database, id, now, true)
      if (!charge) return []
```

`loadChargeView` is a one-element wrapper around the batched loader, so each call is four queries:

```506:513:lib/finance/repository.ts
export function loadChargeView(
  database: Executor,
  chargeId: string,
  now = new Date(),
  includeInternal = false,
) {
  return loadChargeViews(database, [chargeId], now, includeInternal).get(chargeId) ?? null
}
```

`loadChargeViews` = 1 read of `financial_charges` (`lib/finance/repository.ts:489`) + 3 reads in
`loadChargeRelations` (`lib/finance/repository.ts:362`, `:372`, `:389`).

The batched sibling is right there and is documented as such:

```474:479:lib/finance/repository.ts
/**
 * Reads a whole set of charges in four queries instead of four per charge. The
 * map is keyed by charge ID and iterates in the requested order; charges that do
 * not exist are absent from it, exactly as `loadChargeView` returns null.
 */
export function loadChargeViews(
```

- **Magnitude:** For a player with `C` charges the statement route costs
  **`25 + 1 + 4C` round trips** (25 for the `loadPlayerFeeRecord(…, includeInternal = true)` at
  `lib/finance/documents.ts:207`, 1 for the ID list, `4C` for the loop). Swapping the loop for one
  `loadChargeViews(database, ids, now, true)` makes it **`25 + 1 + 4 = 30`, constant**. A player two
  years into monthly billing (C = 25) goes from **125 → 30** round trips. Worse, `loadPlayerFeeRecord`
  has *already* built a `chargeView` for every one of those charges at
  `lib/finance/repository.ts:944` — the `4C` is duplicated work on top of being unbatched.
- **Why it matters:** Growth in a player's history linearly grows the statement download time. This
  is also the query work that runs *before* the PDF is produced, so it dominates the download latency
  (the PDF itself cannot be streamed — see PERF-23).
- **User impact:** Head coach downloads a long-standing player's fee statement PDF and waits
  proportionally to how long that player has been at the academy.
- **Effort:** S
- **Confidence:** High
- **How to prove:** already proved statically; the query counts are readable from
  `lib/finance/repository.ts:479-513`.

---

### PERF-4 — Financial activity view reads eight whole tables on every page and every CSV page
- **Classification:** over-fetching
- **Cost mechanism:** transfer bytes (and round trips in the CSV path)
- **Type:** Objective defect
- **Severity:** High
- **Location:** `lib/finance/records.ts:416-437`. Called from
  `app/coach/financials/records/page.tsx:304` (page size 20) and, per 100-row page, from
  `app/coach/financials/records/activity.csv/route.ts:53`.
- **Evidence:**

```416:437:lib/finance/records.ts
  const accountRows = database.select({
    academyIdSerial: academyIdAllocations.serial,
    fullName: accounts.fullName,
    id: accounts.id,
    role: accounts.role,
  }).from(accounts).leftJoin(
    academyIdAllocations,
    eq(academyIdAllocations.accountId, accounts.id),
  ).all()
  const accountMap = new Map(accountRows.map((row) => [row.id, row]))
  const chargeMap = new Map(database.select().from(financialCharges).all()
    .map((row) => [row.id, row]))
  const paymentMap = new Map(database.select().from(payments).all().map((row) => [row.id, row]))
  const refundMap = new Map(database.select().from(refunds).all().map((row) => [row.id, row]))
  const agreementMap = new Map(database.select().from(feeAgreements).all()
    .map((row) => [row.id, row]))
  const adjustmentMap = new Map(database.select().from(chargeAdjustments).all()
    .map((row) => [row.id, row]))
  const concessionMap = new Map(database.select().from(concessions).all()
    .map((row) => [row.id, row]))
  const applicationMap = new Map(database.select().from(concessionApplications).all()
    .map((row) => [row.id, row]))
```

There is no `where`, no column projection, and no limit on seven of the eight. `payments` and
`refunds` are `select()` — every column, including `internalNote`. Pagination happens afterwards in
JavaScript by array slicing:

```61:69:lib/finance/records.ts
  const start = cursor ? rows.findIndex((row) => idOf(row) === cursor) + 1 : 0
  if (cursor && start === 0) throw new FinanceRecordsCursorError()
  const page = rows.slice(start, start + limit)
```

- **Magnitude:** 9 round trips per call, but the dominant cost is transfer: the **entire** finance
  ledger (`financial_charges` + `payments` + `refunds` + `fee_agreements` + `charge_adjustments` +
  `concessions` + `concession_applications` + `accounts`) crosses the network to render 20 rows.
  In the CSV export this repeats **`ceil(E/100)`** times for `E` audit events — 5,000 events means
  50 full-ledger transfers. The batched form resolves the audit page first, then does one
  `inArray` lookup per entity type over just the referenced IDs: 9 round trips, bytes proportional
  to page size instead of table size. I cannot state a byte figure without production row counts.
- **Why it matters:** Transfer volume grows with total ledger history, not with what is displayed,
  and the growth is unbounded. Over a network database this is the difference between a page that
  stays fast forever and one that degrades every month.
- **User impact:** Head coach opening the Activity tab of Fee records, and especially exporting the
  activity CSV, waits proportionally to the academy's entire financial history.
- **Effort:** M
- **Confidence:** High (structure is unambiguous); the byte magnitude is Low until row counts are known
- **How to prove magnitude:** `select count(*) from financial_charges; select count(*) from payments;`
  etc. against the production Turso database, and compare with the audit-event page size.

---

### PERF-5 — Coach announcements list issues one query per announcement, and the page calls it twice
- **Classification:** query pattern
- **Cost mechanism:** round trips
- **Type:** Objective defect
- **Severity:** High
- **Location:** loop at `lib/announcements/queries.ts:222-223`; helper at
  `lib/announcements/queries.ts:71-78`. Call sites: `app/coach/announcements/page.tsx:56` **and**
  `app/coach/announcements/page.tsx:62`, plus `app/coach/page.tsx:187`.
- **Evidence:**

```71:78:lib/announcements/queries.ts
function listChannels(database: SmbaDatabaseExecutor, announcementId: string) {
  return database.select({ channel: broadcastChannels.channel })
    .from(broadcastChannels)
    .where(eq(broadcastChannels.broadcastId, announcementId))
    .all()
    .map(({ channel }) => channel)
    .sort() as AnnouncementChannel[]
}
```

```222:224:lib/announcements/queries.ts
  return rows.flatMap((row) => {
    const announcement = coachAnnouncementFromRow(row, listChannels(database, row.id), now)
    if (filters.month && getAcademyMonthKey(row.publishedAt) !== filters.month) return []
```

The row query has no `where` and no `limit` — every announcement ever published is fetched, and
month/status/channel/search filters are applied in JavaScript *after* the per-row query has already
run (`lib/announcements/queries.ts:224-235`).

The page then does it all twice:

```56:62:app/coach/announcements/page.tsx
  const announcements = listCoachAnnouncements({
    channel,
    month,
    search,
    status,
  }, context)
  const hasPublishedAnnouncements = listCoachAnnouncements({}, context).length > 0
```

And the coach dashboard runs the whole thing to obtain a number:

```187:190:app/coach/page.tsx
  const activeAnnouncementCount = listCoachAnnouncements(
    { status: "active" },
    { coachId: identity.subjectId, now },
  ).length
```

- **Magnitude:** `listCoachAnnouncements` = **`2 + N`** round trips for `N` total announcements
  (1 auth + 1 rows + N channel reads). `/coach/announcements` therefore costs **`4 + 2N`**;
  `/coach` costs an extra **`2 + N`** to render a count. Batched: one
  `inArray(broadcastChannels.broadcastId, ids)` read makes it **3** regardless of `N`; the dashboard
  count becomes a single `count(*)`; and the second page call is unnecessary because
  `filters` are applied in JS anyway.
- **Why it matters:** Announcements accumulate forever and nothing prunes them; both round trips and
  transfer bytes grow without bound on two pages a head coach uses constantly.
- **User impact:** Head coach opening the announcements archive or the coach dashboard; latency
  grows with every announcement the academy has ever published.
- **Effort:** S
- **Confidence:** High

---

### PERF-6 — Staff attendance pages issue three queries per junior coach
- **Classification:** query pattern
- **Cost mechanism:** round trips
- **Type:** Objective defect
- **Severity:** High
- **Location:** `app/coach/attendance/staff/record/page.tsx:40-45` and
  `app/coach/attendance/staff/register/page.tsx:26-31`; helper `lib/coach/staff-attendance.ts:199`
  with its guard at `lib/coach/staff-attendance.ts:74-102`.
- **Evidence:**

```40:45:app/coach/attendance/staff/record/page.tsx
  const records = juniorCoaches.flatMap((coach) => listStaffAttendanceRecords({
    requesterAccountId: identity.subjectId,
    coachAccountId: coach.accountId,
    from: selectedDate,
    to: selectedDate,
  }))
```

Each call runs its own access guard (two reads) before the one data read:

```74:96:lib/coach/staff-attendance.ts
function requireAttendanceReadAccess({
  coachAccountId,
  database,
  requesterAccountId,
}: Pick<AttendanceReadInput, "coachAccountId" | "database" | "requesterAccountId">) {
  const attendanceDatabase = database ?? initializeDatabase()
  const requester = getCoachAccessProfile(requesterAccountId, { database: attendanceDatabase })
  if (!requester) throw new Error("Coach access is required.")
  const row = attendanceDatabase.select({
```

- **Magnitude:** **`~3 + 3J`** round trips for `J` junior coaches — the constant covers page auth,
  the profile list and its own guard; the `3J` term is the part that matters and is exact. Batched:
  one `inArray(staffAttendanceRecords.coachAccountId, ids)` plus a single head-admin check makes it
  constant. `J = 10` goes from ~33 → ~3.
- **Why it matters:** The requester's access profile is re-read `J` times with identical arguments —
  it is not just unbatched, it is literally the same query repeated.
- **User impact:** Head coach opening staff roll call or the staff register; both pages get slower as
  the coaching staff grows.
- **Effort:** S
- **Confidence:** High

---

### PERF-7 — Staff attendance save runs four queries per change, two of them identical
- **Classification:** query pattern
- **Cost mechanism:** round trips
- **Type:** Objective defect
- **Severity:** High
- **Location:** `lib/coach/staff-attendance.ts:272` (loop), with queries at `:315`, `:325`, `:336`,
  `:351`. Entry point `app/coach/actions.ts:196`.
- **Evidence:**

```315:327:lib/coach/staff-attendance.ts
      const profile = getCoachAccessProfile(change.coachAccountId, {
        database: transaction,
      })
      if (profile?.accessLevel !== "junior_coach") {
        operationalActionError(
          "NOT_FOUND",
          "The selected junior coach is unavailable.",
          "changes",
        )
      }
      const juniorCoach = requireJuniorCoachAccess(change.coachAccountId, {
        database: transaction,
      })
```

`requireJuniorCoachAccess` → `requireCoachAccessProfile` → `getCoachAccessProfile`
(`lib/auth/coach-access.ts:94-103`, `:74-81`, `:36-72`). Line `:325` re-issues the exact query that
line `:315` just issued, for the same `accountId`, in the same transaction.

- **Magnitude:** **`1 + 4C`** round trips for `C` staff changes, of which `C` are pure duplicates.
  Removing the duplicate alone gives `1 + 3C`. Full batching (one profile read for all changed
  coaches, one `inArray` stored-choice read, one bulk upsert) gives **~4**, constant.
- **Why it matters:** The duplicate is free to remove — `requireJuniorCoachAccess` could take the
  already-fetched profile — and the rest is the same batching shape as PERF-1.
- **User impact:** Head coach saving staff roll call for the day.
- **Effort:** S
- **Confidence:** High

---

### PERF-8 — Withdrawal-refund eligibility issues nine queries per charge when batched equivalents already exist
- **Classification:** query pattern
- **Cost mechanism:** round trips
- **Type:** Objective defect
- **Severity:** High
- **Location:** `lib/finance/service.ts:2295-2409`; queries at `:2318`, `:2320` (4 via
  `loadChargeView`), `:2321`, `:2352`, `:2360`, `:2373`, and `:2390` inside a nested `flatMap`.
  Called from `lib/finance/service.ts:2729` (`recordRefund`).
- **Evidence:**

```2318:2321:lib/finance/service.ts
      const agreement = database.select().from(feeAgreements)
        .where(eq(feeAgreements.id, charge.feeAgreementId)).get()
      const chargeLedger = loadChargeView(database, charge.id, now)
      const reversedWithdrawalRefund = database.select({
```

```2389:2397:lib/finance/service.ts
      )).flatMap(({ allocation, payment: allocationPayment }) => {
        const refunded = database.select({
          total: sql<number>`coalesce(sum(${refundAllocations.amountPaise}), 0)`,
        }).from(refundAllocations)
          .innerJoin(refunds, eq(refunds.id, refundAllocations.refundId))
          .where(and(
            eq(refundAllocations.paymentAllocationId, allocation.id),
            eq(refunds.lifecycle, "recorded"),
          )).get()?.total ?? 0
```

Every one of these has a batched counterpart already written in `lib/finance/repository.ts`, used by
`loadCoachReceiptContext` (`lib/finance/repository.ts:700-722`): `loadFeeAgreementsById`,
`loadChargeViews`, `loadReversedWithdrawalRefunds`, `loadLatestIssuedMonthlyPeriods`,
`loadRecordedWithdrawalChargeIds`, `loadRecordedRefundPaiseByAllocation`. The comment at
`lib/finance/repository.ts:802-803` even documents that the batched version was written to mirror
this per-charge read:

```802:808:lib/finance/repository.ts
      // The per-charge read took the first row it found, narrowed to the
      // agreement's end date whenever the agreement carried one.
      const reversedWithdrawalRefund = agreement?.effectiveTo
```

- **Magnitude:** **`1 + 9C + A`** round trips for `C` monthly charges on the payment and `A` covered
  allocations. Reusing the existing batched helpers makes it a fixed **~8**.
- **Why it matters:** This is a second, independent copy of logic that has *already been batched
  elsewhere in the same file*. Whoever did the receipt-context batching stopped here.
- **User impact:** Head coach recording a mid-term withdrawal refund.
- **Effort:** M
- **Confidence:** High

---

### PERF-9 — Payment preview and payment recording load each charge ledger individually
- **Classification:** query pattern
- **Cost mechanism:** round trips
- **Type:** Objective defect
- **Severity:** High
- **Location:** `lib/finance/service.ts:2107-2110` (`previewPaymentAllocations`);
  `lib/finance/service.ts:1966-1969`, `:1977-1995`, `:2054` (`recordAllocatedPaymentCommand`);
  further `loadChargeView`-in-loop sites at `:2647`, `:2703-2709`, `:2926-2927`, `:3033`.
- **Evidence:**

```2107:2110:lib/finance/service.ts
  const available = chargeRows.flatMap((charge) => {
    const view = loadChargeView(database, charge.id, now)
    return view && view.outstandingPaise > 0 ? [{ charge, view }] : []
  })
```

```1977:1988:lib/finance/service.ts
    allocations.forEach((allocation) => {
      const charge = readCharge(tx, allocation.chargeId)
      ...
      const current = loadChargeView(tx, charge.id, now)
```

- **Magnitude:**
  - `previewPaymentAllocations`: **`~5 + 4K`** round trips for `K` open charges. A player 12 months
    behind costs 53; with `loadChargeViews` it is 9, constant.
  - `recordAllocatedPaymentCommand`: **`~11A`** per-allocation round trips for `A` allocations
    (`readCharge` 1 + `loadChargeView` 4 at `:1987`, insert 1 + update 1 at `:2018`/`:2026`,
    `loadChargeView` 4 again at `:2054`) — and the `:1987` and `:2054` views are recomputed for the
    same charges.
- **Why it matters:** The preview runs on an explicit "Review" click (not per keystroke — I checked
  `components/coach/financials/financials-rapid-desk.tsx:120-134`), so this is one interaction, but
  its cost scales with how far behind the player is, which is exactly the population a coach chases.
- **User impact:** Head coach at the rapid payment desk reviewing then recording a payment for a
  player with a long outstanding balance.
- **Effort:** M
- **Confidence:** High

---

### PERF-10 — `app/globals.css` puts 236 KB of mostly portal-only CSS on the critical path of every route
- **Classification:** critical-path payload
- **Cost mechanism:** render-blocking, transfer bytes, parse time (three distinct costs, quantified
  separately below)
- **Type:** Objective defect
- **Severity:** High
- **Location:** `app/layout.tsx:4` (root layout import), `app/globals.css` (13,985 lines)
- **Evidence:**

```1:4:app/layout.tsx
import type { Metadata, Viewport } from "next"
import { Manrope, Newsreader } from "next/font/google"
import { siteOrigin } from "@/lib/config"
import "./globals.css"
```

```
$ wc -c app/globals.css
  290029 app/globals.css
$ node output/audit/.perf-css-delta.mjs
app/globals.css (whole)      min = 236256   min brotli = 27737
minus portal-only blocks     min =  96879   min brotli = 14011
portal-only blocks alone     min = 139377
blocks: 1500 total, 1147 portal-only, 353 shared/unknown
```

By contrast `app/public-home.css` (42,104 bytes) *is* correctly scoped to the public route group:

```
$ rg -n 'globals\.css|public-home\.css' app components --glob '!*.css'
app/global-error.tsx:6:import "./globals.css"
app/layout.tsx:4:import "./globals.css"
app/(public)/layout.tsx:1:import "../public-home.css"
```

- **Magnitude, by mechanism** (this is the part that has to be precise):
  - **Transfer bytes:** moving the 1,147 portal-only blocks into the `coach`/`admin`/`(student)`
    layouts removes **≈13.7 KB brotli / ≈18.8 KB gzip** from the anonymous public homepage, the
    login, register and recover pages. That is the *only* transfer saving, it applies only to
    non-portal routes, and only on a cold cache.
  - **Parse time and CSSOM construction:** this is the larger and more universal cost. The browser
    parses the *uncompressed* stylesheet, so today every route parses **236,256 bytes / 1,500
    top-level rules**; non-portal routes would parse **96,879 bytes / 353 rules**, a reduction of
    **139,377 bytes and 1,147 rules**. Selector matching against the DOM also scales with rule count.
  - **Render-blocking:** the stylesheet is a `<head>` `<link>`, so both the download and the parse
    happen before first paint. Splitting shortens that window; it does not remove it.
  - Portal routes keep essentially all of it, so **this is not a win for logged-in users** — do not
    claim otherwise.
- **Why it matters:** The anonymous homepage is the academy's marketing entry point and it is
  statically generated (`app/(public)/page.tsx:37` — `export const dynamic = "error"`), so CSS is
  the dominant thing standing between the visitor and first paint. It currently downloads and parses
  the entire coach and finance design system to render a landing page.
- **User impact:** A prospective parent on a mobile connection loading `/`, waiting on a stylesheet
  where roughly three-fifths of the rules can never match anything on the page.
- **Effort:** M
- **Confidence:** Medium — the byte counts are measured on real source and the root-layout mechanism
  is structural, but the *served* sizes depend on Next's own minifier, which I could not run.
- **How to prove:** `npm run build && node output/audit/.measure.mjs builtcss` on a machine that is
  not sharing this working tree, then compare per-route CSS chunk sizes before and after the split.

---

### PERF-11 — `motion` costs 36.6 KB brotli of JavaScript for a mount fade on three dashboards
- **Classification:** client boundary
- **Cost mechanism:** transfer bytes and parse time (client JS)
- **Type:** Objective defect
- **Severity:** High
- **Location:** `components/dashboard/welcome-hero.tsx:4`,
  `components/coach/coach-welcome-hero.tsx:4`, `components/coach/junior-coach-welcome-hero.tsx:4`.
  Rendered by `app/(student)/player/page.tsx:71`, `app/coach/page.tsx:206` and
  `app/coach/page.tsx:120`. (`components/reports/report-accordion.tsx:5` also imports it, for
  `AnimatePresence` on `/player/reports` — a genuinely harder case, excluded from this finding.)
- **Evidence:**

```20:25:components/dashboard/welcome-hero.tsx
  const reduceMotion = useReducedMotion()

  const initial = reduceMotion
    ? false
    : { opacity: 0, transform: "translateY(16px)" }
  const animate = { opacity: 1, transform: "translateY(0px)" }
```

That is the entire use of the library: a one-shot opacity + translateY on mount, with a
`prefers-reduced-motion` opt-out. Measured cost of exactly that import, tree-shaken and minified by
esbuild with React external:

```
motion/react { motion, useReducedMotion } tree-shaken+minified:
  raw    = 123845
  gzip   = 40926
  brotli = 36615
```

`motion` is not in Next 16.2.12's default `optimizePackageImports` list (verified in
`node_modules/next/dist/server/config.js:986-1010`, which does include `lucide-react`), and
`next.config.ts` adds nothing.

- **Magnitude:** **123,845 bytes minified / 36,615 bytes brotli** of JavaScript on the first
  authenticated page for all three roles. A CSS `@keyframes` fade plus an
  `@media (prefers-reduced-motion: reduce)` rule reproduces the behaviour with **zero** JavaScript,
  and would additionally let the heroes render as Server Components.
- **Why it matters:** This JS is downloaded, parsed and executed before hydration completes on the
  landing page every user sees after login. Unlike CSS, JavaScript parse and compile is main-thread
  work that directly delays interactivity.
- **User impact:** Every player and coach, on every cold load of their dashboard, waits on an
  animation library used for a 380 ms fade.
- **Effort:** S
- **Confidence:** High for the byte count (measured with a real bundler); Medium for the per-route
  delta, since Next may or may not hoist the chunk differently — `/player/reports` keeps `motion`
  for `AnimatePresence` regardless.
- **How to prove per-route delta:** `npm run build` and compare the First Load JS column for
  `/player` and `/coach` before and after.

---

### PERF-12 — `LIKE 'YYYY-MM%'` on `session_occurrences.occurrence_date` cannot use its index
- **Classification:** missing index (index defeated by predicate form)
- **Cost mechanism:** CPU + transfer bytes at the database; round-trip payload size
- **Type:** Objective defect
- **Severity:** High
- **Location:** `lib/attendance/database.ts:56`
- **Evidence:**

```49:57:lib/attendance/database.ts
  const occurrenceRows = db.select({
    id: sessionOccurrences.id,
    seriesId: sessionOccurrences.seriesId,
    occurrenceDate: sessionOccurrences.occurrenceDate,
    startsAt: sessionOccurrences.startsAt,
    status: sessionOccurrences.status,
    replacementForOccurrenceId: sessionOccurrences.replacementForOccurrenceId,
  }).from(sessionOccurrences).where(like(sessionOccurrences.occurrenceDate, `${month}%`)).all()
```

The index exists but SQLite's LIKE optimisation cannot use it: with the default
`case_sensitive_like = OFF`, a `LIKE` prefix scan requires the index to be `NOCASE`-collated, and
`session_occurrences_date_idx` (`lib/db/schema.ts:577`) is BINARY. Proved:

```
--- A1  select id from session_occurrences where occurrence_date like '2026-08%'
    PLAN: SCAN session_occurrences
--- A2  select id from session_occurrences where occurrence_date >= '2026-08-01' and occurrence_date < '2026-09-01'
    PLAN: SEARCH session_occurrences USING INDEX session_occurrences_date_idx (occurrence_date>? AND occurrence_date<?)
```

I checked the sibling LIKE predicates at `lib/attendance/database.ts:67` and `:80`: those are
filters on a *joined* row where the driving table is already narrowed by `account_id`, and the plan
shows an index seek. **Only line 56 is a full scan.** Being precise here matters — do not "fix" all
three.

- **Magnitude:** One full table scan of `session_occurrences` per call, growing linearly with the
  academy's entire scheduling history rather than with one month. The fix is a two-line rewrite to
  `gte(occurrenceDate, monthStart) && lt(occurrenceDate, nextMonthStart)`; no migration needed.
  `getPlayerAttendanceInput` is on the player dashboard (`getDashboard` →
  `calculatePlayerAttendanceForMonth`, `lib/data/sqlite-portal-repository.ts:82`) and in the report
  fallback path.
- **Why it matters:** The row count returned is also unfiltered by player or series, so the scan cost
  and the transfer cost both grow with total occurrences forever.
- **User impact:** Every player loading their dashboard.
- **Effort:** S
- **Confidence:** High (proved with `EXPLAIN QUERY PLAN`; the LIKE/collation rule is structural, not
  statistics-dependent)

---

### PERF-13 — `concession_applications.concession_id` is not indexed for the player fee record query
- **Classification:** missing index
- **Cost mechanism:** CPU at the database
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** query at `lib/finance/repository.ts:859-867`; schema at `lib/db/schema.ts:939-966`
- **Evidence:**

```859:867:lib/finance/repository.ts
  const applicationRows = database.select({
    application: concessionApplications,
    charge: financialCharges,
  }).from(concessionApplications)
    .innerJoin(financialCharges, eq(financialCharges.id, concessionApplications.chargeId))
    .innerJoin(concessions, eq(concessions.id, concessionApplications.concessionId))
    .where(eq(concessions.playerAccountId, playerId))
```

The only index touching `concession_id` is partial:

```955:960:lib/db/schema.ts
  uniqueIndex("concession_applications_active_charge_idx")
    .on(table.concessionId, table.chargeId)
    .where(sql`${table.reversedAt} is null`),
  index("concession_applications_charge_idx").on(table.chargeId),
```

so it cannot serve a lookup that must also see reversed applications. Proved:

```
--- B1 (as shipped)      PLAN: SCAN a
--- B2-after (index on concession_applications(concession_id))
    PLAN: SEARCH n USING INDEX concessions_player_period_idx (player_account_id=?)
    PLAN: SEARCH a USING INDEX tmp_ca_concession_idx (concession_id=?)
```

- **Magnitude:** One full scan of `concession_applications` per `loadPlayerFeeRecord` call. That
  function runs on the player's own fee page, the coach's player fee record page, the rapid desk,
  the statement PDF, and inside every payment/refund mutation — call it the single hottest finance
  read. Adding `index("concession_applications_concession_idx").on(table.concessionId)` removes it.
- **Why it matters:** Cheap, isolated fix with no behaviour change; the cost grows with total
  concession applications across the academy rather than with the one player being viewed.
- **User impact:** Any player or head coach opening a fee record.
- **Effort:** S
- **Confidence:** Medium — the *absence* of a usable index is certain; the specific plan was produced
  on empty tables without `ANALYZE`, so the planner's exact choice with real statistics may differ
  (it would still have no index available for `concession_id`).
- **How to prove on real data:** run
  `EXPLAIN QUERY PLAN select … from concession_applications a join financial_charges c … join concessions n … where n.player_account_id = ?`
  against a production snapshot.

---

### PERF-14 — Player dashboard reads every assignment and every occurrence in the academy to find one next session
- **Classification:** over-fetching
- **Cost mechanism:** transfer bytes + CPU
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `lib/data/sqlite-portal-repository.ts:145-160`, reached from
  `lib/data/sqlite-portal-repository.ts:332` (`getDashboard`) → `app/(student)/player/page.tsx:39`
- **Evidence:**

```145:158:lib/data/sqlite-portal-repository.ts
function nextPlayerSession(accountId: string) {
  const db = initializeDatabase()
  const assignments = listSessionAssignments().filter((assignment) => (
    assignment.playerId === accountId
  ))
  if (!assignments.length) return null
  const today = getIndiaDateKey()
  const year = Number(today.slice(0, 4))
  const now = new Date()
  const occurrence = resolveNextAssignedOccurrence({
    assignments,
    occurrences: listSessionOccurrences(today, `${year + 1}-12-31`),
    referenceInstant: now,
  })
```

`listSessionAssignments()` takes no filter at all:

```124:126:lib/sessions/database.ts
export function listSessionAssignments(): SessionAssignment[] {
  return assignmentRecords()
}
```

and the correctly scoped siblings already exist two functions away:

```134:138:lib/sessions/database.ts
export function listSessionAssignmentsForPlayers(
  playerIds: readonly string[],
): SessionAssignment[] {
  return assignmentRecords({ playerIds })
}
```

plus `listSessionOccurrencesForSeries(from, to, seriesIds)` at `lib/sessions/database.ts:78`.

- **Magnitude:** Round trips are unchanged (4 either way). The cost is transfer: every
  `session_assignments` row for every player plus all their weekday rows, and every
  `session_occurrences` row for every series up to ~2 years ahead — then 99% is discarded in JS.
  Scoping to `listSessionAssignmentsForPlayers([accountId])` and
  `listSessionOccurrencesForSeries(today, horizon, seriesIds)` reduces the payload to one player's
  rows. I cannot give a byte figure without production row counts.
- **Why it matters:** This is on the student dashboard — the highest-traffic authenticated page in
  the product — and the transfer grows with total academy size, not with the one student.
- **User impact:** Every player loading their dashboard.
- **Effort:** S
- **Confidence:** High for the structure; Low for magnitude until row counts are known
- **How to prove magnitude:** `select count(*) from session_assignments; select count(*) from session_occurrences where occurrence_date >= date('now');`

---

### PERF-15 — Coach dashboard loads a three-year occurrence window to display today's sessions
- **Classification:** over-fetching
- **Cost mechanism:** transfer bytes + CPU
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `lib/coach/database.ts:404-411`, called from `app/coach/page.tsx:140` and
  `app/coach/members/page.tsx:16`
- **Evidence:**

```404:411:lib/coach/database.ts
export function getCoachSessionSnapshot(referenceDate = getIndiaDateKey()) {
  const window = sessionPortalWindow(referenceDate)
  return {
    sessionSeries: listSessionSeries(),
    sessionOccurrences: listSessionOccurrences(window.from, window.to),
    sessionAssignments: listSessionAssignments(),
  }
}
```

```207:210:lib/sessions/database.ts
export function sessionPortalWindow(referenceDate: string) {
  const year = Number(referenceDate.slice(0, 4))
  return { from: `${year - 1}-01-01`, to: `${year + 1}-12-31` }
}
```

The dashboard uses this only to find today's sessions and the next scheduled one:

```142:149:app/coach/page.tsx
  const scheduledSessions = sessionSnapshot.sessionOccurrences
    .filter((occurrence) => occurrence.status === "scheduled")
  const todaySessions = scheduledSessions.filter((occurrence) => (
    occurrence.occurrenceDate === today
  ))
  const nextScheduledSession = scheduledSessions.find((occurrence) => (
    occurrence.occurrenceDate >= today
  ))
```

The properly scoped alternative already exists and is documented:

```122:132:lib/coach/session-read-models.ts
/**
 * Returns only the occurrence window and roster facts needed by a Calendar month.
 * Replacement lineage remains resolved by the shared session database reader.
 */
export function getCoachSessionSnapshotForWindow({
  from,
  to,
}: {
  from: string
  to: string
}): CoachSessionWindowSnapshot {
```

- **Magnitude:** Up to three calendar years of `session_occurrences` plus every
  `session_assignments` row in the academy, transferred to render two facts. Narrowing to
  `{ from: today, to: today + 60d }` and dropping the unused assignment set is a small change.
- **Why it matters:** Same shape as PERF-14 on the coach side, on the coach's landing page.
- **User impact:** Every coach loading `/coach`; also `/coach/members`.
- **Effort:** S
- **Confidence:** High for the structure; Low for magnitude until row counts are known
- **How to prove magnitude:** `select count(*) from session_occurrences where occurrence_date between date('now','-1 year') and date('now','+1 year'); select count(*) from session_assignments;`
  against the production database, then compare with the two rows `/coach` actually reads.

---

### PERF-16 — Collections day book joins every payment and refund allocation regardless of the requested date range
- **Classification:** over-fetching
- **Cost mechanism:** transfer bytes
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `lib/finance/records.ts:225-258`, called at `lib/finance/records.ts:264-265`.
  Page: `app/coach/financials/records/page.tsx:251`. CSV: repeated per page from
  `app/coach/financials/collections.csv/route.ts:25`.
- **Evidence:**

```225:233:lib/finance/records.ts
function coveredReferencesByPayment(database: Executor) {
  const references = new Map<string, string[]>()
  database.select({
    paymentId: paymentAllocations.paymentId,
    feeReference: financialCharges.feeReference,
    dueDate: financialCharges.dueDate,
  }).from(paymentAllocations)
    .innerJoin(financialCharges, eq(financialCharges.id, paymentAllocations.chargeId))
    .orderBy(asc(financialCharges.dueDate), asc(financialCharges.id)).all()
```

No `where` clause at all, while the payment and refund reads immediately below it *are* date-filtered
(`lib/finance/records.ts:280-284`, `:299-303`).

- **Magnitude:** Two unbounded joins per call. In the CSV route this repeats **`ceil(E/100)`** times
  for `E` day-book events. Adding `inArray(paymentAllocations.paymentId, paymentIds)` after the
  date-filtered payment read makes the payload proportional to the range.
- **Why it matters:** The whole point of the day book is a date range; the reference lookup ignores it.
- **User impact:** Head coach viewing or exporting collections for a single day still pays for the
  academy's entire allocation history.
- **Effort:** S
- **Confidence:** High

---

### PERF-17 — CSV exports re-run the entire query pipeline for every 100 rows
- **Classification:** query pattern / over-fetching
- **Cost mechanism:** round trips + transfer bytes
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `app/coach/financials/collections.csv/route.ts:17-28`,
  `app/coach/financials/records/activity.csv/route.ts:41-56`,
  `app/coach/financials/records/fees.csv/route.ts:38-46`
- **Evidence:**

```21:26:app/coach/financials/collections.csv/route.ts
    while (true) {
      yield* page.events
      if (!page.nextCursor || seen.has(page.nextCursor)) return
      seen.add(page.nextCursor)
      page = getCollectionsDayBook({ ...input, cursor: page.nextCursor, limit: 100 }, { coachId })
    }
```

Pagination is a JavaScript array slice over a fully materialised result set
(`lib/finance/records.ts:55-70`), so each "next page" recomputes everything from scratch.

- **Magnitude:** For `E` exported rows: **`ceil(E/100)` × Q`** round trips where `Q` is the service's
  fixed query count (9 for activity, 4 for collections, 6 for the fee register) — *and* the same
  multiplier applies to the unbounded transfers in PERF-4 and PERF-16. Since the generator already
  streams the CSV to the client, a single unpaginated internal call (or `limit: Infinity`) would
  reduce this to one pass.
- **Why it matters:** The export is the one operation where the whole result set is wanted anyway, so
  paginating it internally is pure overhead multiplied by the page count.
- **User impact:** Head coach exporting a year of collections or activity to CSV.
- **Effort:** S
- **Confidence:** High

---

### PERF-18 — `lib/format.ts` constructs a new `Intl` formatter on every call, measured at 51 µs each
- **Classification:** render cost
- **Cost mechanism:** CPU (both server render and client hydration)
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `lib/format.ts:17`, `:31`, `:44`, `:53`, `:71`. Worst per-row callers:
  `lib/finance/repository.ts:443` (inside `chargeView`, once per charge),
  `lib/finance/repository.ts:1167` (inside the per-charge `flatMap` of `listFinancePlayers`),
  `lib/finance/records.ts:534` (once per audit item),
  `components/coach/calendar/session-calendar.tsx:545` (once per day cell in `MonthGrid`).
  Component-level duplicates of the same mistake: `components/coach/financials/financials-client-utils.ts:45`
  and `:60`, `components/coach/financials/financial-records-workspace.tsx:138` and `:161`,
  `components/coach/members/member-directory.tsx:95` and `:104`,
  `components/coach/announcements/announcement-archive.tsx:39`,
  `components/financials/player-finance-presentation.ts:30`,
  `components/admin/admin-authenticator-recovery-queue.tsx:21`,
  `components/coach/onboarding/player-onboarding-register.tsx:116`,
  `components/coach/financials/financials-card.tsx:9` and `:18`,
  `components/coach/financials/player-ledger.tsx:763`.
- **Evidence:**

```13:24:lib/format.ts
export function formatAcademyDate(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(ACADEMY_LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...options,
    timeZone: ACADEMY_TIME_ZONE,
  }).format(toDate(value))
}
```

The constructor, not `format()`, is the expensive part. Measured on this machine:

```
formatAcademyDate  (constructs per call, as written) 50.935 µs/call
formatAcademyDate  (cached formatter)                 0.885 µs/call   → 57.6x
getAcademyDateKey  (constructs per call, as written) 49.339 µs/call
getAcademyDateKey  (cached formatter)                 3.054 µs/call   → 16.2x
Intl.NumberFormat  (constructs per call, as written) 23.123 µs/call
Intl.NumberFormat  (cached formatter)                 0.422 µs/call   → 54.8x
```

The most avoidable instance is `lib/finance/repository.ts:443`, which recomputes the *same constant
string* once per charge:

```443:443:lib/finance/repository.ts
    status: deriveFinanceStatus(ledgerInput, getAcademyDateKey(now)),
```

- **Magnitude:** ~50 µs of pure CPU per formatter construction. `getAcademyDateKey(now)` inside
  `chargeView` costs **`49.3 µs × C`** for `C` charges: rendering the fee register for 300 players is
  ≈ **14.8 ms** of CPU spent recomputing one identical date string. `MonthGrid` pays
  **`50.9 µs × 42` ≈ 2.1 ms** per render, on every date click, on the client's main thread. Fixes are
  independent and cheap: memoise formatters by option key in `lib/format.ts`, and hoist
  `getAcademyDateKey(now)` out of `chargeView` to its caller.
- **Why it matters:** It is measured, it is uniform across 135 call references, and the fix cannot
  change behaviour — the same formatter with the same options produces the same output.
- **User impact:** Head coach on the fee register and financial records pages (server CPU, so it
  delays TTFB); any coach clicking around the calendar (client main thread, so it delays the click
  response).
- **Effort:** S
- **Confidence:** High for the per-call cost (measured); Medium for the aggregate, which depends on
  row counts.
- **How to prove the aggregate:** `node output/audit/.perf-intl-bench.mjs` reproduces the per-call
  figures; multiply by the row counts from
  `select count(*) from financial_charges where lifecycle = 'issued';` for the fee-register case, or
  profile a server render with `node --cpu-prof` and look for `Intl` constructor frames.

---

### PERF-19 — `reconcileAttendanceAdjustmentReviewState` runs two queries per adjustment, called from inside another loop
- **Classification:** query pattern
- **Cost mechanism:** round trips
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `lib/attendance/adjustments.ts:499-527`, called per affected player+date from
  `lib/sessions/service.ts:709-717`
- **Evidence:**

```499:521:lib/attendance/adjustments.ts
  return active.reduce((changes, adjustment) => {
    const hasOrdinaryPresence = adjustment.completionOccurrenceId
      ? Boolean(database.select({ id: sessionAttendanceRecords.id })
      ...
      : Boolean(database.select({ id: sessionAttendanceRecords.id })
      ...
    if (hasOrdinaryPresence) {
      return changes + database.update(attendanceAdjustments)
        .set({ reviewRequiredAt: null })
        .where(eq(attendanceAdjustments.id, adjustment.id)).run().changes
```

- **Magnitude:** **`1 + 2A`** round trips per invocation for `A` active adjustments, nested inside
  PERF-1's `D` iterations, giving `D × (1 + 2A)`. Batched: one `inArray` presence read plus two
  bulk `update … where id in (…)` statements = 3, constant.
- **Why it matters:** It compounds PERF-1 multiplicatively; fixing PERF-1 without this leaves a
  second `O(n)` chain behind.
- **User impact:** Coach saving attendance for a session where players have make-up adjustments.
- **Effort:** M
- **Confidence:** High

---

### PERF-20 — No caching anywhere: every portal page is fully dynamic and recomputed per request
- **Classification:** caching
- **Cost mechanism:** round trips + CPU
- **Type:** Subjective suggestion
- **Severity:** Medium
- **Location:** repo-wide. Only three cache primitives exist:

```
$ rg -n 'export const (revalidate|dynamic)|"use cache"|unstable_cache|cacheLife|cacheTag|\bcache\(' app lib components
lib/student/current-student.ts:6:export const getCurrentStudent = cache(async () => {
lib/auth/current-coach.ts:14:const getRequestIdentity = cache(() => sessionProvider.getCurrentIdentity())
lib/auth/current-coach.ts:15:const getRequestCoachAccess = cache((coachId: string) => getCoachAccessProfile(coachId))
app/(public)/page.tsx:37:export const dynamic = "error"
app/(public)/announcements/[announcementId]/page.tsx:8:export const dynamic = "force-dynamic"
app/api/public/announcements/route.ts:4:export const dynamic = "force-dynamic"
app/api/health/route.ts:5:export const dynamic = "force-dynamic"
app/api/client-errors/route.ts:9:export const dynamic = "force-dynamic"
```

- **Evidence:** There is no `revalidate`, no `"use cache"`, and no `unstable_cache` on any data path.
  `revalidatePath` is used correctly and thoroughly for invalidation (30+ call sites across
  `app/coach/*/actions.ts`, `app/admin/actions.ts`) — the invalidation half of the design is done;
  the caching half was never added. Meanwhile per-request-constant values are recomputed on every
  render: `getFinanceActivation` runs at `app/coach/financials/records/page.tsx:166` and again
  inside `requireFinanceActive` in every service call; `requireHeadAdminAccess` re-reads the same
  coach profile in `app/coach/financials/players/[playerId]/statement/download/route.ts:35` and then
  again inside `getPlayerFeeStatement` → `requireCoach` (`lib/finance/documents.ts:100`).
- **Magnitude:** Cannot be quantified as a single number. The most concrete sub-case: `React.cache`
  is already used for identity and coach-access in `lib/auth/current-coach.ts:14-15`, but the direct
  `requireHeadAdminAccess(identity.subjectId)` calls in route handlers and service entry points
  bypass it, so the same `accounts ⋈ coach_profiles ⋈ academy_id_allocations` read repeats 2–3 times
  per request. Wrapping `getCoachAccessProfile` and `readFinanceActivation` in `React.cache` at the
  module level removes those duplicates for free.
- **Why it matters:** Given `revalidatePath` coverage is already comprehensive, adding caching is
  lower-risk here than in most codebases. Slow-changing reads (finance activation, session series,
  junior coach roster) are safe candidates.
- **User impact:** Every authenticated page view pays for redundant auth and activation reads.
- **Effort:** M
- **Confidence:** Medium — the duplicate reads are proved statically; whether broader caching is
  *safe* for a given page depends on product tolerance for staleness, which I cannot decide.
- **How to prove:** instrument the driver and count distinct SQL texts per page render; duplicates
  with identical parameters are the caching opportunity.

---

### PERF-21 — `getActiveHomepageAnnouncement` and `getActivePlayerAnnouncement` fetch every active announcement to return one
- **Classification:** over-fetching
- **Cost mechanism:** transfer bytes
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `lib/announcements/queries.ts:272-273` and `lib/announcements/queries.ts:309-310`
- **Evidence:**

```272:274:lib/announcements/queries.ts
    const row = activeChannelRows("homepage", database, now)
      .find(({ id }) => id === announcementId)
    if (!row) return null
```

- **Magnitude:** One round trip either way, so this is purely transfer: every active announcement's
  full `content` (up to 5,000 characters each, per the `broadcasts_content_length_check` in
  `lib/db/schema.ts:1053`) crosses the network so that one can be selected. Adding
  `eq(broadcasts.id, announcementId)` to the existing `where` makes the payload one row.
- **Why it matters:** Small and easy; it is on an anonymous public detail page
  (`app/(public)/announcements/[announcementId]/page.tsx`) and the player equivalent.
- **User impact:** Anyone opening a single announcement.
- **Effort:** S
- **Confidence:** High

---

### PERF-22 — `getCoachFinanceRapidDesk` runs the finance player list query twice
- **Classification:** redundant query
- **Cost mechanism:** round trips + CPU at the database
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `lib/finance/service.ts:3953` and `lib/finance/service.ts:3971`
- **Evidence:**

```3971:3976:lib/finance/service.ts
    ? listFinancePlayers(database, {
      now,
      period: input.period,
      query: loadedSelectedLedger.academyId,
    }).find((player) => player.playerId === loadedSelectedLedger.playerId) ?? null
    : null
```

`listFinancePlayers` (`lib/finance/repository.ts:1023-1231`) is a single large query carrying five
correlated subqueries evaluated per charge row. Running it a second time to `.find()` one player is
expensive relative to what it returns.

- **Magnitude:** One extra execution of the heaviest read query in the finance module per rapid-desk
  render where a player is selected. Being fair: the two calls use *different* `query` filters, so
  the first result does not always contain the selected player — the fix is to look in the first
  result and only fall back to a narrow single-player query when it is absent, not to delete the
  second call outright.
- **Why it matters:** Small but on a page a head coach keeps open while collecting fees.
- **User impact:** Head coach selecting a player at the rapid payment desk.
- **Effort:** S
- **Confidence:** Medium — the redundancy is real but partial, as noted.
- **How to prove:** log SQL text per request while loading
  `/coach/financials/record?playerId=…`; the `listFinancePlayers` statement should appear twice.

---

### PERF-23 — Receipt and statement PDFs must buffer the whole document; streaming is structurally impossible
- **Classification:** document generation
- **Cost mechanism:** memory (not a latency defect)
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:** `lib/finance/pdf.ts:103-138` and `:404-426`; `lib/reports/pdf.ts:355-371` and `:173`
- **Evidence:** Both generators run PDFKit in `bufferPages: true` mode and resolve a single
  concatenated `Buffer`:

```108:125:lib/finance/pdf.ts
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const document = new PDFDocument({
      autoFirstPage: true,
      bufferPages: true,
      ...
    document.on("data", (chunk: Buffer) => chunks.push(chunk))
    document.on("end", () => resolve(Buffer.concat(chunks)))
```

The reason is in `finish()`, which revisits **already-emitted pages** after the last one is drawn, to
stamp a footer containing the total page count:

```404:424:lib/finance/pdf.ts
  finish(generatedAt: string) {
    const range = this.document.bufferedPageRange()
    for (let page = range.start; page < range.start + range.count; page += 1) {
      this.document.switchToPage(page)
      ...
        .text(`Page ${page - range.start + 1} of ${range.count}`, 310, footerY, {
```

`lib/reports/pdf.ts:173` does the same (`Page ${pageNumber} of ${pageCount}`).

- **Magnitude:** N/A — there is nothing to reclaim.
- **Why it matters:** **Do not propose streaming these PDFs.** `range.count` — the denominator in
  "Page 1 of 4" — is only known after the final page exists, and it must be written onto page 1,
  which by then has already been generated. `bufferPages` exists precisely to make that possible.
  Streaming the response would require either dropping the "of N" from the footer or dropping page
  footers entirely, i.e. changing what the product produces. This proposal has been retracted on
  this codebase before; the code has not changed and it would be wrong again.
  The download routes' real latency comes from the query work that precedes generation — see PERF-3
  for the statement route.
- **User impact:** None. Recorded so a future audit does not re-raise it.
- **Effort:** N/A
- **Confidence:** High

---

### PERF-24 — Published report attendance can fall back to a per-report query for legacy rows
- **Classification:** query pattern
- **Cost mechanism:** round trips
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `lib/data/sqlite-portal-repository.ts:284-292`; helper
  `lib/reports/published-report.ts:26-66`
- **Evidence:**

```284:292:lib/data/sqlite-portal-repository.ts
  return rows.map((report) => {
    const publication = report.publication
    const details = monthDetails(report.month)
    const attendance = resolvePublishedReportAttendance({
      attendanceSnapshot: publication.attendanceSnapshot,
```

- **Magnitude:** Being accurate about the blast radius: `resolvePublishedReportAttendance` only
  queries when the stored snapshot is missing or invalid (`lib/reports/published-report.ts:39-55`),
  and in that case `getPlayerAttendanceInput` costs 6 round trips. `toPublishedReports` is reached
  from `getReport` (`lib/data/sqlite-portal-repository.ts:346-347`) with a single `reportId`, so the
  loop is length 1 in the shipped call path. The exposure is therefore **`6 × (legacy rows in the
  result)`**, which today is at most 6. It is only a latent 1+N if a future caller passes the
  multi-row `publishedReportRows(accountId)` result.
- **Why it matters:** Low priority now; worth a comment or a batched variant before anyone renders a
  multi-report archive through this path.
- **User impact:** A player opening a pre-snapshot legacy report.
- **Effort:** S
- **Confidence:** High

---

### PERF-25 — Approved-player listing sorts through a temp B-tree
- **Classification:** missing index
- **Cost mechanism:** CPU at the database
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:** `lib/finance/repository.ts:1122-1149`; schema `lib/db/schema.ts:33-35`
- **Evidence:**

```
--- D1 select a.id from accounts a inner join player_enrollments e on e.account_id = a.id
       where a.role = 'player' and a.approval_status = 'approved' and a.archived_at is null
       order by a.normalized_name
    PLAN: SEARCH a USING INDEX accounts_role_idx (role=?)
    PLAN: USE TEMP B-TREE FOR ORDER BY
```

`accounts` has three single-column indexes (`approval_status`, `role`, `normalized_name`) but no
composite that matches the very common
`role = 'player' AND approval_status = 'approved' AND archived_at IS NULL ORDER BY normalized_name`
shape used by `listFinancePlayers`, `listApprovedPlayerIds` (`lib/finance/repository.ts:1303`) and
`loadFeeRegister` (`lib/finance/records.ts:86`).

- **Magnitude:** One temp B-tree sort per call, plus a filter pass over all rows with
  `role = 'player'`. A composite `index("accounts_player_directory_idx").on(role, approvalStatus, archivedAt, normalizedName)`
  would let SQLite seek and read in order. For an academy-sized `accounts` table this is genuinely
  small — I am listing it for completeness, not urgency.
- **Why it matters:** Cheap to add, no behaviour change; matters only at scale.
- **User impact:** Head coach on fee-related list pages.
- **Effort:** S
- **Confidence:** Medium — plan produced on empty tables without `ANALYZE`.
- **How to prove:** run the D1 query above under `EXPLAIN QUERY PLAN` against a production snapshot
  with `ANALYZE` applied, and check whether `USE TEMP B-TREE FOR ORDER BY` still appears.

---

## 3. What's working well — do not regress these

**Font payload work is intact and correct.** Verify before touching `app/layout.tsx` or
`app/globals.css`:

- The upright Newsreader face is declared solely so its `@font-face` rules exist, with its preload
  explicitly disabled and the reason documented in place:

```25:35:app/layout.tsx
// Same family, so `--font-newsreader` resolves to these faces too; declared
// separately only so its preload can be dropped. The variable it defines is
// deliberately unread — it exists to keep this instance's @font-face rules in
// the root layout's stylesheet.
const newsreaderUpright = Newsreader({
  variable: "--font-newsreader-upright",
  style: ["normal"],
  display: "swap",
  preload: false,
})
```

- The rupee sign `U+20B9` is served from three per-family single-glyph subsets totalling **3,444
  bytes**, overriding next/font's `latin-ext` files by unicode-range specificity
  (`app/globals.css:21-45`, `public/fonts/*.woff2` measured above). Removing these `@font-face`
  blocks or reordering them before next/font's stylesheet would silently re-introduce a whole
  `latin-ext` download per family.

**Finance batching that is already complete** — use these as the template for PERF-3, PERF-8, PERF-9:

- `loadChargeViews` / `loadChargeRelations`, `lib/finance/repository.ts:352-504` — four queries for
  any number of charges, with `rowid` pinned as the final sort key so grouped results preserve the
  order a per-parent read produced (`lib/finance/repository.ts:335-341`). The empty-set guard at
  `:357-359` correctly avoids three pointless round trips.
- `loadCoachReceiptContext`, `lib/finance/repository.ts:700-722` — seven batched loaders replacing
  seven-per-receipt reads.
- `loadPlayerFeeRecord`, `lib/finance/repository.ts:931` — a **fixed** 13 (public) / 23 (internal)
  round trips regardless of how many charges, payments or refunds the player has.
- `loadFeeRegister`, `lib/finance/records.ts:122-136` — batches charge views ahead of the row build,
  with the reason written down.
- `loadPeriodAssignmentIndex`, `lib/finance/repository.ts:144-193` — the batched form of
  `hasAssignmentInPeriod`, with the invariant that makes it valid documented.

**Other genuinely good work:**

- `resolveOccurrenceEligibilityDates`, `lib/sessions/occurrence-lineage.ts:30-102` — iterative
  breadth-first ancestor resolution, chunked at 500 IDs per `inArray`, with cycle detection. This is
  a `while` loop containing a query and it is *correct*: it terminates in tree-depth iterations, not
  per row.
- `lib/sessions/database.ts` — every reader has a scoped variant
  (`listSessionAssignmentsForPlayers`, `listSessionOccurrencesForSeries`,
  `listSessionAttendanceRecordsForOccurrences`) and each guards the empty-input case before querying.
  PERF-14 and PERF-15 are callers that ignore these, not gaps in the layer.
- `useAttendanceRegisterWindow`, `components/coach/use-attendance-register-window.ts` — a real
  column virtualiser for the annual attendance register: overscan, `requestAnimationFrame`-throttled
  scroll handling, `ResizeObserver`, and identity-preserving state updates via `sameWindow`. The
  register would otherwise render 365 columns × roster rows.
- `components/coach/members/member-directory.tsx:237-242` — incremental rendering via
  `visibleMemberCount` + `slice`, so the member directory does not mount the whole roster.
- `React.cache` request-deduplication for identity and coach access,
  `lib/auth/current-coach.ts:14-15`, and for the student, `lib/student/current-student.ts:6`.
- `revalidatePath` invalidation coverage is thorough and precise across all mutation actions.
- The client boundary is clean: **all 62 `"use client"` modules need the client runtime**, and the
  type-only import of a `server-only` module at
  `components/coach/attendance-adjustments-workspace.tsx:35`
  (`import type { AttendanceAdjustmentRecord }`) is erased at compile time and pulls no Drizzle into
  the bundle. I checked; it is fine.
- `lucide-react` is in Next 16.2.12's default `optimizePackageImports`
  (`node_modules/next/dist/server/config.js:988`), so the 47 icon-importing modules are barrel-optimised
  automatically.
- `app/public-home.css` is scoped to `app/(public)/layout.tsx` rather than the root layout — exactly
  what PERF-10 asks for on the portal side.
- `app/(public)/page.tsx:37` — `export const dynamic = "error"` forces the marketing homepage to be
  statically generated and fails the build if anything makes it dynamic.

---

## 4. Suggested PRs

Independent, parallelisable units. File overlaps between my own PRs are flagged.

| PR | Scope | Findings | Files | Effort | Risk |
|---|---|---|---|---|---|
| **A** | Batch the attendance-save write path: replace the six per-change reads with `inArray` reads over the whole change set, collapse the upsert to bulk `values([...])` with `excluded.choice`, and batch the reconcile pass. | PERF-1, PERF-19 | `lib/sessions/service.ts`, `lib/attendance/adjustments.ts` | L | **High** — touches conflict detection (`expectedChoice`) and the adjustment review invariant. Needs the existing attendance test suite green before merge. |
| **B** | Batch monthly fee preparation: hoist existing-charge, prior-period and recurring-concession probes out of the loop; pre-allocate fee references in one pass; bulk-insert charges and audit rows. | PERF-2 | `lib/finance/service.ts` | XL | **High** — idempotency keys, fee-reference uniqueness and audit metadata all in scope. Overlaps PR C and PR D in `lib/finance/service.ts`. |
| **C** | Swap `loadChargeView`-in-loop for `loadChargeViews` at every site. Pure mechanical substitution against an existing, tested helper. | PERF-3, PERF-9 | `lib/finance/documents.ts`, `lib/finance/service.ts` | M | Low — `loadChargeViews` already preserves per-charge ordering and null semantics by design. **Overlaps PR B and PR D in `lib/finance/service.ts`.** |
| **D** | Rebuild `withdrawalRefundablePaymentAllocations` on the batched helpers already in `lib/finance/repository.ts`. | PERF-8 | `lib/finance/service.ts` (+ export a few helpers from `lib/finance/repository.ts`) | M | Medium — refund eligibility is money-critical; the batched helpers were written to mirror it, so behaviour should be identical, but needs refund tests. **Overlaps PR B and PR C.** |
| **E** | Fix the announcements 1+N: one `inArray` channels read; replace the dashboard count with `count(*)`; drop the duplicate page call. | PERF-5 | `lib/announcements/queries.ts`, `app/coach/announcements/page.tsx`, `app/coach/page.tsx` | S | Low |
| **F** | Batch staff attendance read and write: one `inArray` record read, one access check, one bulk upsert; remove the duplicated `getCoachAccessProfile`. | PERF-6, PERF-7 | `lib/coach/staff-attendance.ts`, `app/coach/attendance/staff/record/page.tsx`, `app/coach/attendance/staff/register/page.tsx` | M | Low |
| **G** | Scope the financial-activity and collections reads to the requested page/range; make CSV exports do a single unpaginated pass. | PERF-4, PERF-16, PERF-17 | `lib/finance/records.ts`, `app/coach/financials/records/activity.csv/route.ts`, `app/coach/financials/collections.csv/route.ts`, `app/coach/financials/records/fees.csv/route.ts` | M | Medium — summary totals are computed over the *full* filtered set, so narrowing the reads must not narrow the summary. |
| **H** | Scope the dashboard over-fetches to existing narrow helpers. | PERF-14, PERF-15 | `lib/data/sqlite-portal-repository.ts`, `lib/coach/database.ts` | S | Low — the scoped helpers already exist and are used elsewhere. |
| **I** | Indexes and predicate shape: rewrite the `LIKE` to a half-open range; add `concession_applications(concession_id)`; optionally add the composite `accounts` directory index. New migration. | PERF-12, PERF-13, PERF-25 | `lib/attendance/database.ts`, `lib/db/schema.ts`, `drizzle/0029_*.sql` | S | Low — additive indexes; the `LIKE`→range rewrite is semantically identical for `YYYY-MM-DD` keys. |
| **J** | Memoise `Intl` formatters by option key in `lib/format.ts`; hoist `getAcademyDateKey(now)` out of `chargeView`; hoist the component-level formatter constructors to module scope. | PERF-18 | `lib/format.ts`, `lib/finance/repository.ts`, and the 12 component files listed in PERF-18 | S | Low — identical options produce identical output. **Overlaps PR C and PR D in `lib/finance/repository.ts`.** |
| **K** | Replace `motion` in the three welcome heroes with a CSS `@keyframes` fade plus a `prefers-reduced-motion` rule; the heroes then become Server Components. | PERF-11 | `components/dashboard/welcome-hero.tsx`, `components/coach/coach-welcome-hero.tsx`, `components/coach/junior-coach-welcome-hero.tsx`, `app/globals.css` | S | Low — visual parity should be verified against the existing visual-regression snapshots. **Overlaps PR L in `app/globals.css`.** |
| **L** | Split portal-only rules out of `app/globals.css` into layout-scoped stylesheets for `app/coach/`, `app/admin/` and `app/(student)/`. | PERF-10 | `app/globals.css`, new `app/coach/coach.css` etc., `app/coach/layout.tsx`, `app/(student)/layout.tsx` | M | Medium — the partition must be verified against the visual-regression suite; my classifier is a lower bound, not an authority on which rules are truly portal-only. **Overlaps PR K in `app/globals.css`.** |
| **M** | Narrow the single-announcement lookups; wrap `getCoachAccessProfile` and `readFinanceActivation` in `React.cache`; fix the double `listFinancePlayers`. | PERF-21, PERF-20 (duplicate-read part only), PERF-22 | `lib/announcements/queries.ts`, `lib/auth/coach-access.ts`, `lib/finance/repository.ts`, `lib/finance/service.ts` | S | Low. **Overlaps PR E in `lib/announcements/queries.ts`; overlaps PR C/D/J in the finance files.** |

**Suggested ordering given the overlaps:** land I, H, E, K in parallel first (no shared files, all
low risk). Then C, then D, then B sequentially in `lib/finance/service.ts`. J and M last, since they
touch files that C/D/B will have rewritten. A and F are independent of the finance chain and can run
in parallel with it throughout. L should wait until K has settled `app/globals.css`.
