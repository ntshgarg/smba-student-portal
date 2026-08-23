# SMBA Student Portal — Implementation Quality, Maintainability and Technical Debt Audit

Lens: implementation quality, maintainability, technical debt, component de-duplication.
Repository: `/Users/nitishg/smba-student-portal`, branch `audit/fresh-pass`. Read-only pass.
Toolchain observed: TypeScript 5.9.3, ESLint 9.39.5, Node v22.17.0, Next.js 16.2.12, React 19.2.8, Vitest 3.2.4.

---

## 1. Method

### 1.1 Scope discipline

`output/` exists locally and holds 132,048 `.ts/.tsx/.js/.jsx/.mjs` files — extracted worktrees of this repository at older commits. `snapshots/`, `tmp/`, `test-results/` and `playwright-report/` do **not** currently exist.

```
$ for d in output snapshots tmp test-results playwright-report .next; do printf "%-20s " "$d"; if [ -d "$d" ]; then echo "$(find "$d" -maxdepth 1 -mindepth 1 | wc -l | tr -d ' ') top-level entries"; else echo "MISSING"; fi; done
output               17 top-level entries
snapshots            MISSING
tmp                  MISSING
test-results         MISSING
playwright-report    MISSING
.next                25 top-level entries
---- ts/tsx counts in scratch dirs ----
output               132048
```

Every search in this audit used `rg` (gitignore-aware) or was explicitly scoped to `app components lib tests scripts drizzle .github` plus root config. **No finding in this report cites a path under `output/`, `snapshots/`, `tmp/`, `test-results/` or `playwright-report/`.** All duplicate-block evidence below was produced by a detector whose file list was built by walking `lib/`, `components/` and `app/` only.

### 1.2 Real source inventory

```
$ for d in app components lib tests scripts drizzle; do printf "%-12s ts/tsx=%s\n" "$d" "$(find $d -name '*.ts' -o -name '*.tsx' | wc -l | tr -d ' ')"; done
app          ts/tsx=99
components   ts/tsx=93
lib          ts/tsx=90
tests        ts/tsx=187
scripts      ts/tsx=11
drizzle      ts/tsx=0
```

### 1.3 Verification commands actually run

```
$ npx tsc --version
Version 5.9.3
$ npx eslint --version
v9.39.5
$ node --version
v22.17.0

$ npx tsc --noEmit
tsc exit=0            # no output whatsoever

$ npx eslint .
eslint exit=0         # no output whatsoever
```

Both gates are clean on this working tree. There are **zero** type errors and **zero** lint findings. No errors were produced by stale artefacts under `.next` or `output`. That said, section 2 shows that the `tsc` result is not the same result CI computes, which is itself the highest-value finding in this report.

Other read-only commands run (all outputs quoted inline in the findings):

- `npx tsc --noEmit --listFiles | grep -E "/\.next/"` — to determine which build artefacts enter the typecheck program.
- `git ls-files .next | wc -l` and `git check-ignore -v .next/types/validator.ts` — to confirm those artefacts are not committed.
- A `node` duplicate-block detector over `lib/ components/ app/`: whitespace-normalised line matching, reporting every run of ≥ 8 identical meaningful lines between any two files. 56 blocks found; the top 35 are listed in IQ-4.
- A `node` import-graph builder over `lib/ components/ app/` with value-level (non-`import type`) edges and DFS cycle detection.
- A `node` `catch`-block analyser that brace-matches each `catch` body and reports whether the error binding exists and is referenced.
- A `node` dead-export analyser over `lib/` and `components/`, searching `lib components app tests scripts drizzle .github` **plus repository-root files** (`instrumentation.ts`, `instrumentation-client.ts`, `proxy.ts`, `next.config.ts`, `drizzle.config.ts`, `package.json`), then a second pass separating "used inside its own file but over-exported" from "referenced nowhere at all", then a third manual `rg` pass per candidate across the whole repo excluding `output/`, `node_modules/` and `.next/`.
- A `node` `"use client"` analyser that, for each of the 62 directives, resolves every `useXxx(` call in the file — including custom hooks — before judging necessity.

### 1.4 Landmines checked and cleared (retracted candidate findings)

These are candidate findings I formed and then **disproved**. They are recorded because each would have been a wrong claim.

| Candidate | Why it is not a finding |
| --- | --- |
| `components/coach/reports-card.tsx` has `"use client"` but no React hook, no event handler and no browser API | It calls `useReportResume()` (line 25), a **custom** hook defined at `components/coach/reports/report-resume.ts:44` which uses `useState`, `useEffect`, `useCallback` and `window.localStorage`. The directive is required. This was the only file in the repo that survived the first-pass filter, and it is a false positive. |
| Nine `*Relations` exports plus `batchMemberships` in `lib/db/schema.ts` appear unreferenced | `lib/db/client.ts:10` does `import * as schema from "@/lib/db/schema"` and line 49 passes it to `drizzle(sqlite, { schema })`. Every export is consumed through the namespace object. Not dead. |
| `scripts/regression/failure-evidence-sanitizer.ts` duplicates `lib/telemetry/redaction.ts` | It is a 7-line re-export shim (`export { sanitizeFailureText, sanitizeFailureUrl } from "../../lib/telemetry/redaction"`) deliberately preserving an import path for Playwright fixtures. Correct de-duplication, not duplication. |
| `lib/telemetry/install-rejection-reporter.ts` and `lib/operations/record-request-error.node.ts` exports appear unreferenced | Both are reached from repository-root `instrumentation-client.ts` / `instrumentation.ts`, which my first corpus omitted. Adding root files removed them from the list. |
| 3 test cases appear to contain zero `expect()` calls | False positive: my brace-matcher was confused by `{`/`}` inside regex literals such as `/\.coach-register-period button \{([^}]*)\}/`. Manual reading of all three (`tests/accessibility-hardening.test.ts:62`, `tests/p3-interface-hardening.test.ts`, `tests/phase3-accessibility-corrections.test.ts:50`) shows 6, 7 and 5 assertions respectively. **There are no assertion-free tests in this suite.** |
| 14 server-action modules appear to have no unit test | Shell-quoting bug in my first sweep. Corrected sweep shows 9 of 14 are directly imported by vitest tests. Only 5 are not; see DEBT-6. |
| The comment in `vitest.config.ts:16-18` claiming CLI `--exclude` *adds* to the config exclude list | Verified true against the installed Vitest 3.2.4: `node_modules/vitest/dist/chunks/coverage.DfSpMS-b.js:3686` reads `if (resolved.cliExclude) resolved.exclude.push(...resolved.cliExclude)`. The comment is accurate and `npm run test:ci` does not lose the `**/output/**` guard. |
| `components/dashboard/welcome-hero.tsx`, `coach-welcome-hero.tsx` and `junior-coach-welcome-hero.tsx` are three copies of one component | They share an 11-line byte-identical block and a motion preamble, but their payloads are genuinely different (coach message quote vs. session briefing with metrics vs. nothing). Collapsing them into one prop-driven hero would be a mistake. Only the shared fragment should be extracted — see IQ-9. |
| `lib/attendance/domain.ts:79-88` duplicates `lib/types.ts:39-48` | Similar but deliberately different: the `types.ts` occurrence carries `durationMinutes` and a required `startsAt`; the `domain.ts` occurrence makes `startsAt` optional and omits `durationMinutes`, and its assignment has no `id`. The domain type is a narrower input contract for pure functions. Not a duplicate. |
| `components/coach/player-attendance-register.tsx` and `staff-attendance-register.tsx` are duplicate components | Their *chrome* is duplicated (IQ-5) but their row model, cell semantics, filter surface and data sources differ substantially (players have session occurrences, enrolment windows, make-up adjustments and review flags; staff have a flat coach × date grid). Merging into one component would be wrong; extracting the table scaffold is right. |

### 1.5 Honest limits

- I did not start a dev server, run Playwright, or run `npm run test` / `npm run test:ci`. Every claim about test *behaviour* below is derived from reading test source and from configuration, not from observed runs. Where that matters I have said so and given the exact command.
- I could not empirically demonstrate the CI-vs-local typecheck divergence in IQ-1 by deleting `.next`, because that would modify the working tree. The claim is instead settled deductively from three independently observed facts (program file list, gitignore status, CI job steps) and I give the exact reproduction command.
- CSS is out of my lens except where it is orphaned by dead TypeScript (DEBT-3). I did not audit `app/globals.css` for anything else.

---

## 2. Findings

Ordered by severity, then confidence. Verification-honesty findings are ranked first within their severity band.

---

### IQ-1 — The typecheck gate silently checks a different set of files in CI than it does locally, because its `include` reaches into gitignored build output

- **Classification:** configuration
- **Type:** Objective defect
- **Severity:** High
- **Location:** `tsconfig.json:32-33` (the two `.next` globs in `include`), `tsconfig.json:38` (`exclude` opts out only `.next/dev`), `.gitignore:2`, `.github/workflows/quality.yml:27-44` (the `static` job), `package.json:16` (`"typecheck": "tsc --noEmit"`)
- **Evidence:**

The config deliberately pulls generated route validators into the program:

```23:38:tsconfig.json
  "include": [
    "next-env.d.ts",
    "*.ts",
    "*.tsx",
    "app",
    "components",
    "lib",
    "scripts",
    "tests",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  // .next/dev/types is written by next dev and keeps validators for routes that
  // have since been deleted; next build filters the same directory out of its own
  // type check for that reason, and a bare tsc has no such filter.
  "exclude": ["node_modules", "output", "coverage", ".next/dev"]
```

Those files are in the program on this machine:

```
$ npx tsc --noEmit --listFiles | grep -E "/\.next/" | sed 's|.*/smba-student-portal/||' | sort
.next/types/cache-life.d.ts
.next/types/routes.d.ts
.next/types/validator.ts
$ grep -c "Validate " .next/types/validator.ts
67
```

They are not committed:

```
$ git ls-files .next | wc -l
       0
$ git check-ignore -v .next/types/validator.ts
.gitignore:2:/.next	.next/types/validator.ts
```

And CI runs `typecheck` on a bare checkout with no build step between `npm ci` and `tsc`:

```43:47:.github/workflows/quality.yml
      - name: Type-check
        run: npm run typecheck

      - name: Validate migrations
        run: npm run db:check
```

The `static` job's full step list is: checkout → setup-node → `npm ci` → `npm run lint` → `npm run typecheck` → `npm run db:check`. `actions/setup-node` with `cache: npm` caches `~/.npm`, not `.next`. Therefore `.next/types/**/*.ts` matches nothing in CI, the glob contributes zero files, and `tsc` exits 0 having checked 3 fewer files than it did here — including the 596-line `validator.ts` that asserts the export shape of all 67 pages, layouts and route handlers.

- **Why it matters:** The result of `npm run typecheck` is a function of whether a gitignored directory happens to exist. Locally after a build it is a stronger gate; in CI it is a weaker one; and after a *stale* build it can be a false-failure gate, because `.next/types/validator.ts` from an older `next build` still `import`s route modules that may have been deleted. The tsconfig comment shows the authors understood this hazard and opted out only the `next dev` copy — the `next build` copy carries the identical hazard and was left in. This undermines every other guarantee in the repository, because "typecheck is green" does not mean the same thing twice.
- **User impact:** No direct end-user impact. The impact falls on maintainers and on the reliability of the merge gate: a change that breaks a page's `generateMetadata` signature or a route handler's `params` type can merge green and only fail at `next build` time in the browser job (or, if that job's build succeeds for other reasons, in production deploy).
- **Effort:** S
- **Confidence:** High (each premise directly observed; the CI conclusion is deductive, not runtime-observed)
- **How to prove:** In a scratch clone so the working tree is untouched — `git clone . /tmp/smba-tsc-check && cd /tmp/smba-tsc-check && npm ci && npx tsc --noEmit --listFiles | grep -c '/\.next/'` — expect `0`, versus `3` here. For the stale-artefact direction: `cd /tmp/smba-tsc-check && npm run build && git checkout HEAD~5 -- app && npx tsc --noEmit` and observe validator errors for routes that no longer exist.
- **Suggested fix:** Either (a) add `.next` (not just `.next/dev`) to `exclude` and rely on `next build` for route validation — the browser job already runs `npm run build`; or (b) keep the globs and add a `next build` step to the `static` job before `typecheck` so the artefact is always present and always fresh. Option (a) is smaller and makes the gate deterministic; option (b) makes it stronger but slower.

---

### DEBT-1 — Five end-to-end specs, 1,186 lines and 26 test cases, are never executed by any pipeline

- **Classification:** test quality / dead code
- **Type:** Objective defect
- **Severity:** High
- **Location:**
  - `tests/e2e/phase8-followup.spec.ts` (93 lines, 6 cases) and its only runner `tests/e2e/playwright.phase8-followup.config.ts` — the config is referenced by **nothing**: not `package.json`, not `.github/`, not `tests/e2e/README.md`
  - `tests/e2e/responsive-overflow.spec.ts` (525 lines, 7 cases)
  - `tests/e2e/accessibility-hardening.spec.ts` (217 lines, 6 cases)
  - `tests/e2e/phase3c-interface-correctness.spec.ts` (162 lines, 3 cases) — these three are matched only by `tests/e2e/playwright.responsive-overflow.config.ts:15-20`, which has no npm script and no workflow step; its sole reference is a manual instruction at `tests/e2e/README.md:110`
  - `tests/e2e/capture-regression.spec.ts` (189 lines, 4 cases) — run by `playwright.config.ts` via `npm run regression:capture` (`package.json:50`), referenced only from `README.md:306`, absent from both workflows
- **Evidence:**

```
$ for c in $(find tests/e2e -name 'playwright*.config.ts'); do n=$(basename $c); printf "%-55s refs=%s\n" "$n" "$(rg -c --no-filename "$n" package.json .github tests scripts | paste -sd+ - | bc)"; done
playwright.registration-resilience.config.ts            refs=3
playwright.attendance-workspaces.config.ts              refs=2
playwright.finance.config.ts                            refs=1
playwright.phase8-followup.config.ts                    refs=
playwright.onboarding.config.ts                         refs=2
playwright.authentication.config.ts                     refs=2
playwright.config.ts                                    refs=4
playwright.failure-evidence.config.ts                   refs=1
playwright.accessibility.config.ts                      refs=2
playwright.responsive-overflow.config.ts                refs=1
```

```
$ rg -n "phase8-followup|responsive-overflow" --glob '!output/**' .
./tests/e2e/playwright.responsive-overflow.config.ts:11:  outputDir: path.resolve("output/responsive-overflow/playwright-artifacts"),
./tests/e2e/playwright.responsive-overflow.config.ts:19:    "responsive-overflow.spec.ts",
./tests/e2e/README.md:110:npx playwright test -c tests/e2e/playwright.responsive-overflow.config.ts
./tests/e2e/playwright.phase8-followup.config.ts:18:  testMatch: "phase8-followup.spec.ts",
```

`playwright.responsive-overflow.config.ts` is the only config matching three of these specs:

```14:20:tests/e2e/playwright.responsive-overflow.config.ts
  testDir: ".",
  testMatch: [
    "accessibility-hardening.spec.ts",
    "authentication-responsive.spec.ts",
    "phase3c-interface-correctness.spec.ts",
    "responsive-overflow.spec.ts",
  ],
```

(`authentication-responsive.spec.ts` is the exception — it is also matched by `playwright.authentication.config.ts` which *is* wired into `quality.yml:222-223`.)

For contrast, the eight specs that do run in CI total 2,617 lines / 33 cases across `quality.yml` (registration, finance, authentication, onboarding, attendance, failure-evidence sentinel) and `ui-accessibility.yml` (accessibility-regression, accessibility-sentinel).

- **Why it matters:** 31% of the end-to-end spec corpus (5 of 13 files, 26 of 59 cases) contributes nothing to the merge gate. Worse, it is not obviously inert — the files are present, well-named, and in the same directory as the specs that do run, so a reader counting "187 test files" over-estimates protection. `playwright.phase8-followup.config.ts` is a config with literally no caller, which is dead code that looks like infrastructure. These specs are also silently rotting: nothing tells anyone when they stop compiling or stop passing.
- **User impact:** Falls on maintainers, with a downstream risk to users: whatever behaviour `responsive-overflow.spec.ts` (525 lines) and `phase3c-interface-correctness.spec.ts` were written to protect is currently unprotected, so regressions in those areas reach production without a failing check.
- **Effort:** M (decide per file: wire into CI, or delete; then wire the keepers into a workflow)
- **Confidence:** High (proved by reference search over `package.json`, `.github/`, `tests/`, `scripts/`)
- **How to prove:** Already proved. To confirm the specs still pass before wiring them in: `npm run fixture:start:stress` in one shell, then `npx playwright test -c tests/e2e/playwright.responsive-overflow.config.ts` — but do not run this while other agents hold port 3000 and the `.data/*.db` fixtures.

---

### IQ-2 — The finance audit event-type list is hand-maintained in five places and two of them have drifted, making one event class unfilterable

- **Classification:** duplication / type safety
- **Type:** Objective defect
- **Severity:** High
- **Location:**
  - `lib/finance/types.ts:639-659` — the canonical union `FinanceAuditEventType` (20 members)
  - `lib/db/schema.ts:984-1005` — the Drizzle column enum (20 members)
  - `lib/finance/service.ts:165-186` — `FINANCE_AUDIT_EVENT_TYPES`, the service-input validator (20 members)
  - `lib/finance/records.ts:380-401` — `ACTIVITY_ACTIONS`, the label map (20 members)
  - `app/coach/financials/records/activity.csv/route.ts:19-38` — `EVENT_TYPES`, the CSV filter allow-list (**19 members**)
  - `app/coach/financials/records/page.tsx:46-66` — `ACTIVITY_TYPES`, the on-screen filter dropdown (**19 members**)
- **Evidence:**

```
$ node -e '...extract quoted snake_case values from each range and diff against the union...'
 20 values  lib/finance/types.ts:639-659 (union)   (complete)
 20 values  lib/db/schema.ts:984-1006 (drizzle enum)   (complete)
 20 values  lib/finance/service.ts:165-186 (FINANCE_AUDIT_EVENT_TYPES)   (complete)
 19 values  app/coach/financials/records/activity.csv/route.ts:19-38 (EVENT_TYPES)   MISSING: training_start_redated
 19 values  app/coach/financials/records/page.tsx:46-66 (ACTIVITY_TYPES)   MISSING: training_start_redated
```

The event is genuinely written by the service:

```
$ rg -n --glob '!output/**' "training_start_redated" app components lib
lib/db/schema.ts:1004:      "training_start_redated",
lib/finance/records.ts:400:  training_start_redated: "Training start date corrected",
lib/finance/service.ts:1462:      if (replay.eventType !== "training_start_redated"
lib/finance/service.ts:1590:      eventType: "training_start_redated",
lib/finance/service.ts:1594:        operation: "training_start_redated",
lib/finance/service.ts:185:  "training_start_redated",
lib/finance/types.ts:659:  | "training_start_redated"
```

Both drifted copies are unenforced arrays that need a cast to be usable, which is exactly what suppresses the compiler error:

```84:87:app/coach/financials/records/activity.csv/route.ts
  const eventValue = url.searchParams.get("eventType")
  const eventTypes = EVENT_TYPES.includes(eventValue as FinanceAuditEventType)
    ? [eventValue as FinanceAuditEventType]
    : undefined
```

The one copy that is *not* an array is complete, and it is complete precisely because its type forces exhaustiveness:

```380:381:lib/finance/records.ts
const ACTIVITY_ACTIONS: Record<FinanceAuditEventType, string> = {
  finance_activated: "Financial tracking activated",
```

- **Why it matters:** Five hand-maintained copies of one closed set is a guaranteed drift generator, and it has already drifted. The type system could have caught it — `Record<FinanceAuditEventType, …>` did catch it, four lines of code away — but the two array copies are typed `FinanceAuditEventType[]`, which permits a subset, and the `as FinanceAuditEventType` cast on the query parameter removes the last chance for the compiler to complain. This is the type system being worked around rather than used.
- **User impact:** A head coach on `/coach/financials/records` cannot filter the financial activity log to "Training start date corrected" events, either on screen or in the CSV export, because the option is absent from the dropdown and the export's allow-list would reject the value anyway (falling back to `eventTypes: undefined`, i.e. an unfiltered export, with no error shown). The events themselves are recorded and do appear in the unfiltered list, so this is a missing capability rather than data loss — but a billing correction is exactly the kind of event an academy owner audits by filter.
- **Effort:** S
- **Confidence:** High (proved by extraction and diff of all five ranges)
- **Suggested fix:** Derive everything from one source. Export `const FINANCE_AUDIT_EVENT_TYPES = [...] as const satisfies readonly FinanceAuditEventType[]` from `lib/finance/types.ts`, define `FinanceAuditEventType = (typeof FINANCE_AUDIT_EVENT_TYPES)[number]`, drop the schema enum to a spread of it, and build the UI options from `ACTIVITY_ACTIONS` (which is already `Record`-enforced) rather than from a fourth hand-written array. Replace `EVENT_TYPES.includes(x as T)` with a type-predicate helper so the cast disappears.

---

### IQ-3 — Eleven of thirteen server-side `console.error` calls discard the caught error, so every 500 in the export and download surface is undiagnosable

- **Classification:** error handling
- **Type:** Objective defect
- **Severity:** High
- **Location:** all sites listed
  - `app/(student)/player/page.tsx:30`
  - `app/(student)/player/reports/[reportId]/download/route.ts:48`
  - `app/api/health/route.ts:23`
  - `app/api/public/announcements/route.ts:17`
  - `app/api/session-summary/route.ts:33`
  - `app/coach/financials/collections.csv/route.ts:88`
  - `app/coach/financials/players/[playerId]/statement/download/route.ts:71`
  - `app/coach/financials/receipts/[paymentId]/download/route.ts:71`
  - `app/coach/financials/records/activity.csv/route.ts:114`
  - `app/coach/financials/records/fees.csv/route.ts:103`
  - `app/coach/reports/publications/[publicationId]/download/route.ts:69`
- **Evidence:**

```
$ node -e '...for every console.error in app|lib|components, check whether an error value appears in the call...'
console.error WITH an error value: 2
console.error WITHOUT any error value: 11
   app/(student)/player/page.tsx:30   console.error("Player announcement lookup failed.")
   app/(student)/player/reports/[reportId]/download/route.ts:48   console.error("Monthly report PDF generation failed.", { reportId })
   app/api/health/route.ts:23   console.error("Health check database probe failed.")
   app/api/public/announcements/route.ts:17   console.error("Public announcement lookup failed.")
   app/api/session-summary/route.ts:33   console.error("Session summary lookup failed.")
   app/coach/financials/collections.csv/route.ts:88   console.error("Financial collections export failed.", {
   app/coach/financials/players/[playerId]/statement/download/route.ts:71   console.error("Player fee statement PDF generation failed.", { playerId })
   app/coach/financials/receipts/[paymentId]/download/route.ts:71   console.error("Financial receipt PDF generation failed.", { paymentId })
   app/coach/financials/records/activity.csv/route.ts:114   console.error("Financial activity export failed.", { from, to })
   app/coach/financials/records/fees.csv/route.ts:103   console.error("Financial fee-register export failed.", { mode, period })
   app/coach/reports/publications/[publicationId]/download/route.ts:69   console.error("Coach report PDF generation failed.", { publicationId })
```

Two distinct shapes produce this. Some bind the error, use it for a typed branch, then never log it:

```62:74:app/coach/financials/players/[playerId]/statement/download/route.ts
  } catch (error) {
    if (error instanceof FinanceServiceError && error.code === "AUTHORIZATION") {
      return new Response("Coach access is required.", {
        headers: privateHeaders,
        status: 403,
      })
    }
    console.error("Player fee statement PDF generation failed.", { playerId })
    return new Response("Unable to generate the financial record.", {
      headers: privateHeaders,
      status: 500,
    })
  }
```

Others do not bind it at all, which discards the cause by construction:

```68:73:app/coach/reports/publications/[publicationId]/download/route.ts
  } catch {
    console.error("Coach report PDF generation failed.", { publicationId })
    return new Response("Unable to generate report.", {
      headers: privateHeaders,
      status: 500,
    })
  }
```

A repository-wide count of `catch` blocks:

```
catch with NO binding (cause discarded by construction): 57
catch (e) where e is never referenced: 0
catch that does reference the error: 66
```

Most of the 57 are deliberate and well-commented (`lib/client/attendance-draft-storage.ts:140,182,189,199`, `lib/telemetry/report-client-error.ts:88`, `components/coach/reports/report-resume.ts:54,66` all carry an explanatory comment about tolerated storage failure). The subset that matters is the eleven above, where the code has decided the failure *is* worth a log line but throws away the only part of it that identifies the cause.

- **Why it matters:** When a coach reports "the receipt download gives an error", the production log contains `Financial receipt PDF generation failed. { paymentId: 'pay_…' }` and nothing else. No message, no stack, no indication whether it was pdfkit, a null field, a SQLite lock or an OOM. There is a plausible intent here — the CI pipeline sanitises server logs (`quality.yml:134-136`, `scripts/regression/sanitize-server-log.ts`) so log hygiene is clearly a concern — but the project already owns the right tool for that and is not using it: `lib/telemetry/redaction.ts` exports `sanitizeFailureText`, and it is imported by exactly one module (`lib/telemetry/error-report.ts:1`). Dropping the whole error is a much blunter instrument than redacting it.
- **User impact:** Falls on maintainers and on incident response. Indirectly on the head coach and platform admin, who are the roles that hit these seven finance/report download endpoints and who will wait longer for a fix because the first diagnostic step is unavailable.
- **Effort:** S
- **Confidence:** High (proved)
- **Suggested fix:** `console.error("…failed.", { playerId, cause: sanitizeFailureText(error instanceof Error ? (error.stack ?? error.message) : String(error)) })`, with a small shared helper in `lib/telemetry/` so all eleven sites are identical.

---

### DEBT-2 — One fifth of the unit suite tests source text rather than behaviour, so those tests can pass a broken implementation and fail a correct refactor

- **Classification:** test quality
- **Type:** Objective defect
- **Severity:** High
- **Location:** 31 vitest files call `readFileSync` on source; 14 of them make substantive `toContain`/`toMatch` assertions against component and page source. Highest-density sites:

| File | cases | `expect()` | `toContain`/`toMatch` |
| --- | --- | --- | --- |
| `tests/finance-fee-record-navigation.test.ts` | 7 | 50 | 50 |
| `tests/accessibility-hardening.test.ts` | 4 | 37 | 36 |
| `tests/coach-financials-phase2-ui.test.ts` | 3 | 36 | 36 |
| `tests/ci-security-controls.test.ts` | 5 | 35 | 30 |
| `tests/route-recovery.test.ts` | 4 | 27 | 27 |
| `tests/ci-diagnostics-controls.test.ts` | 4 | 20 | 20 |
| `tests/ci-reliability.test.ts` | 3 | 22 | 20 |
| `tests/p3-interface-hardening.test.ts` | 5 | 20 | 19 |
| `tests/operational-action-results.test.ts` | 8 | 30 | 15 |
| `tests/phase3-accessibility-corrections.test.ts` | 3 | 15 | 12 |
| `tests/session-workspace-separation.test.ts` | 2 | 9 | 9 |
| `tests/attendance-return-navigation.test.ts` | 2 | 7 | 7 |
| `tests/coach-portal-composition.test.ts` | 2 | 10 | 6 |
| `tests/coach-access-denial-notice.test.tsx` | 4 | 10 | 6 |

- **Evidence:** Suite totals: 153 non-e2e vitest files, 694 `it`/`test` cases, 2,916 `expect()` calls; 320 of those assertions (11%) are string matches against source text.

```10:20:tests/accessibility-hardening.test.ts
describe("authentication error focus", () => {
  it("returns focus after every failed login response", () => {
    const login = source("components/login-form.tsx")

    expect(login).toContain("const academyIdRef = useRef<HTMLInputElement>(null)")
    expect(login).toContain("ref={academyIdRef}")
    expect(login).toContain("window.setTimeout(() => academyIdRef.current?.focus(), 0)")
    expect(login).toContain("submissionStartedRef.current = true")
    expect(login).toMatch(/useEffect\(\(\) => \{[\s\S]*?\}, \[pending, state\]\)/)
    expect(login).not.toContain("[state.error]")
  })
```

```11:21:tests/finance-fee-record-navigation.test.ts
  it("uses bounded server windows for each Fee Records view", () => {
    const route = source("app/coach/financials/records/page.tsx")

    expect(route).toContain("const PAGE_SIZE = 10")
    expect(route).toContain("const COLLECTION_PAGE_SIZE = 10")
    expect(route).toContain("const ACTIVITY_PAGE_SIZE = 20")
    expect(route).toContain("const cursor = trail.at(-1)")
    expect(route).toContain("pageSize: PAGE_SIZE")
    expect(route).toContain("pageSize: COLLECTION_PAGE_SIZE")
    expect(route).toContain("pageSize: ACTIVITY_PAGE_SIZE")
  })
```

- **Why it matters:** Three concrete failure modes, all present here.
  1. **Weak enough to pass a broken implementation.** `expect(route).toContain("pageSize: PAGE_SIZE")` passes whether or not paging works, whether or not the cursor advances, and whether or not the page renders. Nothing is executed.
  2. **Fails on correct refactors.** Changing `useRef<HTMLInputElement>(null)` to `useRef<HTMLInputElement | null>(null)`, or renaming `academyIdRef`, breaks `tests/accessibility-hardening.test.ts:14` while behaviour is unchanged. This is a tax on every future edit to these files and it pushes maintainers toward not refactoring.
  3. **Satisfiable by the wrong thing.** A `toContain` on source text passes if the literal appears anywhere in the file, including inside a comment or a dead branch.

  There is also a specific interaction with IQ-6: `tests/accessibility-hardening.test.ts:14-19` asserts the focus-restoration block in `components/login-form.tsx` only. That block exists five times in the codebase. If someone fixed a bug in one copy and not the others, this test would still be green.

  I want to be fair about the subset that is defensible: `ci-security-controls`, `ci-diagnostics-controls` and `ci-reliability` read `.github/workflows/*.yml`, where the artefact under test genuinely *is* text and there is no runtime to exercise. Those three (70 of the 320 assertions) are a reasonable use of the technique. The ~250 assertions against `.tsx`/`.ts` component and page source are not.
- **User impact:** Falls on maintainers. The indirect user risk is that the suite's 187-file, 694-case volume reads as strong protection when a measurable slice of it cannot detect a behavioural regression.
- **Effort:** L (converting the ~14 files; the components are already testable — 22 `app/` modules are imported and executed by other tests in this same suite, so the pattern exists)
- **Confidence:** High (proved by reading the files and counting)
- **How to prove the weakness concretely:** Add a `//` comment containing the exact string `pageSize: ACTIVITY_PAGE_SIZE` to `app/coach/financials/records/page.tsx`, delete the real line, and run `npx vitest run tests/finance-fee-record-navigation.test.ts`. It will pass. (Do not do this on the shared tree.)

---

### IQ-4 — Fifty-six blocks of ≥ 8 identical lines exist across `lib/`, `components/` and `app/`; the top clusters are listed here and detailed in IQ-5 through IQ-9

- **Classification:** duplication
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** repository-wide; index below
- **Evidence:** Whitespace-normalised identical-run detector over `lib/ components/ app/` (no `output/` paths in the corpus), minimum 8 meaningful lines:

```
total blocks >=8 identical normalized lines: 56
 26  components/coach/player-attendance-register.tsx:292-317   <=>   components/coach/staff-attendance-register.tsx:175-200
 20  lib/db/schema.ts:985-1004   <=>   lib/finance/service.ts:166-185
 19  app/coach/financials/records/activity.csv/route.ts:20-38   <=>   lib/db/schema.ts:985-1003
 19  app/coach/financials/records/activity.csv/route.ts:20-38   <=>   lib/finance/service.ts:166-184
 18  lib/coach/staff-attendance.ts:296-313   <=>   lib/sessions/service.ts:565-582
 16  components/coach/player-attendance-register.tsx:275-290   <=>   components/coach/staff-attendance-register.tsx:158-173
 16  app/coach/financials/players/[playerId]/statement/download/route.ts:26-41   <=>   app/coach/financials/receipts/[paymentId]/download/route.ts:26-41
 16  app/coach/financials/players/[playerId]/statement/download/route.ts:26-41   <=>   app/coach/reports/publications/[publicationId]/download/route.ts:28-43
 16  app/coach/financials/receipts/[paymentId]/download/route.ts:26-41   <=>   app/coach/reports/publications/[publicationId]/download/route.ts:28-43
 16  lib/coach/database.ts:213-228   <=>   lib/coach/member-service.ts:226-241
 15  components/coach/junior-coach-attendance-card.tsx:195-209   <=>   components/dashboard/player-attendance-card.tsx:231-245
 15  app/coach/financials/collections.csv/route.ts:31-45   <=>   app/coach/financials/players/[playerId]/statement/download/route.ts:27-41
 15  app/coach/financials/collections.csv/route.ts:31-45   <=>   app/coach/financials/receipts/[paymentId]/download/route.ts:27-41
 15  app/coach/financials/collections.csv/route.ts:31-45   <=>   app/coach/reports/publications/[publicationId]/download/route.ts:29-43
 14  app/coach/financials/players/[playerId]/statement/download/route.ts:57-70   <=>   app/coach/financials/receipts/[paymentId]/download/route.ts:57-70
 13  app/coach/financials/records/activity.csv/route.ts:58-70   <=>   app/coach/financials/records/fees.csv/route.ts:47-59
 12  components/coach/junior-coach-attendance-card.tsx:330-341   <=>   components/dashboard/player-attendance-card.tsx:454-465
 12  components/login-form.tsx:51-62   <=>   components/recovery-form.tsx:18-29
 12  components/login-form.tsx:88-99   <=>   components/recovery-form.tsx:18-29
 11  components/app-shell.tsx:22-32   <=>   app/login/page.tsx:40-50
 11  components/coach/coach-welcome-hero.tsx:38-48   <=>   components/coach/junior-coach-welcome-hero.tsx:25-35
 11  components/coach/coach-welcome-hero.tsx:38-48   <=>   components/dashboard/welcome-hero.tsx:32-42
 11  components/coach/junior-coach-welcome-hero.tsx:25-35   <=>   components/dashboard/welcome-hero.tsx:32-42
 11  app/coach/attendance/adjustments/page.tsx:33-43   <=>   app/coach/attendance/players/record/page.tsx:42-52
 11  lib/finance/repository.ts:999-1009   <=>   lib/finance/service.ts:1290-1300
 10  components/coach/junior-coach-attendance-card.tsx:89-98   <=>   components/dashboard/player-attendance-card.tsx:103-112
 10  components/coach/junior-coach-attendance-card.tsx:292-301   <=>   components/dashboard/player-attendance-card.tsx:396-405
 10  components/coach/player-attendance-register.tsx:80-89   <=>   components/coach/staff-attendance-register.tsx:57-66
 10  components/coach/player-attendance-register.tsx:338-347   <=>   components/coach/staff-attendance-register.tsx:216-225
 10  app/activate/page.tsx:44-53   <=>   app/auth/pin/setup/page.tsx:31-40
 10  app/auth/two-factor/actions.ts:61-70   <=>   app/auth/two-factor/setup/page.tsx:26-35
 10  lib/attendance/domain.ts:79-88   <=>   lib/types.ts:39-48
 10  lib/finance/records.ts:6-15   <=>   lib/finance/repository.ts:7-16
  9  components/coach/calendar/session-calendar.tsx:43-51   <=>   components/coach/calendar/session-schedules.tsx:46-54
  9  components/coach/junior-coach-attendance-calendar.ts:60-68   <=>   components/dashboard/player-attendance-calendar.ts:226-234
```

Not every entry is actionable. `lib/finance/records.ts:6-15 <=> lib/finance/repository.ts:7-16` is a shared import list. `lib/attendance/domain.ts:79-88 <=> lib/types.ts:39-48` is the deliberately-narrower domain contract discussed in §1.4. The clusters worth acting on are broken out below.

- **Why it matters:** Index finding; see the individual entries.
- **User impact:** Maintainers.
- **Effort:** see individual findings
- **Confidence:** High (mechanical)

---

### IQ-5 — The virtualised attendance-register table scaffold is written twice, 52 identical lines across four blocks

- **Classification:** duplication
- **Type:** Objective defect
- **Severity:** Medium
- **Location:**
  - `components/coach/player-attendance-register.tsx:80-89` ↔ `components/coach/staff-attendance-register.tsx:57-66` (10 lines — window slicing)
  - `components/coach/player-attendance-register.tsx:275-290` ↔ `components/coach/staff-attendance-register.tsx:158-173` (16 lines — `<colgroup>` with leading/trailing spacer columns)
  - `components/coach/player-attendance-register.tsx:292-317` ↔ `components/coach/staff-attendance-register.tsx:175-200` (26 lines — the month header row with spacer `<th>`s)
  - `components/coach/player-attendance-register.tsx:338-347` ↔ `components/coach/staff-attendance-register.tsx:216-225` (10 lines — trailing spacer `<th>`)
- **Evidence:** The 16-line colgroup block, verbatim from the staff register:

```160:171:components/coach/staff-attendance-register.tsx
                <colgroup>
                  <col className="coach-register-name-col" />
                  {leadingDateCount ? (
                    <col className="coach-register-date-col" span={leadingDateCount} />
                  ) : null}
                  {visibleDates.map((date) => (
                    <col key={date.key} className="coach-register-date-col" />
                  ))}
                  {trailingDateCount ? (
                    <col className="coach-register-date-col" span={trailingDateCount} />
                  ) : null}
                </colgroup>
```

and its twin:

```277:288:components/coach/player-attendance-register.tsx
                    <colgroup>
                      <col className="coach-register-name-col" />
                      {leadingDateCount ? (
                        <col className="coach-register-date-col" span={leadingDateCount} />
                      ) : null}
                      {visibleDates.map((date) => (
                        <col key={date.key} className="coach-register-date-col" />
                      ))}
                      {trailingDateCount ? (
                        <col className="coach-register-date-col" span={trailingDateCount} />
                      ) : null}
                    </colgroup>
```

Both files also compute the same window derivations from the same shared hook:

```57:66:components/coach/staff-attendance-register.tsx
  const visibleDates = useMemo(
    () => dates.slice(visibleWindow.start, visibleWindow.end),
    [dates, visibleWindow.end, visibleWindow.start],
  )
  const visibleMonthGroups = useMemo(
    () => groupAttendanceDatesByMonth(visibleDates),
    [visibleDates],
  )
  const leadingDateCount = visibleWindow.start
  const trailingDateCount = dates.length - visibleWindow.end
```

and both hand-roll the same accessible column index arithmetic, `aria-colindex={visibleWindow.start + visibleIndex + 2}`, at `player-attendance-register.tsx:327,436` and `staff-attendance-register.tsx:206,248`.

**This is not a case for merging the two components.** Their row models differ fundamentally: the player register resolves session occurrences, enrolment windows, assignment coverage, make-up adjustments and review flags per cell (`player-attendance-register.tsx:404-476`); the staff register is a flat coach × date grid with a single stored choice (`staff-attendance-register.tsx:239-264`). The player register also carries a batch/level filter surface, URL-synchronised state and a 30-second reference-instant ticker that the staff register has no use for. Collapsing them behind a `mode` prop would produce a worse component.

- **Why it matters:** The duplicated part is precisely the fiddly part: spacer columns and rows that preserve `aria-colcount`/`aria-colindex` correctness while only a slice of the year is rendered. Getting that wrong produces a table that announces the wrong column position to a screen reader, and it is now maintained twice in two files that will not be edited together.
- **User impact:** Falls on maintainers today. The latent user impact is on a coach or head coach using a screen reader on `/coach/attendance/players/register` or `/coach/attendance/staff/register`, if a future fix lands in one file only.
- **Effort:** M
- **Confidence:** High (proved by identical-run detection plus reading both files end to end)
- **Suggested primitive:** A `<WindowedRegisterTable>` in `components/coach/` taking `{ dates, visibleWindow, monthGroups, nameColumnLabel, tableClassName, tableStyle, ariaLabel, rows }` and owning the colgroup, the two header rows, the spacer cells and all `aria-colindex` arithmetic — with a `renderCell(row, date, absoluteIndex)` prop for the payload. `components/coach/use-attendance-register-window.ts` and `attendance-register-utils.ts` already exist and are already shared by both files, so the extraction has a natural home.

---

### IQ-6 — Six PDF/CSV route handlers repeat the same header constant, filename sanitiser and authorisation preamble, and handle the same failure class three different ways

- **Classification:** duplication / error handling
- **Type:** Objective defect
- **Severity:** Medium
- **Location:**
  - `const privateHeaders` declared 6× — `app/coach/reports/publications/[publicationId]/download/route.ts:11`, `app/coach/financials/players/[playerId]/statement/download/route.ts:9`, `app/coach/financials/records/fees.csv/route.ts:15`, `app/coach/financials/records/activity.csv/route.ts:14`, `app/coach/financials/collections.csv/route.ts:12`, `app/coach/financials/receipts/[paymentId]/download/route.ts:9`
  - `function safeFileName` declared 4× — `app/coach/reports/publications/[publicationId]/download/route.ts:16`, `app/coach/financials/players/[playerId]/statement/download/route.ts:14`, `app/(student)/player/reports/[reportId]/download/route.ts:11`, `app/coach/financials/receipts/[paymentId]/download/route.ts:14`
  - The 401 preamble at 7 sites, the 403 preamble at 6 sites (same file list)
  - The cursor-draining generator duplicated at `app/coach/financials/records/activity.csv/route.ts:40-55` and `app/coach/financials/collections.csv/route.ts:17-27`
- **Evidence:**

```
$ rg -n --glob '!output/**' 'const privateHeaders = \{' app lib
app/coach/reports/publications/[publicationId]/download/route.ts:11:const privateHeaders = {
app/coach/financials/players/[playerId]/statement/download/route.ts:9:const privateHeaders = {
app/coach/financials/records/fees.csv/route.ts:15:const privateHeaders = {
app/coach/financials/records/activity.csv/route.ts:14:const privateHeaders = {
app/coach/financials/collections.csv/route.ts:12:const privateHeaders = {
app/coach/financials/receipts/[paymentId]/download/route.ts:9:const privateHeaders = {

$ rg -n --glob '!output/**' 'function safeFileName' app lib
app/coach/reports/publications/[publicationId]/download/route.ts:16:function safeFileName(value: string) {
app/coach/financials/players/[playerId]/statement/download/route.ts:14:function safeFileName(value: string) {
app/(student)/player/reports/[reportId]/download/route.ts:11:function safeFileName(value: string) {
app/coach/financials/receipts/[paymentId]/download/route.ts:14:function safeFileName(value: string) {
```

The sanitiser bodies are identical; only the fallback string differs:

```14:21:app/coach/financials/players/[playerId]/statement/download/route.ts
function safeFileName(value: string) {
  const normalized = value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120)
  return normalized || "SMBA-Player-Fee-Statement"
}
```

The 16-line authorisation preamble, identical in three files (detector block `26-41 <=> 26-41 <=> 28-43`):

```27:40:app/coach/financials/receipts/[paymentId]/download/route.ts
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity || identity.role !== "coach") {
    return new Response("Authentication required.", {
      headers: privateHeaders,
      status: 401,
    })
  }
  try {
    requireHeadAdminAccess(identity.subjectId)
  } catch {
    return new Response("Head coach access is required.", {
      headers: privateHeaders,
      status: 403,
    })
  }
```

The three-way inconsistency in the terminal `catch` across sibling routes that all generate a PDF:

| Route | catch shape | typed branch | 500 body |
| --- | --- | --- | --- |
| `app/coach/financials/players/[playerId]/statement/download/route.ts:62` | `catch (error)` | `FinanceServiceError && code === "AUTHORIZATION"` → 403 | `"Unable to generate the financial record."` |
| `app/coach/financials/receipts/[paymentId]/download/route.ts:62` | `catch (error)` | same | `"Unable to generate the financial record."` |
| `app/coach/reports/publications/[publicationId]/download/route.ts:68` | `catch` (no binding) | none | `"Unable to generate report."` |
| `app/(student)/player/reports/[reportId]/download/route.ts:47` | `catch` (no binding) | none | — |

- **Why it matters:** `privateHeaders` is a security-relevant constant (`Cache-Control: private, no-store` plus `X-Content-Type-Options: nosniff`) that is currently six independent copies; if one needs a new directive, five of them will not get it. The authorisation preamble is the access-control boundary for the entire finance and report download surface and it is copy-pasted six times, which means an authorisation change is six edits with six chances to miss one. And the third row of the table above shows a real behavioural asymmetry: a `FinanceServiceError` with code `AUTHORIZATION` escaping the reports route produces a 500 rather than the 403 the two finance routes produce for the identical condition.
- **User impact:** Falls mostly on maintainers, but the asymmetry is user-visible: a head coach whose access is revoked mid-session gets "Head coach access is required" (403) when downloading a receipt and an opaque "Unable to generate report" (500) when downloading a published report, for the same underlying cause.
- **Effort:** S
- **Confidence:** High (proved)
- **Suggested primitive:** `lib/http/download-route.ts` exporting `PRIVATE_DOWNLOAD_HEADERS`, `safeFileName(value, fallback)`, `requireHeadCoachOr(response)` and a `withDownloadErrorHandling(label, context, handler)` wrapper that owns the terminal `catch`, the `FinanceServiceError` → 403 branch and the sanitised `console.error` from IQ-3. This finding and IQ-3 should be fixed in the same PR.

---

### IQ-7 — `lib/finance/service.ts` is 4,355 lines and 37 exported functions mixing commands, queries and read-models in one module

- **Classification:** module structure
- **Type:** Subjective suggestion
- **Severity:** Medium
- **Location:** `lib/finance/service.ts` (whole file); the read-model cluster is `lib/finance/service.ts:3770-4355`
- **Evidence:**

```
$ find lib -name '*.ts' | while read f; do printf "%6s %s\n" "$(wc -l < "$f")" "$f"; done | sort -rn | head -6
  4355 lib/finance/service.ts
  1311 lib/finance/repository.ts
  1203 lib/db/schema.ts
  1091 lib/sessions/service.ts
  1024 lib/auth/recovery-service.ts
   782 lib/finance/types.ts
```

37 exported functions, grouped by what they do:

```
$ rg -n '^export (async )?function ([a-zA-Z]+)' lib/finance/service.ts
 576: activateFinance                             3039: createConcession
 847: createOrReplaceFeeAgreement                 3293: applyConcession
1131: previewPlayerOnboardingFinance              3327: reverseConcessionApplication
1143: completePlayerOnboardingFinance             3427: reverseConcession
1304: endFeeAgreement                             3531: applyChargeAdjustment
1428: redateConfirmedTrainingStart                3604: reverseChargeAdjustment
1605: issueRegistrationChargeForApprovedPlayer    3700: voidCharge
1636: setupExistingPlayerFinance                  ---- read side ----
1788: prepareMonthlyCharges                       3770: getFinanceActivation
2060: recordAllocatedPayment                      3776: readPlayerFinancialCloseoutState
2078: previewPaymentAllocations                   3791: resolveExistingRegistrationFee
2151: recordPayment                               3876: getPlayerFeeRecord
2215: reversePayment                              3883: getPlayerFinanceDashboardSummary
2480: previewRefundAllocations                    3899: getCoachFinancePlayerRecord
2587: recordRefund                                3915: getCoachMonthlyPreparationPreview
2890: reverseRefund                               3931: getCoachFinanceRapidDesk
                                                  3996: getCoachFinanceWorkspace
                                                  4061: getCoachFinanceDashboardSummary
                                                  4098: listFinanceCollectionEvents
                                                  4256: getFeeRegister
                                                  4287: getCollectionsDayBook
                                                  4317: getFinancialActivity
                                                  4346: listFinanceActivityCoaches
```

The longest functions inside it:

```
 241 lines  branchy-tokens= 53   lib/finance/service.ts:889-1129   buildOnboardingFinancePreview
 115 lines  branchy-tokens= 26   lib/finance/service.ts:2295-2409  withdrawalRefundablePaymentAllocations
```

- **Why it matters:** The read/write split is already visible in the file — everything from line 3770 onward is a query, everything before is a mutation — but it is a convention, not a boundary. Nothing prevents a read-model from reaching into mutation helpers or vice versa, and the file is large enough that nobody reads it end to end before editing it. It is also the single biggest merge-conflict surface in the repository: any two concurrent finance changes touch it. Note that the layering *below* this file is clean — `lib/finance/repository.ts` exists and is used — so this is an over-large orchestration layer, not an absent one.
- **User impact:** Maintainers.
- **Effort:** L
- **Confidence:** High (line counts and export list are direct measurements; "should be split" is a judgement)
- **Suggested fix:** Move lines 3770-4355 to `lib/finance/read-models.ts` and re-export from `service.ts` for one release so callers can migrate. That is a pure move of ~585 lines with no logic change, and it removes 13% of the file and all of its query surface in one low-risk step. Splitting the mutation half further (payments/refunds, concessions/adjustments, agreements/onboarding) is a larger follow-up.

---

### IQ-8 — Two React components are single functions of 912 and 688 lines

- **Classification:** module structure
- **Type:** Subjective suggestion
- **Severity:** Medium
- **Location:** `components/coach/members/member-directory.tsx:165-1076` (`MemberDirectory`), `components/coach/calendar/session-schedules.tsx:91-778` (`SessionSchedules`)
- **Evidence:** Measured by brace-matching each top-level `function` declaration; "branchy tokens" counts `if (`, ternary `?`, `&&`, `||`, `case`, `catch`, `.filter(`, `.some(`, `.every(`:

```
 912 lines  branchy-tokens=127   components/coach/members/member-directory.tsx:165-1076  MemberDirectory
 688 lines  branchy-tokens=174   components/coach/calendar/session-schedules.tsx:91-778  SessionSchedules
 466 lines  branchy-tokens= 98   components/coach/player-attendance-register.tsx:32-497  PlayerAttendanceRegister
 450 lines  branchy-tokens= 85   components/coach/attendance/player-attendance-recorder.tsx:85-534  PlayerAttendanceRecorder
 427 lines  branchy-tokens= 44   components/dashboard/player-attendance-card.tsx:55-481  PlayerAttendanceCard
 364 lines  branchy-tokens= 40   components/coach/financials/financials-rapid-desk.tsx:54-417  PaymentForm
 343 lines  branchy-tokens= 61   components/coach/reports/report-workspace.tsx:463-805  ReportWritingWorkspace
 310 lines  branchy-tokens= 47   components/coach/calendar/session-calendar.tsx:104-413  SessionCalendar
 303 lines  branchy-tokens= 24   components/coach/junior-coach-attendance-card.tsx:50-352  JuniorCoachAttendanceCard
 296 lines  branchy-tokens= 23   components/coach/coach-portal-provider.tsx:145-440  CoachPortalProvider
 293 lines  branchy-tokens= 48   components/coach/onboarding/player-onboarding-register.tsx:717-1009  FeePlanStep
```

81 functions in `app/`, `lib/` and `components/` exceed 90 lines; 11 exceed 290.

- **Why it matters:** `SessionSchedules` averages one branch every 4 lines across 688 lines in a single scope, which means every local variable is live for the whole function and no part of it can be reasoned about or tested in isolation. `MemberDirectory` is the largest single scope in the repository. Both are also among the files that the source-text tests in DEBT-2 assert against (`session-schedules.tsx` is read by 3 test files), which compounds the problem: they are hard to change *and* changing them breaks string assertions.
- **User impact:** Maintainers. The user-facing risk is elevated defect density on the coach member directory and schedule surfaces, which are among the most-used coach screens.
- **Effort:** L per component
- **Confidence:** High (line and branch counts are measured; the threshold is a judgement)
- **How to prove the branch counts independently:** `npx eslint . --rule '{"complexity":["error",20],"max-lines-per-function":["error",120]}' --no-eslintrc` is not directly runnable against a flat config, but adding `complexity` and `max-lines-per-function` to `eslint.config.mjs` and running `npx eslint components` would produce an authoritative list.

---

### IQ-9 — A hand-written 11-line SVG badminton court is duplicated verbatim in three hero components

- **Classification:** duplication
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `components/dashboard/welcome-hero.tsx:32-42`, `components/coach/coach-welcome-hero.tsx:38-48`, `components/coach/junior-coach-welcome-hero.tsx:25-35`
- **Evidence:** Byte-identical, verified by string comparison:

```
$ node -e '...compare the three 11-line ranges...'
welcome-hero 32-42 === coach-welcome-hero 38-48 : true
welcome-hero 32-42 === junior 25-35 : true
---- block ----
      <svg
        className="welcome-court welcome-scoreboard-court coach-scoreboard-court"
        viewBox="0 0 1340 610"
        fill="none"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <rect x="20" y="20" width="1300" height="570" />
        <path d="M20 63H1320M20 547H1320M94 20V590M478 20V590M862 20V590M1246 20V590M20 305H478M862 305H1320" />
        <path className="welcome-scoreboard-net coach-court-net" d="M670 20V590" />
      </svg>
```

The same three files also repeat the motion entrance preset:

```
$ rg -n --glob '!output/**' 'useReducedMotion' app components | grep -v import
components/reports/report-accordion.tsx:41:  const reduceMotion = useReducedMotion()
components/dashboard/welcome-hero.tsx:20:  const reduceMotion = useReducedMotion()
components/coach/junior-coach-welcome-hero.tsx:15:  const reduceMotion = useReducedMotion()
components/coach/coach-welcome-hero.tsx:27:  const reduceMotion = useReducedMotion()
```

with the identical `const initial = reduceMotion ? false : { opacity: 0, transform: "translateY(16px)" }` at `welcome-hero.tsx:22-24`, `coach-welcome-hero.tsx:28-30`, `junior-coach-welcome-hero.tsx:16-18`.

**The three hero components are not duplicates and must not be merged.** Their payloads are different products: the player hero renders a coach's quoted message (`welcome-hero.tsx:70-73`), the coach hero renders a session-count/next-session briefing with an empty state (`coach-welcome-hero.tsx:84-106`), and the junior-coach hero renders no ribbon at all. Their prop types share nothing but `greeting`.

- **Why it matters:** Small, but it is a 24-path SVG maintained in triplicate with three chances to diverge, and the `aria-hidden` decorative contract has to be re-asserted at each site. The motion preset duplication is the more meaningful one: `reduceMotion ? false : {...}` is the project's reduced-motion contract, and it is currently a copy-pasted idiom rather than a named thing.
- **User impact:** Maintainers.
- **Effort:** S
- **Confidence:** High (proved byte-identical)
- **Suggested primitives:** `<CourtBackdrop />` in `components/` (a pure presentational component, no `"use client"` needed since it has no hooks) and `useHeroEntrance()` in the same directory returning `{ initial, animate, transition, delayedTransition }`. Three call sites each.

---

### IQ-10 — The "restore focus to the first field after a failed server action" effect is written out five times, and only 4 of 13 action-driven forms use it

- **Classification:** duplication / error handling
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `components/login-form.tsx:51-62` and `components/login-form.tsx:88-99` (twice in one file), `components/recovery-form.tsx:18-29`, `components/recovery-reset-forms.tsx:22-33`, `components/head-coach-setup-form.tsx:23-34`
- **Evidence:** The first three are identical after trimming:

```
$ node -e '...trim-normalise and compare...'
login-form 51-62 === login-form 88-99 : true
login-form 51-62 === recovery-form 18-29 : true
--- the block ---
const academyIdRef = useRef<HTMLInputElement>(null)
const submissionStartedRef = useRef(false)
useEffect(() => {
if (pending) {
submissionStartedRef.current = true
return
}
if (!submissionStartedRef.current || !state.error) return
submissionStartedRef.current = false
const timeout = window.setTimeout(() => academyIdRef.current?.focus(), 0)
return () => window.clearTimeout(timeout)
}, [pending, state])
```

The other two differ only in the ref name (`credentialRef` at `recovery-reset-forms.tsx:31`, `fullNameRef` at `head-coach-setup-form.tsx:32`).

Coverage across every component that uses `useActionState`:

```
$ for f in $(rg -l --glob '!output/**' 'useActionState' components app); do ... done
components/activation-form.tsx                       submissionStartedRef=0  focusCalls=2
components/two-factor-setup-form.tsx                 submissionStartedRef=0  focusCalls=0
components/login-form.tsx                            submissionStartedRef=8  focusCalls=2
components/recovery-email-security-panel.tsx         submissionStartedRef=0  focusCalls=0
components/head-coach-setup-form.tsx                 submissionStartedRef=4  focusCalls=1
components/recovery-form.tsx                         submissionStartedRef=4  focusCalls=1
components/pin-setup-form.tsx                        submissionStartedRef=0  focusCalls=2
components/authenticator-recovery-form.tsx           submissionStartedRef=0  focusCalls=0
components/recovery-reset-forms.tsx                  submissionStartedRef=4  focusCalls=3
components/recovery-email-enrollment-form.tsx        submissionStartedRef=0  focusCalls=0
components/two-factor-reconnect-form.tsx             submissionStartedRef=0  focusCalls=2
components/account-security-workspace.tsx            submissionStartedRef=0  focusCalls=0
components/two-factor-verification-form.tsx          submissionStartedRef=0  focusCalls=2
```

Four forms use the guarded pattern, five use some other focus call (for example `components/registration-form.tsx` keys off `state.errorField === "fullName"` instead of a submission guard), and four restore no focus at all.

- **Why it matters:** This is one behaviour with one correct implementation, currently expressed five ways in one style, four ways in another, and not at all in four places. The guard is subtle — `submissionStartedRef` exists specifically so that a pre-existing `state.error` on mount does not steal focus — and each copy is a chance to lose that subtlety. Compounding it, the only test protecting this behaviour asserts the *source text* of one of the five copies (`tests/accessibility-hardening.test.ts:14-19`, see DEBT-2), so four copies are untested and a divergence between them would go unnoticed.
- **User impact:** Users of the authentication surface across all four roles. Someone submitting the login, recovery or head-coach setup form and getting an error has focus returned to the failing field on four surfaces; on `two-factor-setup-form.tsx`, `authenticator-recovery-form.tsx`, `recovery-email-enrollment-form.tsx` and `account-security-workspace.tsx` they do not. Whether that inconsistency is intentional is a question for the accessibility lens; from this lens the point is that it is *unmanaged* — nobody chose it, it is just what five hand-copies produced.
- **Effort:** S
- **Confidence:** High (proved)
- **Suggested primitive:** `useFocusAfterActionError(ref, { pending, error })` in `components/` or `lib/client/`. Five mechanical call-site replacements, then a decision (owned by the accessibility lens) on whether the other nine forms should adopt it.

---

### IQ-11 — The row-to-`AcademyMember` mapping is written twice, 16 identical lines

- **Classification:** duplication
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `lib/coach/database.ts:213-228` and `lib/coach/member-service.ts:226-241`
- **Evidence:** Identical object literal body; only the surrounding expression differs (`rows.map(row => ({…}))` vs. `member: {…}`):

```213:228:lib/coach/database.ts
  const members: AcademyMember[] = rows.map((row) => ({
    id: row.id,
    role: "player",
    academyId: formatAcademyId(row.academyIdSerial),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    fullName: row.fullName,
    initials: identityNameParts(row.fullName).initials,
    onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
    requestedAt: row.requestedAt.toISOString(),
    trainingStartOn: row.trainingStartOn,
    trainingStartConfirmedAt: row.trainingStartConfirmedAt?.toISOString() ?? null,
    primaryContact: {
      name: row.contactName ?? "",
      relationship: row.contactRelationship ?? "",
      phone: row.contactPhone ?? "",
    },
  }))
```

```225:242:lib/coach/member-service.ts
    member: {
      id: row.id,
      role: "player",
      academyId: formatAcademyId(row.academyIdSerial),
      activatedAt: row.activatedAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      fullName: row.fullName,
      initials: identityNameParts(row.fullName).initials,
      onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
      requestedAt: row.requestedAt.toISOString(),
      trainingStartOn: row.trainingStartOn,
      trainingStartConfirmedAt: row.trainingStartConfirmedAt?.toISOString() ?? null,
      primaryContact: {
        name: row.contactName ?? "",
        relationship: row.contactRelationship ?? "",
        phone: row.contactPhone ?? "",
      },
    },
```

- **Why it matters:** This maps a database row onto the `AcademyMember` DTO consumed by the member directory and the coach dashboard. Twelve fields including three timestamp conversions and three defaulted contact fields. If a field is added to `AcademyMember`, TypeScript will flag both sites — but if the *derivation* of an existing field changes (say, `initials` needs a different rule, or `contactPhone` needs normalising), only one site will be edited and the two surfaces will silently disagree.
- **User impact:** Maintainers, with a latent risk of a coach seeing different member details on the directory list than on the member detail view.
- **Effort:** S
- **Confidence:** High (proved)
- **Suggested primitive:** `export function toAcademyMember(row: MemberRow): AcademyMember` in `lib/coach/` (either file, or a new `member-mapping.ts`), called from both.

---

### DEBT-3 — Nine unreachable exports totalling 95 lines, plus a dead component whose CSS is still shipped

- **Classification:** dead code
- **Type:** Objective defect
- **Severity:** Low
- **Location:**

```
 22 lines   lib/auth/account-service.ts:181-202       listPendingRegistrations
 12 lines   lib/auth/credential-service.ts:674-685    removeExpiredAccessCodes
  6 lines   lib/auth/current-coach.ts:22-27           getCurrentCoachContext
  6 lines   lib/auth/mailer.ts:187-192                readCapturedAuthEmails
  3 lines   lib/auth/mailer.ts:194-196                clearCapturedAuthEmails
  3 lines   lib/sessions/database.ts:170-172          listSessionAttendanceRecords
 16 lines   lib/sessions/domain.ts:329-344            sessionIsEligible
  3 lines   lib/sessions/domain.ts:346-348            calendarWindowForYear
 24 lines   components/development-meter.tsx:3-26     DevelopmentMeter
TOTAL unreachable lines: 95
```

Plus the orphaned styles for the dead component: `app/globals.css:2714-2718` (`.development-track`), `app/globals.css:2725-2730` (`.attendance-track span, .development-track span`), and `app/globals.css:3024-3058` (`.development-meter-heading` ×4, a second `.development-track`, `.development-meter > p`).

- **How I searched (this matters, given how easy it is to get wrong here):**
  1. Extracted every `export function` / `export const` / `export class` name from `lib/` and `components/`.
  2. Searched for each name across `lib`, `components`, `app`, `tests`, `scripts`, `drizzle`, `.github` **and repository-root files** (`instrumentation.ts`, `instrumentation-client.ts`, `proxy.ts`, `next.config.ts`, `drizzle.config.ts`, `package.json`). Adding the root files removed `installRejectionReporter` and `recordRequestError` from the list.
  3. Separated names that appear more than once inside their own file (used internally, over-exported) from names that appear exactly once (the declaration). Only the latter are listed above.
  4. Re-verified each survivor with an independent `rg` over the entire repository excluding `output/`, `node_modules/` and `.next/`:

```
$ for n in listPendingRegistrations ... ; do rg -l --glob '!output/**' --glob '!node_modules/**' --glob '!.next/**' "\b$n\b" .; done
listPendingRegistrations                   files=1   ./lib/auth/account-service.ts
removeExpiredAccessCodes                   files=1   ./lib/auth/credential-service.ts
getCurrentCoachContext                     files=1   ./lib/auth/current-coach.ts
readCapturedAuthEmails                     files=1   ./lib/auth/mailer.ts
clearCapturedAuthEmails                    files=1   ./lib/auth/mailer.ts
listSessionAttendanceRecords               files=1   ./lib/sessions/database.ts
sessionIsEligible                          files=1   ./lib/sessions/domain.ts
calendarWindowForYear                      files=1   ./lib/sessions/domain.ts
        (DevelopmentMeter verified separately, below)
```

  5. Checked `lib/db/client.ts` for a namespace import that would consume names dynamically — it has one (`import * as schema`, line 10), which is why nine `*Relations` exports and `batchMemberships` were removed from the list (§1.4).

- **Evidence for the dead component specifically:**

```
$ rg -n --glob '!output/**' 'development-track|development-meter' components app --glob '!*.css'
components/development-meter.tsx:5:    <article className="development-meter">
components/development-meter.tsx:6:      <div className="development-meter-heading">
components/development-meter.tsx:14:        className="development-track"
```

Its only external dependency, `DevelopmentMarker`, is still live (`lib/types.ts:82`, used at `lib/types.ts:97` and `:123`), so the type must stay even though the component goes.

Note also that `.development-track` is declared **twice** in `app/globals.css`, at line 2714 (`height`, `overflow`, `background`) and again at line 3050 (`margin-top`). Removing them needs care: line 2725 is a shared selector list `.attendance-track span, .development-track span` where `.attendance-track span` is still live.

- **Why it matters:** 95 lines of code that read as live API — `sessionIsEligible` and `listPendingRegistrations` in particular look like things a future contributor would reach for and would then be maintaining alone. `readCapturedAuthEmails`/`clearCapturedAuthEmails` look like test helpers for the in-memory mail transport that nothing calls, which means the memory transport's captured output is never asserted anywhere.
- **User impact:** Maintainers.
- **Effort:** S
- **Confidence:** High (searched as described; the one residual risk is a reference from a file type I did not scan, but I scanned `.ts .tsx .mjs .js .json .yml .yaml .md`)

---

### DEBT-4 — Twenty module-internal helpers are exported without a single external consumer, widening the public surface of `lib/` for no reason

- **Classification:** module structure / dead code
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:**

```
lib/auth/coach-access.ts :: requireCoachAccessProfile          (3 occurrences in file)
lib/auth/credential-service.ts :: activationClaimHash          (5)
lib/auth/credential-service.ts :: MIN_PASSWORD_LENGTH          (3)
lib/auth/credential-service.ts :: MAX_PASSWORD_LENGTH          (3)
lib/auth/credential-service.ts :: LOCAL_DEVELOPMENT_PASSWORD   (2)
lib/auth/initial-setup.ts :: validateInitialPlatformAdminSetup (2)
lib/auth/recovery-service.ts :: normalizeRecoveryEmail         (4)
lib/auth/recovery-service.ts :: AUTHENTICATOR_RESET_REQUEST_LIFETIME_MS (2)
lib/auth/recovery-service.ts :: EMAIL_VERIFICATION_MAX_ATTEMPTS (3)
lib/auth/session.ts :: LEGACY_SESSION_COOKIE                   (2)
lib/auth/session.ts :: LEGACY_PROTOTYPE_SESSION_COOKIE         (2)
lib/client/attendance-draft-storage.ts :: ATTENDANCE_DRAFT_KEY_PREFIX (4)
lib/coach/report-navigation.ts :: PUBLISHED_REPORT_REVEAL_INCREMENT (4)
lib/coach/session-read-models.ts :: getCoachSessionSnapshotForWindow (4)
lib/finance/repository.ts :: readFinancePlayer                 (2)
lib/finance/repository.ts :: hasAssignmentInPeriod             (2)
lib/telemetry/error-report.ts :: CLIENT_ERROR_REPORT_TYPES     (3)
lib/training/academy-plans.ts :: academyPlanLabels             (2)
lib/training/training-start.ts :: trainingStartBackfillMonths  (2)
components/coach/members/member-directory-query.ts :: memberDirectoryStatuses (3)
```

- **Evidence:** Same search method as DEBT-3, but these names appear 2-5 times inside their declaring file and zero times outside it. They are alive; they are just not anybody else's business.
- **Why it matters:** Distinguishing this list from DEBT-3 is the point. `getCoachSessionSnapshotForWindow` in a 350-line read-model module reads like the module's entry point when it is actually an internal composed by the six `getCoach*Snapshot` functions below it. An exported symbol is a commitment; twenty unnecessary ones make the real API of `lib/` harder to see and make future refactors look more dangerous than they are.
- **User impact:** Maintainers.
- **Effort:** S
- **Confidence:** High (proved). One caveat worth naming: some of these may be exported deliberately so that a test *could* reach them; none currently does.

---

### IQ-12 — Eight files in `app/` write raw Drizzle queries, bypassing the service layer that the rest of the application uses

- **Classification:** module structure
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:** `app/admin/page.tsx`, `app/admin/actions.ts`, `app/admin/preview/exit/route.ts`, `app/account/security/page.tsx`, `app/account/security/actions.ts`, `app/auth/two-factor/actions.ts`, `app/auth/two-factor/setup/page.tsx`, `app/api/health/route.ts`
- **Evidence:**

```
$ rg -ln --glob '!output/**' 'from "drizzle-orm"' app
app/account/security/actions.ts
app/account/security/page.tsx
app/admin/actions.ts
app/admin/page.tsx
app/admin/preview/exit/route.ts
app/api/health/route.ts
app/auth/two-factor/actions.ts
app/auth/two-factor/setup/page.tsx
```

```
app/admin/page.tsx                             lines=140   selects=1
app/admin/actions.ts                           lines=111   selects=2
app/account/security/page.tsx                  lines=89    selects=1
app/account/security/actions.ts                lines=223   deletes=1
app/auth/two-factor/actions.ts                 lines=298   selects=2
app/auth/two-factor/setup/page.tsx             lines=67    selects=1
app/admin/preview/exit/route.ts                lines=35    selects=1  deletes=1
app/api/health/route.ts                        lines=29
```

```2:2:app/admin/page.tsx
import { and, asc, eq, isNull, ne } from "drizzle-orm"
```

The service modules these areas could route through already exist: `lib/auth/account-service.ts`, `lib/auth/credential-service.ts`, `lib/auth/admin-preview.ts`, `lib/auth/session.ts`, `lib/auth/authenticator-reset-service.ts`. And `components/` is completely clean — zero components import `@/lib/db` or `drizzle-orm`:

```
$ rg -n --glob '!output/**' 'from "@/lib/db|from "drizzle-orm|better-sqlite3' components
(no matches)
```

- **Why it matters:** The layering rule holds almost everywhere — `lib/` never imports from `app/` or `components/` (verified: zero matches for `from "@/(components|app)/` under `lib`), and no component touches the database. The exception is the platform-admin and account-security area, where three of the most security-sensitive surfaces in the product (admin directory, PIN/password management, two-factor setup) assemble their own SQL in the presentation layer. That means their access rules live next to their JSX rather than in a testable service, and they are the areas where `catch` blocks discard errors most freely (`app/account/security/actions.ts:103`, `app/auth/two-factor/actions.ts:145,169,213,229`).
- **User impact:** Maintainers, with a security-review cost: an auditor checking "who can read the account directory" must read page components rather than one service.
- **Effort:** M
- **Confidence:** High (import search is exhaustive; "should be refactored" is a judgement)

---

### IQ-13 — The database client asserts a `libsql` connection is a `better-sqlite3` connection through a double cast

- **Classification:** type safety
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:** `lib/db/client.ts:31`
- **Evidence:**

```29:31:lib/db/client.ts
    // libsql's synchronous runtime supports authToken, but its compatibility
    // declaration still mirrors the older better-sqlite3 Options type.
    return new LibsqlDatabase(url, { authToken } as never) as unknown as BetterSqlite3.Database
```

This is the only `as unknown as` in non-test source apart from `lib/sessions/service.ts:711` (`tx as unknown as SmbaDatabase`, bridging a transaction handle to the database interface):

```
$ rg -n --glob '!output/**' 'as unknown as' app components lib scripts
lib/sessions/service.ts:711:        database: tx as unknown as SmbaDatabase,
lib/db/client.ts:31:    return new LibsqlDatabase(url, { authToken } as never) as unknown as BetterSqlite3.Database
```

- **Why it matters:** This single line is the seam between local SQLite and production Turso, and it is completely unchecked by the compiler in both directions — `{ authToken } as never` suppresses the options mismatch and `as unknown as BetterSqlite3.Database` suppresses the shape mismatch. Every `sqlite.pragma(...)` call downstream (`lib/db/client.ts:45-46`) is type-checked against `better-sqlite3`'s declaration while actually executing against `libsql`. The comment explains *why* the cast exists, which is good practice, but the risk is real: a `better-sqlite3` API used anywhere downstream that `libsql` does not implement produces a runtime failure in production only, and the type system will not have said a word.
- **User impact:** Falls on maintainers, with a production-only blast radius: a divergence here would break every database-backed page for every role on the deployed Turso instance while local development stayed green.
- **Effort:** S
- **Confidence:** High for the observation; **Low** for any claim about actual divergence between the two drivers, which I did not test.
- **How to prove the risk is or is not live:** Enumerate the `better-sqlite3` surface actually used downstream (`rg -n 'sqlite\.' lib/`) and check each against `node_modules/libsql`'s implementation. The narrower fix is to define the minimum interface the project actually needs (`type SmbaSqliteConnection = Pick<BetterSqlite3.Database, "pragma" | "close" | "open" | ...>`) and cast to that instead, so the compiler polices the boundary.

---

### IQ-14 — Fifteen non-null assertions where a type guard or a total operation would express the invariant

- **Classification:** type safety
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:**
  - `lib/auth/recovery-service.ts:425, 631, 974, 982, 984, 985, 986, 989, 995` — `challenge.accountId!` / `row.accountId!` / `input.receiptToken!` (9 sites, mostly inside one transaction)
  - `components/financials/player-fee-record.tsx:44, 64` and `components/financials/player-finance-presentation.ts:78` — `charge.billingPeriod!`
  - `components/coach/financials/financials-rapid-desk.tsx:177` — `payableCharges.find(…)!`
  - `app/setup/head-coach/actions.ts:39` and `app/account/recovery-email/actions.ts:225` — `setupToken!`
- **Evidence:** The `billingPeriod!` sites are all guarded on the line above by a regex on the same value, so they are safe today but the guard and the assertion are two separate statements that can drift apart:

```39:47:components/financials/player-fee-record.tsx
function issuedChargeByPeriod(charges: ChargeView[]) {
  const result = new Map<string, ChargeView>()

  charges.forEach((charge) => {
    if (!VALID_PERIOD.test(charge.billingPeriod ?? "")) return
    const period = charge.billingPeriod!
```

```76:79:components/financials/player-finance-presentation.ts
    const year = /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(charge.billingPeriod ?? "")
      ? charge.billingPeriod!.slice(0, 4)
      : charge.dueDate.slice(0, 4)
```

The rapid-desk one is the only assertion on a `.find()` result, in a payment submit handler:

```176:182:components/coach/financials/financials-rapid-desk.tsx
        allocations: allocationValidation.allocations.map((allocation) => {
          const charge = payableCharges.find((item) => item.id === allocation.id)!
          return {
            amountPaise: allocation.amountPaise,
            chargeId: charge.id,
            expectedChargeRevision: charge.revision,
          }
        }),
```

I traced this one: `allocationValidation.allocations` is produced by `validateAllocationDraft` (`components/coach/financials/allocation-draft.ts:41-71`), which builds entries only from its `limits` argument, and `limits` is `payableCharges.map(...)` from the same closure (`financials-rapid-desk.tsx:94`). The invariant holds. It is unexpressed, not violated.

For the recovery-service cluster the volume rather than any individual site is the point — nine assertions on `accountId` inside one flow, which says the flow's state would be better modelled as a discriminated union where the resolved-account case carries a non-nullable `accountId`.

- **Why it matters:** Fifteen places where the code knows something the type does not. None of them is currently wrong. Each of them is a place where a future edit — moving the guard, reordering the transaction, refreshing `payableCharges` between render and submit — turns a compile error into a runtime `TypeError`. In `financials-rapid-desk.tsx` that runtime error would land inside an async submit handler, though the surrounding `try`/`finally` at that call site does reset the pending state, so it would surface as an error toast rather than a stuck button.
- **User impact:** Maintainers today. No current user impact — I traced the guards and they hold.
- **Effort:** S per cluster, M for the recovery-service state model
- **Confidence:** High for the inventory and for the guard tracing; the recommendation is a judgement.

---

### DEBT-5 — `components/coach/*` reaches sideways into `components/dashboard/*` and `components/financials/*`

- **Classification:** module structure
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:**

```
$ rg -n --glob '!output/**' 'from "@/components/(dashboard|announcements|financials)/' components/coach
components/coach/announcements/announcement-detail.tsx:13:import { announcementParagraphs } from "@/components/announcements/announcement-presentation"
components/coach/onboarding/player-onboarding-register.tsx:37:} from "@/components/financials/player-finance-presentation"
components/coach/announcements/announcement-composer.tsx:8:import { announcementParagraphs } from "@/components/announcements/announcement-presentation"
components/coach/junior-coach-attendance-card.tsx:16:} from "@/components/dashboard/player-attendance-calendar"
components/coach/junior-coach-attendance-card.tsx:21:} from "@/components/dashboard/player-attendance-query"
components/coach/junior-coach-attendance-calendar.ts:1:import { buildPlayerAttendanceCalendarDates } from "@/components/dashboard/player-attendance-calendar"
```

- **Evidence:** `components/dashboard/` is the player-facing dashboard. `components/coach/junior-coach-attendance-calendar.ts:1` imports the 42-cell grid generator from it, which is the *right* instinct — the alternative would be a seventh copy of that math — but the wrong location. The result is that editing the player dashboard's calendar module can break the junior-coach dashboard.

The two calendar builders also still share an 8-line day-cell shaping block that was not extracted alongside the grid math (detector: `junior-coach-attendance-calendar.ts:60-68 <=> player-attendance-calendar.ts:226-234`):

```62:68:components/coach/junior-coach-attendance-calendar.ts
      label: formatDateKey(key, { year: "numeric" }),
      dayNumber: String(Number(key.slice(8, 10))),
      monthShort: formatDateKey(key, {
        day: undefined,
        month: "short",
        weekday: undefined,
      }),
```

And the two card components that consume them repeat 47 more lines across four blocks (`junior-coach-attendance-card.tsx:89-98, 195-209, 292-301, 330-341` ↔ `dashboard/player-attendance-card.tsx:103-112, 231-245, 396-405, 454-465`).

- **Why it matters:** Six imports crossing feature boundaries, all in the same direction (coach → player/shared), all pulling genuinely reusable pure functions. The functions are fine; their address is wrong. A `components/shared/` or `lib/attendance/calendar-grid.ts` home would let both features depend on a neutral module instead of on each other.
- **User impact:** Maintainers.
- **Effort:** S for the moves; M if the 47 duplicated card lines are folded in at the same time
- **Confidence:** High (import search is exhaustive)

---

### DEBT-6 — Five server-action modules with 13 exported actions have no unit test

- **Classification:** test quality
- **Type:** Objective defect
- **Severity:** Low
- **Location:**

```
$ for f in $(rg -l --glob '!output/**' '^"use server"' app lib); do mod="@/${f%.ts}"; n=$(rg -l -F "$mod\"" tests --glob '!tests/e2e/**' | wc -l); [ "$n" = 0 ] && echo "NO TEST IMPORT: $f"; done
   NO TEST IMPORT: app/admin/actions.ts                   (exports: 4)
   NO TEST IMPORT: app/auth/two-factor/recovery/actions.ts (exports: 2)
   NO TEST IMPORT: app/coach/announcements/actions.ts     (exports: 3)
   NO TEST IMPORT: app/recover/actions.ts                 (exports: 3)
   NO TEST IMPORT: app/setup/head-coach/actions.ts        (exports: 1)
```

- **Evidence:** Nine of the fourteen `"use server"` modules **are** directly imported and exercised by vitest — `app/login/actions` (`tests/registration-actions.test.ts:84`), `app/auth/two-factor/actions` (`tests/two-factor-reconnect-actions.test.ts:53`), `app/account/recovery-email/actions` (`tests/recovery-email-actions.test.ts:48`), `app/account/security/actions` (`tests/account-security-actions.test.ts:38`), `app/auth/pin/actions` (`tests/pin-actions.test.ts:22`), `app/coach/actions` and `app/coach/attendance/adjustments/actions` (`tests/operational-action-results.test.ts:75-76`). So the pattern is established and works; these five are simply gaps.

`app/coach/financials/actions.ts` is a borderline case I am counting as covered-by-something: it is not imported by any test, but `tests/coach-financials-phase2-ui.test.ts:50` reads it as source text (`source("app/coach/financials/actions.ts")`), which is the DEBT-2 anti-pattern rather than real coverage.

Partial compensating coverage exists at the E2E layer for two of the five: `app/recover/actions.ts` is exercised through `tests/e2e/registration-resilience.spec.ts` (in CI), and `app/setup/head-coach/actions.ts` through `tests/e2e/onboarding-register.spec.ts` (in CI). `app/admin/actions.ts` (4 exports covering platform-admin mutations) and `app/auth/two-factor/recovery/actions.ts` (2 exports on the authenticator-recovery path) have neither unit nor E2E coverage that I could find.

- **Why it matters:** `app/admin/actions.ts` and `app/auth/two-factor/recovery/actions.ts` are the two most security-sensitive uncovered modules — platform-admin mutations and two-factor recovery claim handling. Both are also in the group that writes raw Drizzle in the presentation layer (IQ-12), so there is no service beneath them carrying the test either.
- **User impact:** Falls on maintainers and on release risk. A regression in the authenticator-recovery claim path would strand a coach or player locked out of their account, and nothing in the pipeline would catch it.
- **Effort:** M
- **Confidence:** High (proved after correcting an earlier shell-quoting error in my own sweep, see §1.4)

---

## 3. What's working well

Named and located, because these are load-bearing and easy to lose in a refactor.

1. **Zero `any`, zero `@ts-ignore`, zero `@ts-expect-error`, zero `eslint-disable` in the entire non-test source tree.**
   ```
   $ rg -n --glob '!output/**' '\bas any\b|:\s*any\b|<any>|any\[\]' app components lib scripts -t ts
   (no matches)
   $ rg -n --glob '!output/**' '@ts-ignore|@ts-expect-error|eslint-disable' app components lib scripts tests
   (no matches)
   ```
   In a codebase of 293 TypeScript source files with 187 test files, that is unusual and worth protecting with a lint rule so it stays true.

2. **All 62 `"use client"` directives are justified.** I resolved every hook call in every one, including the eleven files with no *React* hook. Ten of those eleven are `error.tsx` boundaries or components calling `useErrorReport` / `useReducedMotion`; the eleventh, `components/coach/reports-card.tsx`, calls the custom `useReportResume` (`components/coach/reports/report-resume.ts:44`). There is no unnecessary client boundary in this repository.

3. **No circular imports.** A value-level (non-`import type`) import graph over all 282 files in `lib/`, `components/` and `app/` with DFS cycle detection returned `value-level import cycles found: 0`.

4. **The `lib/` → `app/`/`components/` direction is never inverted.** `rg 'from "@/(components|app)/' lib` returns nothing, and no component imports `@/lib/db` or `drizzle-orm`. The data-access seam at `lib/data/index.ts` (`portalRepository`, `sessionProvider` behind the `PortalRepository` interface) is a clean injection point.

5. **`lib/finance/records.ts:380` uses `Record<FinanceAuditEventType, string>` for the activity label map**, and that is exactly why it is the one copy of the event-type list that has not drifted (IQ-2). The correct pattern is already present in the codebase four lines from the incorrect ones.

6. **Every async submit handler resets its pending state in a `finally`.** Thirteen components use `useActionState` or manual pending state; across `announcement-composer`, `announcement-detail`, `player-attendance-recorder`, `staff-roll-call`, `financials-activation`, `player-ledger` (10 `finally` blocks), `prepare-fees`, `member-directory`, `player-onboarding-register` (5), `registration-form`, `financials-rapid-desk`, `report-workspace` and `session-create`, the count of `finally` blocks meets or exceeds the count of pending-state entries. **I found no handler that can strand a busy state.**

7. **`vitest.config.ts` is correctly hardened against the stale-worktree problem** — `include` is anchored at `tests/**` rather than repo-wide, and `exclude` carries `**/output/**`. The in-file comment claiming CLI `--exclude` *adds* to that list is accurate; I verified it against the installed Vitest at `node_modules/vitest/dist/chunks/coverage.DfSpMS-b.js:3686`. `eslint.config.mjs:8` likewise ignores `output/**`. This is the sibling problem to IQ-1, solved correctly in two of three configs.

8. **Test file naming is perfectly consistent**, so nothing is silently excluded by the glob: 187 files under `tests/`, 166 matching `*.{test,spec}.{ts,tsx}`, and the other 21 are all Playwright configs or `tests/e2e/support/` helpers. There are no orphaned test files.

9. **The `catch` blocks that swallow deliberately say so.** `lib/client/attendance-draft-storage.ts:140,182,189,199`, `lib/telemetry/report-client-error.ts:88`, `lib/telemetry/error-report.ts:160`, `components/coach/reports/report-resume.ts:54,66`, `components/announcements/public-announcements.tsx:69` and `components/public/public-header.tsx:71` each carry a comment explaining the tolerated failure and the fallback. That is the right way to swallow an error and it makes IQ-3's eleven sites stand out clearly as the ones that did not.

10. **`scripts/regression/failure-evidence-sanitizer.ts` is a 7-line re-export of `lib/telemetry/redaction.ts`** with a comment explaining that the rules moved when the client error reporter needed them. Someone found a duplicate and removed it properly instead of leaving two copies.

11. **`components/coach/junior-coach-attendance-calendar.ts:1` imports `buildPlayerAttendanceCalendarDates`** rather than reimplementing the 42-cell Monday-first grid. The location is wrong (DEBT-5) but the instinct was right, and it is the reason there are two calendar builders rather than two grid generators.

12. **`.github/workflows/quality.yml:261-277` and `ui-accessibility.yml:190-197`** both use an explicit `needs` gate / `steps.*.outcome` check so that `continue-on-error: true` steps cannot silently pass the job. That is the correct way to collect multiple failures without weakening the gate, and it is easy to get wrong.

---

## 4. Suggested PRs

Independent and parallelisable unless a dependency is stated. File overlaps between my own PRs are flagged.

### PR-A — Make the typecheck gate deterministic
- **Findings:** IQ-1
- **Scope:** Either remove `.next/types/**/*.ts` and `.next/dev/types/**/*.ts` from `include` and set `exclude` to `[..., ".next"]`, or add a `next build` step to the `static` job before `typecheck`. Recommend the former plus a one-line comment recording why.
- **Files:** `tsconfig.json`, optionally `.github/workflows/quality.yml`
- **Effort:** S · **Risk:** Low (removing files from the program cannot introduce errors; adding the build step can, which is the point) · **Dependencies:** none
- **Rank this first.** Every other verification claim in the repository sits on top of it.

### PR-B — Wire up or delete the five unrun E2E specs
- **Findings:** DEBT-1
- **Scope:** Per file, decide keep-and-wire or delete. Suggested: delete `playwright.phase8-followup.config.ts` and `phase8-followup.spec.ts` (no caller at all, phase-named); add a workflow job for `playwright.responsive-overflow.config.ts` covering `responsive-overflow`, `accessibility-hardening` and `phase3c-interface-correctness`; decide explicitly whether `capture-regression` is a manual tool (then document it as such in `README.md`) or a gate.
- **Files:** `tests/e2e/playwright.phase8-followup.config.ts`, `tests/e2e/phase8-followup.spec.ts`, `.github/workflows/quality.yml`, `package.json`, `tests/e2e/README.md`, `README.md`
- **Effort:** M · **Risk:** Medium (newly-enabled specs may fail; that is information, but it will block the PR) · **Dependencies:** none
- **Overlap:** `.github/workflows/quality.yml` and `package.json` also touched by PR-A (workflow only, if the build-step option is chosen). Land PR-A first.

### PR-C — Collapse the finance audit event-type list to one source of truth
- **Findings:** IQ-2
- **Scope:** Single `as const satisfies` array in `lib/finance/types.ts`; derive the union from it; spread into the Drizzle enum; build the UI dropdown from `ACTIVITY_ACTIONS`; replace `EVENT_TYPES.includes(x as T)` with a type predicate. Fixes the `training_start_redated` gap as a side effect.
- **Files:** `lib/finance/types.ts`, `lib/db/schema.ts`, `lib/finance/service.ts`, `app/coach/financials/records/activity.csv/route.ts`, `app/coach/financials/records/page.tsx`
- **Effort:** S · **Risk:** Medium — touching `lib/db/schema.ts` means `npm run db:check` must stay green and `drizzle-kit` must not want a new migration; verify the generated enum text is byte-identical before and after
- **Dependencies:** none
- **Overlap:** `app/coach/financials/records/activity.csv/route.ts` also touched by PR-D. Land PR-C first (it is smaller and its risk is in a different area).

### PR-D — Extract a download/export route primitive and fix the log-the-cause gap
- **Findings:** IQ-3, IQ-6
- **Scope:** New `lib/http/download-route.ts` with `PRIVATE_DOWNLOAD_HEADERS`, `safeFileName(value, fallback)`, the shared coach-authorisation preamble, a shared cursor-draining generator, and a `withDownloadErrorHandling` wrapper that owns the terminal `catch`, the `FinanceServiceError` → 403 branch and a sanitised `console.error` using `lib/telemetry/redaction.ts`. Also fix the five non-route `console.error` sites.
- **Files:** the 7 route handlers listed in IQ-6, plus `app/(student)/player/page.tsx`, `app/api/health/route.ts`, `app/api/public/announcements/route.ts`, `app/api/session-summary/route.ts`, new `lib/http/download-route.ts`
- **Effort:** M · **Risk:** Medium — this is the access-control preamble for the finance download surface; `tests/finance-records-route.test.ts`, `tests/finance-collections-route.test.ts`, `tests/finance-documents-route.test.ts`, `tests/coach-report-download-route.test.ts` and `tests/report-download-route.test.ts` all exercise these handlers and must stay green
- **Dependencies:** none (but see PR-C overlap)

### PR-E — Extract `<WindowedRegisterTable>`
- **Findings:** IQ-5
- **Scope:** New shared component owning colgroup, both header rows, spacer cells and `aria-colindex` arithmetic; both registers become consumers. Do **not** merge the two registers.
- **Files:** `components/coach/player-attendance-register.tsx`, `components/coach/staff-attendance-register.tsx`, new `components/coach/windowed-register-table.tsx`
- **Effort:** M · **Risk:** Medium (accessibility-sensitive; `tests/e2e/accessibility-regression.spec.ts` runs in CI and covers these routes) · **Dependencies:** none
- **Overlap:** `components/coach/player-attendance-register.tsx` is read as source text by 3 tests (`p3-interface-hardening`, plus two others) — those string assertions will break. That is a reason to sequence PR-H before this, or to accept fixing the assertions inline.

### PR-F — Extract `useFocusAfterActionError`, `<CourtBackdrop>`, `useHeroEntrance` and `toAcademyMember`
- **Findings:** IQ-9, IQ-10, IQ-11
- **Scope:** Four small primitives, thirteen mechanical call-site replacements. Explicitly out of scope: deciding whether the nine forms *without* focus restoration should gain it (that is the accessibility lens's call).
- **Files:** `components/login-form.tsx`, `components/recovery-form.tsx`, `components/recovery-reset-forms.tsx`, `components/head-coach-setup-form.tsx`, `components/dashboard/welcome-hero.tsx`, `components/coach/coach-welcome-hero.tsx`, `components/coach/junior-coach-welcome-hero.tsx`, `lib/coach/database.ts`, `lib/coach/member-service.ts`, new `components/use-focus-after-action-error.ts`, new `components/court-backdrop.tsx`
- **Effort:** S · **Risk:** Low · **Dependencies:** none
- **Overlap:** `components/login-form.tsx` is asserted by source text at `tests/accessibility-hardening.test.ts:14-19`; that test will break and must be converted or updated in this PR.

### PR-G — Delete dead code and orphaned styles
- **Findings:** DEBT-3, DEBT-4
- **Scope:** Remove the 9 unreachable exports and `components/development-meter.tsx` entirely; remove the orphaned `.development-*` rules from `app/globals.css`, taking care to keep `.attendance-track span` in the shared selector at line 2725; downgrade the 20 over-exported internals to module-private. Keep `lib/types.ts:82 DevelopmentMarker` — it is still live.
- **Files:** `lib/auth/account-service.ts`, `lib/auth/credential-service.ts`, `lib/auth/current-coach.ts`, `lib/auth/mailer.ts`, `lib/auth/coach-access.ts`, `lib/auth/initial-setup.ts`, `lib/auth/recovery-service.ts`, `lib/auth/session.ts`, `lib/sessions/database.ts`, `lib/sessions/domain.ts`, `lib/client/attendance-draft-storage.ts`, `lib/coach/report-navigation.ts`, `lib/coach/session-read-models.ts`, `lib/finance/repository.ts`, `lib/telemetry/error-report.ts`, `lib/training/academy-plans.ts`, `lib/training/training-start.ts`, `components/coach/members/member-directory-query.ts`, `components/development-meter.tsx` (delete), `app/globals.css`
- **Effort:** S · **Risk:** Low (`npx tsc --noEmit` catches any missed reference immediately) · **Dependencies:** none
- **Note:** Split the export-narrowing half from the deletion half if reviewers prefer; they are independent.

### PR-H — Convert the source-text tests to behavioural tests
- **Findings:** DEBT-2
- **Scope:** Convert the ~11 files that assert against `.tsx`/`.ts` source into tests that import and execute the module, following the pattern already used by the 22 `app/`-importing tests in this suite. Leave the three workflow-YAML files (`ci-security-controls`, `ci-diagnostics-controls`, `ci-reliability`) as they are — text assertion is legitimate there.
- **Files:** `tests/finance-fee-record-navigation.test.ts`, `tests/accessibility-hardening.test.ts`, `tests/coach-financials-phase2-ui.test.ts`, `tests/route-recovery.test.ts`, `tests/p3-interface-hardening.test.ts`, `tests/operational-action-results.test.ts`, `tests/phase3-accessibility-corrections.test.ts`, `tests/session-workspace-separation.test.ts`, `tests/attendance-return-navigation.test.ts`, `tests/coach-portal-composition.test.ts`, `tests/coach-access-denial-notice.test.tsx`
- **Effort:** XL · **Risk:** Medium — conversion will surface behaviour these tests never actually checked · **Dependencies:** none, but **this should land before PR-E and PR-F** if possible, since both of those will break string assertions in these files. If sequencing is inconvenient, accept the assertion churn in PR-E/PR-F instead.

### PR-I — Split `lib/finance/service.ts`
- **Findings:** IQ-7
- **Scope:** Move lines 3770-4355 (all 13 read-model / query functions) to `lib/finance/read-models.ts`, re-export from `service.ts` for one release. Pure move.
- **Files:** `lib/finance/service.ts`, new `lib/finance/read-models.ts`
- **Effort:** M · **Risk:** Low as a pure move, provided the re-export shim is kept · **Dependencies:** land after PR-C, which also edits `lib/finance/service.ts` (lines 165-186, outside the moved range, so the conflict is trivial either way)
- **Overlap:** `lib/finance/service.ts` shared with PR-C.

### PR-J — Route the admin and account-security surfaces through the service layer
- **Findings:** IQ-12, DEBT-6
- **Scope:** Move the raw Drizzle queries out of the 8 `app/` files into `lib/auth/*` services, then add unit tests for `app/admin/actions.ts` and `app/auth/two-factor/recovery/actions.ts` (the two modules with neither unit nor E2E coverage).
- **Files:** `app/admin/page.tsx`, `app/admin/actions.ts`, `app/admin/preview/exit/route.ts`, `app/account/security/page.tsx`, `app/account/security/actions.ts`, `app/auth/two-factor/actions.ts`, `app/auth/two-factor/setup/page.tsx`, `lib/auth/account-service.ts`, `lib/auth/credential-service.ts`, `lib/auth/admin-preview.ts`, new tests
- **Effort:** L · **Risk:** High — this is the platform-admin and two-factor surface, and it currently has the least test coverage in the repository, so the refactor and the tests should land in the opposite order: **tests first, in their own PR, then the move**
- **Dependencies:** none. Recommend splitting into PR-J1 (tests only) and PR-J2 (refactor).

### PR-K — Relocate cross-feature component imports
- **Findings:** DEBT-5
- **Scope:** Move `buildPlayerAttendanceCalendarDates` and the shared day-cell shaping to a neutral module; move `announcementParagraphs` and `player-finance-presentation` helpers likewise. Optionally fold in the 47 duplicated lines between the two attendance cards.
- **Files:** `components/dashboard/player-attendance-calendar.ts`, `components/dashboard/player-attendance-query.ts`, `components/coach/junior-coach-attendance-calendar.ts`, `components/coach/junior-coach-attendance-card.tsx`, `components/coach/announcements/announcement-detail.tsx`, `components/coach/announcements/announcement-composer.tsx`, `components/coach/onboarding/player-onboarding-register.tsx`, new `lib/attendance/calendar-grid.ts`
- **Effort:** S (moves only) / M (with the card de-duplication) · **Risk:** Low · **Dependencies:** none

### PR-L — Narrow the database driver cast
- **Findings:** IQ-13
- **Scope:** Replace `as unknown as BetterSqlite3.Database` with a cast to a `Pick<>` of the members actually used downstream, so the compiler polices the local/Turso boundary.
- **Files:** `lib/db/client.ts`
- **Effort:** S · **Risk:** Medium — this is the production database connection; the change is type-only, but a mistake in the `Pick<>` list produces compile errors across `lib/`, which is the desired feedback
- **Dependencies:** none

### PR-M — Break up `MemberDirectory` and `SessionSchedules`
- **Findings:** IQ-8
- **Scope:** Decompose the two largest functions into sub-components. Consider adding `complexity` and `max-lines-per-function` to `eslint.config.mjs` with a ratchet so the situation cannot regress.
- **Files:** `components/coach/members/member-directory.tsx`, `components/coach/calendar/session-schedules.tsx`, `eslint.config.mjs`
- **Effort:** XL · **Risk:** Medium (large behavioural surface; `session-schedules.tsx` is read as source text by 3 tests) · **Dependencies:** PR-H, otherwise the string assertions will fight the refactor
