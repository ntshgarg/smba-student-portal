# SMBA Student Portal — Product, Design and Engineering Audit

**Commit audited:** `7fac52d` on local `main` · **Date:** 24 August 2026
**Scope:** the whole application — visual design, UX flows and states, design-system consistency, missing states, accessibility, responsiveness, implementation quality, performance, technical debt.
**Product:** a badminton academy portal (Next.js 16 App Router, React 19.2.8, TypeScript strict, hand-written CSS, Drizzle over SQLite locally / libSQL in production, better-auth).

---

## 1. How to read this report

Eight independent lens audits ran against this commit, each blind to the others and forbidden from reading the two prior audit documents in `docs/`. Each lens was then handed to an **adversarial verifier** whose brief was to *refute* it — re-derive every count, interrogate every stated mechanism, and mentally apply every proposed fix to find what it would break. Two cross-cutting agents followed: a completeness critic and a strengths-only counterweight.

Separately, I re-proved the load-bearing claims myself. That mattered: it corrected six agent claims and killed several that would have sent someone chasing a phantom. Where my measurement and an agent's disagree, this report carries mine and says so.

Every finding carries a classification, an objective/subjective marker, a severity, a `path:line`, evidence, why it matters, user impact, an effort estimate and a confidence level. Confidence is literal — **High** means proved by execution or arithmetic, **Medium** means strong static inference, **Low** means it needs a runtime observation nobody made.

**Severity is weighted by how this product is actually used.** Coaches mark attendance courtside, on a phone, on unreliable connectivity, while a session runs. A defect that loses a register outranks the same defect on a finance screen. Money paths come second. Marketing polish comes last.

### Two caveats that bound everything below

**No agent ran a browser, a dev server or a Playwright suite.** Eight agents against one checkout and one `.data` fixture set would have produced unreliable results. So computed styles, real focus order, rendered hit areas and live timings were not observed. Byte counts were measured; contrast ratios were computed; round trips were derived from code paths.

**Two lenses were lost to an auth failure mid-run** — the performance and technical-debt agents both died on 403s, along with three verifiers. Those two areas in this report are therefore **my own work**, not an agent's, and are marked as such. They are the most thoroughly hand-verified sections here.

---

## 2. Headline verdict

**This is a well-built product with unusually strong engineering discipline, one severe data-loss exposure on its most important workflow, and a design system that stopped at the colour layer.**

The fundamentals hold up under scrutiny: zero `any`, zero `@ts-ignore`, zero `@ts-expect-error`, zero `eslint-disable` in source, and exactly two non-null assertions. Lint is clean. The unit suite is 142 files and 644 tests, all passing. Security posture is genuinely good. `prefers-reduced-motion` is handled in all ten stylesheets with zero `transition: all`. Every `<Image>` has an `alt` and there is not one raw `<img>`. The design decision record is better than most teams ever produce.

Three things are seriously wrong.

**First, and most important: nothing a coach types is persisted anywhere.** Attendance marks and report bodies live only in React state. iOS reclaims a backgrounded tab and a full register is gone with no trace. This is the product's highest-stakes workflow, in its stated worst conditions.

**Second, the branch situation is actively dangerous** — see §3. Two independent remediation campaigns have been run against the same audit findings, reusing the same finding IDs for different defects. Work is being done twice, and the fix for the data-loss problem above **already exists on `origin/main`**.

**Third, the type and spacing layers have no scale.** 204 distinct font sizes across 1,095 declarations; 2.8% spacing-token adoption; the product's signature editorial micro-label authored 166 times as 75 distinct recipes. The colour layer, by contrast, holds hard — which proves the team can do this when a token exists to reach for.

**`npm run typecheck` fails on a clean tree**, and it is not the source's fault. See F-4.

---

## 3. The branch situation — read this before planning any work

Local `main` (`7fac52d`) and `origin/main` (`9eef50a`) share ancestor `3cbd766` and have diverged **21 commits against 25**. They are two independent remediation campaigns against the same audit.

**They reuse the same finding IDs for different defects.** Proved by diff:

| ID | Local `main` fixed… | `origin/main` fixed… |
|---|---|---|
| **A11Y-1** | `#8a939b` placeholders (3.12:1) and disabled month arrows (1.39:1) — `a13888f` | `rgba(97,112,131,.72)` and `color-mix(steel 72%)` search placeholders — `3d9eb5c` (#58) |
| **ST-1** | async handlers stranding a busy state — `8d60c85` | a dropped request destroying every auth form — `039d4a8` (#79) |
| **ST-2** | onboarding reset / attendance deadline — `f543d10`, `75d3c88` | four onboarding handlers lying about success — `70dc0ac` (#60) |
| **PERF-1** | finance N+1 reads, fee register — `1d57db1`, `d197bcb` | attendance-save batching (still open there) |

**Consequence: any PR plan citing `ST-`/`PERF-`/`A11Y-` IDs is ambiguous across these two histories.** This report therefore numbers findings in a fresh `F-` namespace.

### The merge is not a chore — it closes several of the worst findings

`origin/main` carries 60 files this branch has never seen. Among them are finished, careful implementations of problems this audit independently rediscovered:

| Finding | Status on local `main` | Already on `origin/main` |
|---|---|---|
| **F-1** attendance/report drafts not persisted | Open — **Critical** | `lib/client/attendance-draft-storage.ts`, wired into both recorders, versioned key, rejecting parser, 7-day lifetime, **preserves the per-mark `expected` concurrency token** |
| **F-6** auth forms destroyed by a dropped request | Open — High | `lib/client/use-resilient-action-state.ts`, adopted by **all 13** auth forms; *wraps* `useActionState` rather than replacing it |
| **F-3** two placeholder contrast failures | Open — High | both set to `var(--steel)` |
| **F-7** raw transport strings on mutation failure | 2 files adopt the helper | 13 files adopt it |
| **F-16** download-route duplication | Open | `lib/http/download-route.ts` |
| **F-4** non-deterministic typecheck | Open | `tsconfig.check.json` |
| — | `motion` still a dependency (4 importers) | removed entirely |

Two of those implementations avoid hazards my verifiers independently flagged in the *naive* fix: origin's draft store keeps the optimistic-concurrency token per mark, and origin's action wrapper preserves the no-JS pre-hydration submit. **Do not reimplement these. Merge them.**

Conversely, local `main` holds work origin lacks: the 693-line dead-CSS removal, the radius/shadow/duration/z-index token layer, and an accessibility matrix extended to seven more surfaces.

**The merge surface is smaller than the commit counts suggest.** Of the 56 files both branches touched, **31 are already byte-identical**, and 9 of the 10 files created independently on both sides are identical. The genuine conflict set is **25 files**, concentrated in `app/globals.css`, `lib/finance/service.ts`, five CSS modules and the auth forms.

**Findings the merge does *not* fix** — open on both branches: F-2, F-5, F-8, F-9, F-10, F-11 and the whole design-system and responsiveness sets.

---

## 4. Findings at a glance

Two populations, kept separate because they were produced differently.

**The lens agents returned 129 findings** across all eight lenses:

| Severity | Total | Visual | UX/States | A11y | Responsive | Code | Design sys | Perf | Debt |
|---|---|---|---|---|---|---|---|---|---|
| **Critical** | 2 | — | — | — | — | — | — | 2 | — |
| **High** | 31 | 5 | 7 | 6 | 3 | 3 | 0 | 5 | 2 |
| **Medium** | 68 | 11 | 6 | 6 | 10 | 11 | 11 | 6 | 7 |
| **Low** | 28 | 5 | 3 | 1 | 2 | 6 | 5 | 2 | 4 |
| **Total** | **129** | **21** | **16** | **13** | **15** | **20** | **16** | **15** | **13** |

Objective 123, subjective 6. Confidence: 119 High, 10 Medium. Both Criticals are performance; the third, F-2, came from the completeness critic — no lens found it.

**This report consolidates those into 57 `F-` findings**, merging the ten duplicate clusters the completeness critic identified (the same defect filed under two IDs by two lenses), folding in the re-run performance and technical-debt lenses, and adding the one finding the completeness critic caught that all six lenses missed:

| Severity | Count | Notes |
|---|---|---|
| **Critical** | 4 | F-1 (data loss, fixed on `origin/main`), F-2 (found by the critic, missed by every lens), F-19 and F-21 (round-trip amplification under a write lock) |
| **High** | 16 | |
| **Medium** | 15 | |
| **Low** | 8 | |

Separately, **58 candidate findings were disproved** by the lenses and a further 6 by me; §13 records the ones most likely to be rediscovered.

### The number that should govern how you read this

The verifiers **corrected 90 of the 152 findings they examined** (59%) across eleven adversarial passes, every lens covered. Corrections clustered in claims about *mechanism* and in *counts that had gone stale*; claims about *symptoms* held up almost perfectly.

**Trust a finding's description of what is wrong. Re-derive its explanation of why. Re-count anything numeric before quoting it.** Six PRs in §12 carry an explicit ⚠️ because the obvious remedy would ship a regression.

---

## 5. Critical and High findings

### 5.1 Critical

**F-1 — Nothing a coach types is persisted, on the workflow most likely to lose it.** ⬜ Open here; **fixed on `origin/main`**.
`components/coach/attendance/player-attendance-recorder.tsx:104`, `components/coach/attendance/staff-roll-call.tsx:66`, `components/coach/reports/report-workspace.tsx:249`.
Attendance marks live in `useState<SessionAttendanceChange[]>` and nothing else. The only `localStorage` write in the entire product is `components/coach/reports/report-resume.ts`, and it stores a *resume pointer*, not content — I confirmed this is the sole storage use in `app/`, `components/` and `lib/`. `useUnsavedWorkGuard` intercepts links, submits and `popstate`, but it cannot intercept the browser discarding a backgrounded tab.
*Impact:* the head coach marks a full register courtside, takes a phone call, iOS reclaims the tab. On return `draftChanges` is `[]` and the session's attendance is gone with no trace it ever existed. Same for a 300-word development report.
*Effort:* S **as a merge** (XL if rewritten). *Confidence:* High.
*Fix:* merge `lib/client/attendance-draft-storage.ts` from `origin/main`. **Do not write this from scratch** — the naive version drops the per-mark `expected` optimistic-concurrency token, which the server compares before writing; origin's implementation stores it deliberately.

**F-2 — A finance read failure takes down the entire player dashboard.** ⬜ Open on **both** branches. *Found by the completeness critic; all six lenses missed it; I confirmed it.*
`app/(student)/player/page.tsx:18`.
```js
function loadFeeSummary(playerId: string) {   // NOT async
  try { return getPlayerFinanceDashboardSummary(playerId) }   // returns a Promise, never awaited
  catch { return null }
}
```
`getPlayerFinanceDashboardSummary` is `async` (`lib/finance/service.ts:3319`). A `try/catch` around an un-awaited call catches only *synchronous* throws, so the rejection escapes, reaches `Promise.all` at `:38`, propagates out of the page and renders `app/(student)/error.tsx`. The evident intent — degrade to `null` and hide one fee card — never executes. `loadAnnouncements` **three lines below is `async` and does `await`**, which is the tell: the same author got it right immediately afterwards.
*Impact:* a parent opening the Player Journal during any finance read failure loses the greeting, next session, attendance, reports and announcements — not just the fee card.
*Effort:* S — add `async`/`await`. *Confidence:* High.

### 5.2 High — UX and states

**F-3 — Two `::placeholder` colours fail WCAG 1.4.3.** Fixed on origin.
`app/globals.css:8957` — `rgba(97,112,131,0.72)` over `var(--white)` = **2.93:1**. `components/coach/financials/financials.module.css:428` — `color-mix(in srgb, var(--steel) 72%, transparent)` over `var(--ivory)` = **3.06:1**. Both computed independently by me and by the accessibility lens, agreeing to two decimals; origin's own commit message quotes 2.93:1.
*Why it matters:* these placeholders carry the only instruction saying what the field accepts — an Academy ID versus a fee reference — on a money screen and a records screen, for an audience that includes older adults.
*Fix:* `var(--steel)` (5.88:1 on white, 5.39:1 on ivory), as origin did. **Do not** use `--text-placeholder`: it is 4.35:1 on ivory and would still fail. Effort S, confidence High.

**F-4 — `npm run typecheck` fails on a clean tree, and the source is not at fault.**
`tsconfig.json:32-33` puts `.next/types/**/*.ts` in `include` while excluding only `.next/dev`. The failure is `.next/types/validator.ts(494,39): Cannot find module '../../app/api/client-errors/route.js'` — a validator for a route that exists on `origin/main` and not here, written 24 Aug 03:07 by a build of a different branch. I proved the source is clean by running `tsc` over an identical config with `.next` excluded: exit 0.
*Why it matters:* the gate's verdict depends on what was last built in the working tree, so it can pass locally and fail in CI or the reverse. Note the config comment already explains this hazard for `.next/dev` — the same reasoning was simply not extended to `.next/types`.
*Fix:* merge `tsconfig.check.json` from origin. **Do not** simply add `.next` to `exclude` — `next build` draws its route validation from the file list this config resolves to, so that edit silently deletes route checking. Effort S, confidence High.

**F-5 — Session expiry has no state, and the copy actively misleads.** Open on both branches.
`lib/auth/current-coach.ts:31` throws `new Error("Head coach access is required.")` when identity is missing. Sessions run on a fixed 7-day clock with no refresh, so this fires on a schedule, not as an edge case.
*Impact:* a coach who has marked 15 players and crossed the expiry reads a **permissions refusal** — telling them they lack access when in fact they are logged out. Every retry fails identically, and the only remedy, navigating to `/login`, unmounts the recorder and destroys all 15 marks.
*Effort:* M. *Confidence:* High.
⚠️ **The proposed remedy is dangerous.** The lens suggested returning a discriminated `AUTHENTICATION_EXPIRED` result instead of throwing. The verifier caught that this **converts a fail-closed authorization guard into a fail-open one at 22 call sites**, every one written `const coach = await requireCoach()` immediately followed by the mutation. Keep the throw; add a typed subclass the client can distinguish, and open sign-in in a new tab so the register is never unmounted.

**F-6 — All 22 `useActionState` auth forms have no transport-failure branch.** **Fixed on origin.**
35 `useActionState` call sites across 13 files. In react-dom 19.2.8 a rejected action is re-thrown during render and escalates to the nearest error boundary, replacing the form and everything typed into it. Origin's `use-resilient-action-state.ts` documents the exact vendored line numbers.
⚠️ Do **not** convert these to `onSubmit` handlers, as one lens proposed — the verifier established that removes the pre-hydration / no-JS submit `useActionState` provides for free, on the highest-traffic form in the product, for an audience on slow phones. Origin's wrapper preserves it. Effort S as a merge.

**F-7 — 32 catch sites across 12 client components show the raw browser transport string.** Partly fixed on origin (13 files adopt the helper there, 2 here).
`lib/client/network-failure.ts` is a carefully documented module that classifies failures by constructor rather than message, refuses to call a timeout a failure, and writes operational copy. It is imported by exactly **two** files, both attendance recorders.
*Impact:* a head coach recording a payment offline reads Safari's `"Load failed"`.
⚠️ **Two verifier hazards, both severe.** (1) The timeout copy asserts "Saving again is safe and will confirm the result" — that guarantee holds only where the server replays a `mutationId`. `createSessionSeriesAction` has **no idempotency key anywhere in its path**, so a retry after a landed write creates a duplicate session. Apply per-surface, not blanket. (2) 27 of 29 pending-flag mutations also have no deadline, so the button spins forever — a separate defect that shares the remedy.

**F-8 — One-time TOTP recovery codes are shown once with no way to keep them and no way to get them back.** Open on both branches.
`components/two-factor-setup-form.tsx:64-68` renders them as a plain `<ul>` of `<code>`. No copy control, no download, no acknowledgement gate — and the confirm-code form sits directly below, so submitting it navigates away. I searched the whole codebase: **there is no reissue, regenerate or view-remaining path anywhere.**
The helper this needs, `lib/client/clipboard.ts`, exists, is unit-tested, and has **zero importers**.
⚠️ The lens proposed reusing the reconnect flow for regeneration. The verifier caught that it calls `revokeOtherSessions` and `disableTwoFactor` first — so "regenerate my codes" would log the coach out of every device including a courtside tablet and force full re-enrolment. Effort M, confidence High.

### 5.3 High — visual design and accessibility

**F-9 — The courtside attendance recorder marks state with a 1.09:1 wash; the register grid marks the same state with a 5.47:1 solid fill.** Open on both branches.
`app/globals.css:12245` (recorder, `--green-soft` on `--paper`) versus `:3976` (register, solid `--green` with white text and a 17px icon). Measured: recorder unmarked-vs-present **1.09:1**, unmarked-vs-absent **1.12:1**, present-vs-absent **1.03:1**.
*Why it matters:* WCAG 1.4.11 requires 3:1 for the visual information identifying a component's state. Beyond the failure, the product teaches "solid green = present" on one screen and "pale tint = present" on the next screen of the same task. The codebase already states this rule twice in comments elsewhere.
*Impact:* a coach on a phone in court light cannot tell which of two adjacent 9px buttons is selected, nor which players are still unmarked.
*Effort:* S. *Confidence:* High.

**F-10 — The annual register distinguishes Present from Absent by background colour alone.** `app/globals.css:3986`. Green versus red differ by **1.047:1 in luminance** — the per-cell `aria-label` rescues screen-reader users, but anyone with luminance-dominant vision, or reading in glare, sees two indistinguishable blocks. WCAG 1.4.1 (Level A). Add a Check/X glyph, `aria-hidden`, mirrored in the legend swatches. Effort M.
*(F-9 and F-10 are not contradictory: F-9 measures white text on a fill, F-10 measures green against red. Both are true; fix them together.)*

**F-11 — 13 roleless generic elements carry `aria-label`, which ARIA prohibits on `role=generic`.** Every one of those accessible names is silently dropped, including a focusable scroll region at `components/coach/staff-attendance-register.tsx:147`. WCAG 4.1.2. Add the role each already implies (`role="group"`, `role="region"`). Effort S.

**F-12 — The login method switch's selected state is a 1.12:1 background tint with no other cue** — `app/globals.css:1544`, `#eee8dc` on `--ivory`. It is the weakest selected state in the product and it is on the screen every user starts from. Every comparable control elsewhere is far stronger (the year selector uses solid navy at 15.9:1). Effort S.

### 5.4 High — responsiveness

**F-13 — The 16px anti-zoom guard stops at `max-width: 430px`.** `app/globals.css:13666`. iOS Safari and Chrome auto-zoom when a focused control computes below 16px and do **not** zoom back out. Between 431px and 720px — which includes most large phones in landscape and small tablets — the payment form and the courtside date input still trigger it. Effort S.

**F-14 — Every font size in the product is an absolute `px`.** 868 `px` font-size declarations, **zero `rem`, zero `em`** (verified). A user who raises their browser or OS *default font size* sees no change anywhere. Full-page zoom still works, so this does not strictly fail WCAG 1.4.4 — but it fails the users who set a font preference rather than a zoom level, which is most older users. Effort L (mechanical but broad).

**F-15 — `body { overflow-x: hidden }`** at `app/globals.css:1201` propagates to the viewport, converting any horizontal overflow from a scrollable annoyance into permanently unreachable content. Effort S to change, M to verify nothing depended on it.

### 5.5 High — implementation quality

**F-16 — Seven independent INR formatters, three of which round to whole rupees.** `components/coach/financials/financials-card.tsx:8`, `components/coach/members/member-directory.tsx:96`, and five more. The coach dashboard shows `₹1,235` where the drill-down shows `₹1,234.56`, and the member-archive blocker demands the rounded figure be cleared.
⚠️ **Do not "delete the six other definitions".** The verifier established — and I confirmed independently — that `lib/finance/pdf.ts:40` deliberately emits `INR ` as a prefix because PDFKit renders these documents in Helvetica, a WinAnsi standard-14 font with **no U+20B9 (₹) glyph**. Unifying naively puts a broken glyph in every receipt and fee statement. Effort S, confidence High.

**F-17 — CSV accounting exports stream outside the route handler's `try`.** `app/coach/financials/records/fees.csv/route.ts:88` and two sibling routes. A mid-export read failure truncates the file with **HTTP 200** already sent, no trailer row, no row count, and the handler's `catch` — and therefore its `console.error` — never runs.
*Impact:* the coach reconciles against a file containing rows 1–200 and nothing else, under-counts receivables, and gets no signal.
⚠️ Both proposed remedies are defective. Buffering is safe for `collections.csv` (366-day cap) but not for `fees.csv`, whose `mode=registration` branch has **no date filter and no row limit** — buffering materialises the academy's entire charge history in a Vercel function. Emit a terminal sentinel row instead. Effort M.

**F-18 — All 12 `console.error` calls discard the caught error.** Verified: exactly 12 in `app/`, `components/` and `lib/`, and every one logs a static string. Several pass a context object (`{reportId}`, `{mode, period}`) but never the cause. The only persisted error record is a SHA-256 fingerprint (`lib/operations/record-request-error.node.ts`), so a caught 500 on the finance download surface leaves nothing diagnosable.
⚠️ **Do not apply uniformly.** `docs/DATA-HANDLING-CHECKLIST.md:40` forbids recovery links and codes in logs, and several of these sites sit on recovery and report-download paths. A helper that unconditionally emits `{name, message, stack}` can echo a token or a player's full name into Vercel function logs, which are broader-access than the `operational_events` table this code deliberately writes to. Origin's `lib/telemetry/failure-cause.ts` is the shape to merge. Effort S.

---

## 6. Performance

*The performance lens died on an auth failure mid-run and was re-run successfully afterwards. This section is the lens's work reconciled against my own independent derivation; where we differed, the reconciliation is stated.*

### The fact that sets every severity here

**Production runs the *synchronous* libSQL driver over a network database.** `lib/db/client.ts:31` constructs `new LibsqlDatabase(url, { authToken })` and hands it to `drizzle-orm/better-sqlite3`. Every `.get()`, `.all()` and `.run()` is a **blocking network round trip on the event loop**. A per-row query inside a loop is not a slow query; it is round-trip amplification that also blocks the worker.

A corollary worth stating because it defeats the obvious fix: **the `Promise.all` wrappers throughout the read models buy no parallelism whatsoever** over a synchronous driver. They await values that have already been computed serially.

### Critical

**F-19 — Saving one attendance register costs 8 network round trips per player inside a single `BEGIN IMMEDIATE` lock.** ⬜ Open on both branches. *The product's daily workflow, on its worst network.*
`lib/sessions/service.ts:540`. Per changed row: enrollment select (`:598`), session-assignments select (`:621`), weekdays select (`:627`), stored-attendance select (`:646`), active-adjustment select (`:661`), conditional presence select (`:677`), the insert (`:694`), then `reconcileAttendanceAdjustmentReviewState` (`lib/attendance/adjustments.ts:486`) adding 1 select plus 2 per adjustment.

Round trips = `2 + 8C` for `C` changed rows with no adjustments. The lens and I derived this independently and agree:

| Roster | Round trips |
|---|---|
| 1 | 10 |
| 12 | 98 |
| **22** | **178** |
| **24** | **194** |
| 40 | 322 |

Because the lock is `immediate`, every other writer in the academy queues behind all of them — against a **20-second client deadline** (`player-attendance-recorder.tsx:57-64`). Effort L, risk High: it touches conflict detection and the adjustment invariant. Confidence High.

**F-21 — `prepareMonthlyCharges` issues 7 round trips per player without a concession and 28 with one, all inside one `BEGIN IMMEDIATE` transaction.** `lib/finance/service.ts:1240-1347`. For the project's own 100-player fixture roster that is **708 to 2,808 sequential round trips** in a single write lock. This is the path most likely to hard-fail on a serverless timeout rather than merely run slowly. Effort XL, risk High — idempotency keys, fee references and audit metadata all have to survive.

### High

**F-19b — Creating a session series inserts every generated occurrence with its own `INSERT` inside `BEGIN IMMEDIATE`** — up to **261 sequential round trips** holding the academy's only write lock. Effort M.

**F-20 — `loadChargeView` costs 4 round trips and is called inside seven loops on the money write paths.**
*Correction to my own earlier reading.* `loadChargeViews` (`lib/finance/repository.ts:505`) is not one query: it does 1 select, then delegates to `loadChargeRelations` (`:378-422`), which does **3 more**. So the true cost is **4 round trips per call regardless of batch size** — which makes the batching win *larger* than a naive reading suggests: N loop calls cost **4N**, one batched call costs **4**. The singular wrapper is a one-element delegation to the batched loader sitting immediately above it in the same file. Call sites include `lib/finance/service.ts:1490`, `:2083`, `:2363`, `:2469` and loops at `:1403`, `:1680`, `:2143`. Effort S–M, confidence High. **The cheapest high-value performance fix in the codebase.**

**F-20b — `loadFinancialActivity` reads eight whole tables on every call and paginates in JavaScript**, so the activity CSV re-reads all eight once per 100 rows and materialises `E × ceil(E/100)` audit rows. Effort M.

**F-20c — A single player's dashboard reads every session assignment and every assignment-weekday row in the academy**, plus up to two years of all occurrences — while the player-scoped helper sits in the same module. Effort M.

**F-20d — The coach dashboard and every report-draft save call `listCoachMonthlyReports()` with no month**, pulling every report ever written with its full 5,000-character draft and published text, when the month-filtered overload exists and is used elsewhere. Effort S.

**F-20e — Four `LIKE 'YYYY-MM%'` predicates on `session_occurrences.occurrence_date` cannot use `session_occurrences_date_idx`**, and the monthly attendance read is not scoped to the player's series at all. Rewrite as a half-open range. Effort S — but prove the column order serves every query before adding an index.

### Medium and Low

**F-22 — `app/globals.css` is 97% portal-only and render-blocking on the marketing homepage.** 288,227 bytes raw, 41,862 gzip, **31,479 brotli**, imported by the root `app/layout.tsx:4`. *Correction to my own earlier count:* the stylesheet declares **547** distinct class names, not the 417 my line-start regex found — it missed descendant selectors. Resolving the entire public route tree (45 files, following `@/` imports recursively) gives **13 reachable, 534 (97%) portal-only**. The homepage is statically prerendered and is the one route that must be fast. Effort M, risk Medium — verify against visual regression.

**F-23 — `motion` ships for a fade that `components/reveal.module.css` already implements in 29 lines.** ~39 KB gzip by the package's own size fixture, on the phone-first junior-coach dashboard and the player dashboard. 4 importers, one of which uses `AnimatePresence` — a naive "three heroes" fix leaves the dependency installed. Origin removed it entirely. Recorded design decision `[motion]` permits only "short opacity and transform reveals", so a CSS replacement is *more* faithful to the record. Effort S.

**F-22b — No route-level or read-level caching exists anywhere in the portal**, so every navigation re-runs the full read model — at least 25 sequential blocking round trips for the coach dashboard. Effort S–M.

**F-22c — `revalidateAcademyData` purges the statically prerendered marketing homepage on every attendance mark, report publish and member edit**, although the homepage reads no academy data on the server. It fires 19 `revalidatePath` calls, two against routes holding no academy data. Effort S.

**F-22d — The schedules page reads every session occurrence from the academy's first-ever session up to today** to compute a backfill list. Effort M.

**F-24 — `public/og.png` is 826 KB for a 1200×630 card**, fetched by every social crawler. Effort S.

**F-24b — `outputFileTracingIncludes` force-copies 2.3 MB of migration SQL into route function bundles**, although no request-path module imports the migrator. Effort S, confidence Medium.

**Caching posture elsewhere is deliberate and correct — do not "fix" it.** Every private and download route sets `private, no-store`; the public announcements API sets `s-maxage=60, stale-while-revalidate=300`; the homepage sets `dynamic = "error"`. `React.cache` is used at three sites for per-request dedup.

---

## 7. Technical debt, test quality and delivery hygiene

*This lens also died mid-run and was re-run successfully. Where the lens and my own hand-count differed, the adversarial verifier settled it — in one case against me, in two cases against the lens. Those adjudications are stated inline.*

### The two that block a fresh deployment

**F-27 — `npm run db:provision:admin` provisions the only usable account into a different database than `npm run dev` serves.** `package.json:9` runs the script through `tsx` with no env loading of any kind — the verifier confirmed independently that `.env.local` is invisible to it — while `lib/db/client.ts:34` defaults to `.data/smba.db` and `package.json:11` pins `DB_FILE_NAME=.data/academy-empty.db`. So the README's documented setup path either throws `SMBA_INITIAL_ADMIN_PASSWORD is required.` or silently writes the platform owner into a file the dev server never opens.
*Severity Medium* (lens filed High; verifier corrected — it is a documented-path breakage, not a runtime defect).
⚠️ **The obvious fix does not work.** `--env-file` cannot be smuggled through `NODE_OPTIONS`; the verifier ran node and got `--env-file-if-exists= is not allowed in NODE_OPTIONS`. The flag needs a direct `node` invocation, so the script cannot stay a bare `tsx …` line.

**F-27b — `BETTER_AUTH_SECRET` silently falls back to a constant committed in this repository.** `lib/auth/better-auth.ts:15` defines `LOCAL_ONLY_AUTH_SECRET = "smba-local-only-auth-secret-change-before-deployment-2026"`; `:33-35` throws for a missing secret **only when `VERCEL === "1"`**; `:36` returns the constant otherwise. `:60` passes it to `betterAuth` as `secret`. So **any `NODE_ENV=production` boot without the `VERCEL` variable signs sessions and encrypts TOTP material with a published value, and nothing is logged.** `.env.example:3` ships `BETTER_AUTH_SECRET=` empty, which falls through to the same constant.
*Severity Medium, not High* — and this is a judgement worth stating plainly rather than inflating. Every deployment path the repository actually describes is Vercel (`vercel.json`, `vercel-build`, `docs/PRODUCTION-OPERATIONS.md`), where the guard fires correctly. The exposure is real but conditional on a self-hosted deployment that nothing in the repo suggests exists. The comment above the guard explains the reasoning honestly: `next build` sets `NODE_ENV=production` locally, so `NODE_ENV` was rejected as the boundary. `coachTotpRequired` twelve lines below shows the better pattern — Vercel, then an explicit variable, then `NODE_ENV`.
⚠️ **Do not simply throw on `NODE_ENV === "production"`.** `next start` sets it, and the three `fixture:start:*` commands the README documents under "Serve a selected profile" never set `BETTER_AUTH_SECRET`. That fix breaks three documented local commands. Effort S.

### Tests that do not test

**F-25 — 1,186 of 3,748 lines of Playwright spec (31.7%) are executed by no pipeline**, across 5 files and **20 test cases**.

| Spec | Cases | Lines |
|---|---|---|
| `responsive-overflow.spec.ts` | 7 | 525 |
| `accessibility-hardening.spec.ts` | 6 | 217 |
| `capture-regression.spec.ts` | 1 | 189 |
| `phase3c-interface-correctness.spec.ts` | 3 | 162 |
| `phase8-followup.spec.ts` | 3 | 93 |

*Two corrections to my own hand-count.* I counted 22 cases by grepping `test(`; the verifier's per-file derivation gives **20**, and I accept it. And **only `playwright.phase8-followup.config.ts` is referenced nowhere at all** — `playwright.responsive-overflow.config.ts` is referenced once, at `tests/e2e/README.md:110`, which my search method missed. 8 of 13 specs run. Severity Medium (lens filed High; verifier corrected).
⚠️ Wiring the responsive-overflow config into CI does not add one spec — its `testMatch` has four entries, so it also re-runs `authentication-responsive.spec.ts` under a different viewport and pulls in `accessibility-hardening.spec.ts`. Effort M.

**F-26 — Roughly 270 assertions across ~20 unit-test files match against the literal text of source files rather than behaviour.** The honest figure is a **band of 264–303** depending on whether variables *derived* from a `readFileSync` are resolved; the lens said 274 and the verifier reproduced 264 conservatively and 303 permissively. My own narrower count was 248 across 17 files. Any of these is the same story: a fifth of the test files can pass a broken implementation and fail a correct rename.
*Worth recording:* the verifier checked two of the lens's per-file numbers and corrected them **to the figures I had measured** — `route-recovery.test.ts` 23→27 and `finance-fee-record-navigation.test.ts` 48→50. Effort L; land before any large component refactor.

**F-25b — `npm run db:check` reports "Everything's fine" while 6 of 27 migrations have no meta snapshot**, and `0015_snapshot.json` carries a `prevId` matching nothing. A gate that cannot fail on a real inconsistency is not a gate. Effort M.

**F-25c — `tests/ci-diagnostics-controls.test.ts` concatenates two workflow files before asserting**, so a control present in only one satisfies the assertion for both — `ui-accessibility.yml`'s artifact gating is in fact unasserted. Effort S.

### Dead weight

**F-30b — Four orphan scripts totalling 1,210 lines are referenced by nothing** — not by `package.json`, `.github/`, `docs/`, `README.md` or `.vercelignore`. One of them, `scripts/deployment/reset-empty-academy.mjs` (197 lines), **DELETEs every table in the remote Turso database in dependency order and re-inserts from a local source**, and is documented nowhere. That is an undocumented production-destroying script sitting in the tree. Effort S to document or delete; the question of which is a decision for the owner, not a cleanup.
⚠️ Do not add `scripts` to `.vercelignore` — `vercel-build` executes `scripts/database/prepare.ts`. Only `scripts/ui`, `scripts/regression` and `scripts/deployment` are candidates.

**F-30c — Three money-path server actions are exported from a `"use server"` module and called by nothing**, including a superseded unallocated `recordPaymentAction`. Exported server actions are reachable endpoints, so this is not merely tidiness. Effort S.

**F-29 — ~233 lines of genuinely dead CSS remain in three modules**, across 17 selectors: `components/coach/announcements/announcements.module.css` (9 selectors, ~145 lines), `components/financials/player-financials.module.css` (5, ~67), `components/announcements/announcements.module.css` (3, ~21).
This is **after eliminating six false positives** — every `status_*` selector in `financials.module.css` is built dynamically via ``styles[`status_${…}`]`` at `player-ledger.tsx:1480`, `:1532` and `financials-rapid-desk.tsx:586-589`. No test asserts on any of the 17 survivors. Two lenses reported 255 and 324 lines; **233 is the conservative, false-positive-eliminated floor.** Effort S.

**F-30 — Orphaned modules.** `lib/attendance/register-service.ts` is a one-line re-export with zero importers; `lib/client/clipboard.ts` has zero importers despite being tested — and is exactly the helper F-8 needs; `components/development-meter.tsx` is rendered nowhere and carries 35 lines of `globals.css` with it (origin already deleted it). The lens adds eleven further unreachable exported functions.
*Refuted during this check:* `lib/operations/record-request-error.node.ts` **is** live via `require()` in `instrumentation.ts:9`, and `lib/data/index.ts` **is** live with 26 directory imports. A glob-based scan reports both as dead.

**F-31 — `auth_sessions` is a dead table.** 0 inserts, 0 selects, 3 deletes. ⚠️ **Severity corrected down to Low.** A lens filed this as making "session revocation look better covered than it is". It does not: all three call sites delete from `authRuntimeSessions` — the real better-auth session table (`lib/auth/better-auth.ts:82`) — **as well**: `recovery-service.ts:985+986`, `member-service.ts:464+465`, `authenticator-reset-service.ts:126+127`. Revocation works. Removing the table also breaks live assertions in three test files.

### Documentation and dependencies

**F-28 — Ten runtime environment variables are read by `app/` and `lib/` but documented nowhere**, including `SMBA_BOOTSTRAP_HEAD_COACH_PASSWORD`, which `lib/auth/credential-service.ts:715` hard-requires for a fresh production database. A new academy deployment is blocked by a variable that appears in no file. Effort S.

**F-28b — The README contradicts itself and `package.json` about which database `npm run dev` serves**, and its route list omits **26 of 46 shipped routes** — including the entire announcements feature, the whole authentication and recovery surface, `/admin` and player onboarding. Effort S.

**F-30d — Dependency hygiene.** The `undici` override pins a package not in the tree; `sharp` is forced outside the range Next declares; `@types/better-sqlite3` is three majors behind its runtime. Effort S, low value — do it when someone is already in `package.json`.

---

## 8. Design system audit

### The central result

**The colour layer holds; every layer measured in numbers does not.**

| Layer | Declared | Real | Adoption |
|---|---|---|---|
| Colour | 22 `:root` colours | modules carry 0–2.8% raw literals; `--navy` read 488×, `--line` 485×, `--steel` 317× | **Strong** |
| Type | 5 tokens | **204 distinct** font-size values across **1,095** declarations | **4.1%** (45 reads) |
| Spacing | 7-step 8px scale | ~3,000 raw px in spacing declarations; **80.1% off-scale** | **2.8%** (65 reads) |
| Weight / line-height / tracking | **0 tokens** | 36, 39 and 42 distinct values across 1,168 declarations | **0%** |
| Radius | 4 tokens | — | 40 reads |
| Alpha / on-dark | **0 tokens** | 151 `rgba()` at 82 distinct alphas, plus 30 `color-mix(…, transparent)` | **0%** |
| Hairline `1px` | **0 tokens** | 445 sites, already 7 near-duplicate greys | **0%** |

That the same authors keep colour at near-total adoption while type sits at 4% is the diagnosis: **people use tokens that exist and improvise when none does.** The work is additive token design, not find-and-replace.

**F-32 — The editorial micro-label is authored 166 times as 75 distinct recipes.** *My count; it adjudicates a conflict between two lenses (166/75 vs 164/69).* Across all 12 stylesheets, 166 rule blocks set `text-transform: uppercase`, carrying 75 distinct `(font-size, font-weight, letter-spacing)` combinations. The plurality is `10px / 800 / 0.1em` (15 uses); the two largest 9px groups are `800/0.09em` (12) and `800/0.08em` (11) — a difference of **0.01em at 9px, or 0.09px per character**. Even the six rules that already use `var(--type-operational-floor)` disagree on tracking.
This atom is what gives the product its editorial identity, so this is the **highest design-value item in the report**. Effort M–L; stage it, biggest variant group first.

**F-33 — The page title has 27 hand-authored recipes** using 6 weights, 6 letter-spacings and 8 line-heights, while the shared `PageIntro` component is used on **2 of the 46 files that render an `<h1>`**. Effort M.

**F-34 — 177 `clamp()` font-size declarations carry 161 distinct expressions**; 148 appear exactly once. There is no fluid ramp, only 161 bespoke ones. Effort L.

**F-35 — 9px is used 97 times, below the product's own declared floor.** `--type-operational-floor: 10px` is declared and read 30 times, while `9px` appears in 97 declarations across 8 files. The product violates a floor it named. Effort M.

**F-36 — The logo ships as an opaque JPEG on all 18 screen surfaces** with three different `mix-blend-mode` workarounds and a white box on the navy footer — while the transparent PNG that fixes it is already in the repo and already used by the PDF generator. Effort S, high visible payoff.

**F-37 — The PDF the parent keeps is off-brand.** `lib/reports/pdf.ts` and `lib/finance/pdf.ts` each independently hard-code the palette. Measured ΔE against the screen tokens: **NAVY `#081c42` vs `--navy #071b32` = ΔE 11.27** (clearly visible); **STEEL `#617083` vs `--steel #596673` = ΔE 5.37**; RED ΔE 0.40 and IVORY ΔE 1.28 are imperceptible. The monthly report and the fee receipt are the most *permanent* artifacts the product creates. Effort S for the two drifted colours. ⚠️ Do not unify the *typography* the same way — see F-16's Helvetica constraint.

### Token proposals

Ordered by value per unit of risk. Counts measured.

| Token | Value | Replaces | Sites | Risk |
|---|---|---|---|---|
| `--border-hairline` | `1px` | the untokenised 1px primitive | 445 | Very low — **adopt opportunistically, do not mass-rewrite** |
| `--weight-label` / `--weight-body` / `--weight-display` | `800` / `500` / `700` | 36 distinct weights | 1,168 decls share the 3 layers | Low |
| `--tracking-label` | `0.1em` | the 75-recipe eyebrow's tracking axis | 166 | Low — pairs with the `.eyebrow` class |
| `.eyebrow` **class**, not tokens | `10px / 800 / 0.1em / uppercase` + colour modifiers | the 75 micro-label recipes | 166 rules | Medium — **highest design value here** |
| `--alpha-*` scale, or a `color-mix` convention | 4/8/12/20/35/55/70% | 151 `rgba()` at 82 alphas | 151 | Medium–High — convert at *current* alpha first (near-lossless), normalise later |
| `--on-dark-fg` / `--on-dark-muted` / `--on-dark-success` / `--on-dark-error` | TBD by eye | the 65 ad-hoc on-navy alphas and 5 one-off hexes | ~70 | Medium — needs a designer to pick values |
| `--type-page-title` | `clamp(58px, 7.5vw, 102px)` | 27 title recipes | 27 | Low — pairs with adopting `PageIntro` |
| `--opacity-disabled` | one value | 14 distinct disabled opacities (0.28 → 0.7) | 14 | Low |
| PDF palette import | reuse `--navy`/`--steel` values | 11 hard-coded PDF colours | 11 | Very low — colours only, **not** fonts |

**Deliberately not proposed.** `--bp-*` breakpoint tokens: a custom property cannot be used in a media prelude, and `.21st/DESIGN.md:162-167` already explains this correctly. A token for the 15 local `z-index: 1/2/3` values: it would couple unrelated stacking contexts. `--radius-none`: the 19 explicit zeroes say it better.

### Design governance — this bounds the recommendations

`.21st/design.json` records **63 decisions** with rationale, plus `must`/`avoid` constraints. Several recommendations that a reflexive audit would make are **already ruled out by a deliberate decision**:

- `[navigation]` — "Keep the portal centered on one primary page with **no tab navigation**", and `avoid` lists **"Admin sidebars"**. So *do not* propose persistent navigation.
- `[player-reflection]` — an on-screen training journal is explicitly declined; SMBA ships a physical notebook.
- `[motion]` — "short opacity and transform reveals only… no scroll-jacking". This *supports* F-23 and forbids adding animation.
- Five **freeze** decisions cover mobile authentication, the account menu, calendar/attendance, the member directory, and the public homepage as a "locked editorial composition". Visual rework of those surfaces needs a decision change first, not a PR.

I verified `.21st/DESIGN.md`'s breakpoint section independently: all **20 widths and their exact frequencies match the code**, and its argument for why breakpoints are not tokens is correct. Nine singleton widths are genuine drift, and the document says so itself.

---

## 9. Accessibility and responsiveness

**The harness is substantial and better than most** — a state matrix dispatched so an unwired profile/actor pair fails loudly, axe under `wcag2a/2aa/21a/21aa/22aa`, plus custom DOM checks for landmarks, heading order, duplicate IDs, overflow, clipped controls, touch targets and a 16px form floor. It is CI-blocking.

**Its blind spots are real and specific.**

**F-38 — Everything axe marks `incomplete` is collected into advisories and never asserted.** `tests/e2e/support/accessibility-audit.ts:652-653`. That single decision hides unresolvable-background contrast, `aria-prohibited-attr` on elements with text content, and every landmark rule at once. A green run on a job named "WCAG 2.2 AA" is a narrower claim than it reads as. The harness documents the choice honestly — but promote at least `color-contrast`, `aria-prohibited-attr`, `aria-hidden-focus` and the landmark rules to blocking, with a checked-in baseline so the number can only fall. Effort M.

**F-39 — The a11y matrix covers 33 of 46 page routes (72%).** The 11 genuinely uncovered routes (excluding two pure redirects) include **`/setup/head-coach` — the first screen a new academy ever sees** — plus `/auth/two-factor`, both one-time-secret setup routes, and all four `[param]` detail routes. Effort M.

**F-40 — Target size is only measured at ≤820px**, so it is never checked at the 1440px width where the head coach does finance and register work. Effort S.

**F-41 — Both courtside save buttons disable themselves under the user's own activation**, dropping keyboard focus to `<body>` — so the next Tab restarts at the top of the document, past the skip link, after *every* save and every save *failure*. These two files are the only save flows in the app with no focus management. Effort S.

**Refuted — do not re-file this.** One lens claimed the `dialog-focus-restoration` assertion is effectively dead because the attribute it keys on "does not exist anywhere in the application". A prior audit made the identical claim. **Both are wrong, and the adversarial verifier agreed independently.** The harness sets the attribute itself at `tests/e2e/support/accessibility-interactions.ts:33` via `openDialogFrom`, used by exactly three interactions — "Review announcement", "Withdraw announcement" and "Preview" — and the application contains exactly three native `<dialog>`s (`report-workspace.tsx:152`, `announcement-detail.tsx:84`, `announcement-composer.tsx:126`). **All three are covered.** The verifier further confirmed the product side is correct: every dialog opens via `showModal` in an effect that captures `previouslyFocused` and restores it on cleanup. Verdict: severity Medium → **Low**, "debt with no current cost". The comment at `:29-31` shows the coupling was deliberate.

**Responsiveness measured.** 20 distinct breakpoint widths across 89 media queries; the touch-target floor is genuinely held (101 declarations at 44px, 29 at 46px, 35 at 48px) with a short tail below it. The 18×18px checkboxes at four sites are **not** a 2.5.8 failure: every one is wrapped in a `<label>`, so the target is the label.

---

## 10. What's working well — preserve these deliberately

Several of these are load-bearing and a careless refactor would undo them silently.

1. **Type and lint discipline is real, not aspirational.** Zero `any`, `as any`, `@ts-ignore`, `@ts-expect-error` and `eslint-disable` across `app/`, `components/` and `lib/`; exactly two non-null assertions. *Destroyed by:* the first `eslint-disable` that gets waved through in review.
2. **`lib/client/network-failure.ts` is exemplary.** It classifies transport failures by *constructor*, never by message string, naming all three browser wordings in a comment; it uses `navigator.onLine` only to choose wording, never to decide whether a failure occurred; and it refuses to call a timeout a failure because a Next.js server action cannot be aborted. *Destroyed by:* anyone "simplifying" it to a message-string match, or applying its timeout copy to a non-idempotent mutation (see F-7).
3. **Security posture.** Database-backed rate limiting with tightened custom rules (10/min sign-in, 6/min PIN, 6/min two-factor); `secureAuthCookiesRequired()` checks Vercel production **first**, so the `=false` escape hatch cannot weaken production; `trustedOrigins` pinned; verification identifiers stored hashed. *Destroyed by:* reordering those two checks.
4. **Idempotency on money paths is enforced by a UNIQUE index**, not merely by application code — the strengths pass verified this rather than assuming it.
5. **Confirmation copy is genuinely good.** Most destructive confirmations name their consequence: "The original absence will be restored", "Their portal access will be revoked, while attendance and reports remain preserved", "This cannot be undone". "Remove PIN" has no confirm dialog but **requires re-typing the current password** — a stronger gate, not a gap.
6. **Motion discipline.** `prefers-reduced-motion` handled in **all ten** stylesheets, 8 `useReducedMotion()` guards, 54 transitions and **zero `transition: all`**.
7. **Caching is deliberate** — see §6. Private routes `no-store`, public API edge-cached with SWR, homepage `dynamic = "error"`.
8. **The design decision record.** 63 decisions with rationale and explicit supersession chains. Most teams never produce this. *Destroyed by:* `21st init --refresh`, which discards the hand-corrections — the file says so at the top.
9. **`components/account-menu.tsx`, `components/route-recovery.tsx` and `components/unsaved-work-guard.tsx` are correct and above the product's average.** The completeness critic read them specifically to check. Do not re-audit them.
10. **The three native `<dialog>`s all save `document.activeElement`, lock body scroll, focus inside, restore on unmount and handle `onCancel`.**
11. **The 693-line dead-CSS removal on this branch was thorough.** I swept all 523 class selectors in `globals.css` and `public-home.css`: **zero dead**. Only the CSS modules still carry any (F-29).
12. **Every private route not in the `robots.ts` disallow list carries its own `index: false`.** The two mechanisms compose to full coverage.

---

## 11. Roadmap

### Now — reconcile, then stop the data loss (1–2 weeks)

**0. Merge `origin/main` into local `main`.** This is not housekeeping; it is the highest-leverage item in the report. It closes F-1 (the only Critical that loses user work), F-3, F-4, F-6, most of F-7, F-16's primitive and F-23 — with implementations that already avoid two hazards the naive fixes would hit. It also ends the finding-ID collision that makes every other plan ambiguous. Until this lands, **every other PR risks being written twice.**

1. **F-2** — add `async`/`await` to `loadFeeSummary`. One word, removes a whole-dashboard outage.
2. **F-1** — verify the merged draft store covers the report workspace too, not just the two registers.
3. **F-9 + F-10** — give the courtside recorder the register's own state vocabulary. Highest user-visible quality win in the product, effort S.
4. **F-19** — batch the attendance-save write path. 8 round trips per player → roughly 10 total, against a 20-second client deadline. Effort L, risk High; land it alone.
5. **F-21** — batch monthly fee preparation. 708–2,808 round trips for a 100-player roster in one write lock; the likeliest hard failure in the product. Effort XL, risk High; land it alone, after F-19.

### Next — finish the abstractions that already exist (3–6 weeks)

- **F-20** swap `loadChargeView` → `loadChargeViews` at the loop sites. 4N round trips → 4. Nearly free.
- **F-19b / F-20b / F-20c / F-20d / F-20e** the remaining round-trip amplification: session-series inserts, the eight-table activity read, the academy-wide dashboard read, the unfiltered report list, and the four unusable `LIKE` predicates.
- **F-22b / F-22c** add read-level caching; stop purging the static homepage on every attendance mark.
- **F-8** recovery codes: copy, download, acknowledge — using the already-tested `tryCopyText`. Then a separate, correctly-gated regenerate path.
- **F-5** session expiry as a real state — keeping the throw, adding a typed subclass.
- **F-17** CSV truncation sentinel. **F-18** log the cause, per-site, respecting the PII checklist.
- **F-25** wire up or delete the 1,186 unrun spec lines. **F-38 / F-39** make the gate assert what it collects, and cover `/setup/head-coach`.
- **F-13** extend the anti-zoom guard past 430px. **F-22** split portal CSS off the marketing critical path.
- **F-27 / F-27b / F-28 / F-28b** the deployment-integrity set: fix the admin-provisioning database mismatch, close the `BETTER_AUTH_SECRET` fallback for non-Vercel boots, and document the ten undocumented variables and 26 missing routes. **A new academy cannot be stood up correctly today**, which makes this higher-value than its effort suggests.
- **F-30b** decide what to do about the undocumented script that wipes the production database — document it with a confirmation gate, or delete it.
- **F-25b / F-25c** make `db:check` and the CI-diagnostics test capable of failing.
- **F-32** the `.eyebrow` class — the largest design-consistency win. Stage it.

### Later — structural (quarter-scale)

- **F-26** convert the 248 source-text assertions **before** any large component refactor.
- **F-33 / F-34 / F-35** the type scale; the on-dark and alpha tiers.
- **F-14** `px` → `rem`. Mechanical but touches 868 declarations.
- Split `lib/finance/service.ts` — but see the note in §12: the read/write seam is clean except for one misplaced function.
- **F-29 / F-30 / F-31** the dead-code sweep. Real, safe, and worth almost nothing operationally — do it when someone is already in the file.

**Deliberately not on this roadmap:** persistent navigation, an on-screen journal, added animation, and visual rework of the five frozen surfaces. Each contradicts a recorded design decision (§8).

---

## 12. PR plan

Fresh `F-` IDs throughout. **Wave 0 gates everything** — it is a prerequisite, not a parallel option.

### Wave 0 — reconcile the branches

| # | PR | Findings | Files | Effort | Risk | Depends on |
|---|---|---|---|---|---|---|
| 1 | **Merge `origin/main` into `main`** | F-1, F-3, F-4, F-6, F-7(part), F-16(part), F-23 | 25 real conflicts of 216 changed; `globals.css`, `finance/service.ts`, 5 modules, auth forms | L | **High** — but unavoidable, and it shrinks every later PR | — |

Merge guidance: 31 of the 56 both-touched files are already identical, so resolve those trivially. Take **origin's** side for `lib/client/*`, `lib/telemetry/*`, `lib/http/*`, the auth forms and `tsconfig`. Take **local's** side for the dead-CSS deletions and the `:root` token layer. `app/globals.css` and `lib/finance/service.ts` need line-by-line attention. Run the full suite plus `regression:accessibility` before merging.

### Wave 1 — near-free, independent, review first

| # | PR | Findings | Files | Effort | Risk |
|---|---|---|---|---|---|
| 2 | Await the player-dashboard finance read | F-2 | `app/(student)/player/page.tsx` (1 line) | S | Very low |
| 3 | Give the courtside recorder the register's state vocabulary | F-9, F-10 | `globals.css:12245,12705,3986`, 2 recorders | S | Low — screenshot 3 widths |
| 4 | Name the 13 roleless labelled elements | F-11 | 9 components | S | Low — re-run the gate |
| 5 | Strengthen the login method switch's selected state | F-12 | `globals.css:1544` | S | Very low |
| 6 | Optimise `og.png`; use the transparent logo PNG | F-24, F-36 | `public/`, 18 call sites | S | Low |
| 7 | Document the 10 env vars and the 26 missing routes; fix the README's database contradiction | F-28, F-28b | `.env.example`, `README.md` | S | None |
| 7a | Fix `db:provision:admin`'s env and database mismatch | F-27 | `package.json`, provisioning script | S | Low — ⚠️ `--env-file` cannot go in `NODE_OPTIONS` |
| 7b | Close the `BETTER_AUTH_SECRET` fallback for non-Vercel production | F-27b | `better-auth.ts`, `.env.example` | S | Medium — ⚠️ must not break the three `fixture:start:*` commands |
| 7c | Document-or-delete the 4 orphan scripts, incl. the production-wiping one | F-30b | `scripts/`, `docs/` | S | Low — ⚠️ never `.vercelignore` all of `scripts` |
| 7d | Delete the 3 uncalled money-path server actions | F-30c | `app/coach/financials/actions.ts` | S | Low — they are reachable endpoints |
| 8 | Delete the 233 lines of dead module CSS and 2 orphan modules | F-29, F-30, F-31 | 3 modules, 2 `lib/` files | S | Low — delete from the **per-selector list**, never a line range |

### Wave 2 — the abstractions, and the gate

| # | PR | Findings | Files | Effort | Risk |
|---|---|---|---|---|---|
| 9 | Batch the attendance-save write path | F-19 | `sessions/service.ts`, `attendance/adjustments.ts` | L | **High** — conflict detection + adjustment invariant. **Land alone.** |
| 9a | Batch monthly fee preparation | F-21 | `finance/service.ts` ① | XL | **High** — idempotency keys, fee refs, audit metadata. **Land alone, after 9.** |
| 9b | Batch the session-series occurrence inserts | F-19b | `sessions/service.ts` | M | Medium — same file as 9; sequence them |
| 10 | `loadChargeView` → `loadChargeViews` at the loop sites | F-20 | `finance/service.ts` ① | S | Low |
| 10a | Scope the activity, dashboard, report-list and schedules reads | F-20b, F-20c, F-20d, F-22d | `finance/records.ts`, `reports/service.ts`, read models | M | Medium — narrowing reads must not narrow summaries |
| 10b | `LIKE 'YYYY-MM%'` → half-open range | F-20e | `schema.ts`, new migration | S | Low — additive; **prove column order first** |
| 10c | Stop purging the static homepage on every mutation | F-22c | `revalidateAcademyData` | S | Low |
| 11 | Recovery codes: copy, download, acknowledge | F-8 | `two-factor-setup-form.tsx`, `clipboard.ts` | M | Low — adds an enrolment step |
| 12 | Recovery-code regenerate, correctly gated | F-8 | `account/security`, new action | M | **Medium** — must **not** reuse the reconnect flow |
| 13 | Session expiry as a state | F-5 | `current-coach.ts` + handlers | M | **Medium** — keep the throw; typed subclass only |
| 14 | CSV truncation sentinel | F-17 | 3 CSV routes | M | Medium — **do not buffer `fees.csv`** |
| 15 | Log the cause, per site | F-18 | 12 sites | S | Medium — respect `DATA-HANDLING-CHECKLIST.md:40` |
| 16 | Unify the INR formatters | F-16 | 6 of 7 sites | S | **Medium** — leave `finance/pdf.ts` alone (Helvetica has no ₹) |
| 17 | Make the gate assert what it collects | F-38 | `accessibility-audit.ts` | M | Medium — land behind a baseline |
| 18 | Cover the 11 missing routes, incl. `/setup/head-coach` | F-39 | `accessibility-matrix.ts` | M | Medium — new states may fail |
| 19 | Desktop target-size checking | F-40 | `accessibility-audit.ts` | S | Low |
| 20 | Keep focus on the courtside save buttons | F-41 | 2 recorders | S | Low |
| 21 | Extend the anti-zoom guard past 430px | F-13 | `globals.css:13666` | S | Low |
| 22 | Wire up or delete the 5 unrun specs (20 cases, 1,186 lines) | F-25 | `package.json`, `.github/` | M | Medium — ⚠️ the responsive config pulls in 4 specs, not 1 |
| 22a | Make `db:check` and the CI-diagnostics test capable of failing | F-25b, F-25c | `drizzle/meta/`, `tests/ci-diagnostics-controls.test.ts` | M | Low |

### Wave 3 — design system and structure

| # | PR | Findings | Effort | Risk |
|---|---|---|---|---|
| 23 | The `.eyebrow` class — collapse the top variant groups | F-32 | M–L | Medium — **highest design payoff** |
| 24 | Adopt `PageIntro`; add `--type-page-title` | F-33 | M | Medium |
| 25 | Weight / tracking / hairline / disabled-opacity tokens | §8 table | M | Low — opportunistic adoption |
| 26 | On-dark tier and a `color-mix` alpha convention | §8 table | L | Medium — convert at current alpha first |
| 27 | Raise the 97 sub-floor 9px sites | F-35 | M | Medium |
| 28 | Align the PDF palette to the tokens (**colours only**) | F-37 | S | Low |
| 29 | Split portal CSS off the marketing critical path | F-22 | M | Medium — verify against visual regression |
| 30 | `body { overflow-x: hidden }` removal | F-15 | S | Medium — audit what depended on it |
| 31 | Convert the 248 source-text assertions | F-26 | XL | Medium — **land before 32/33** |
| 32 | Extract `player-ledger.tsx`'s 12 components | — | S–M | **Low — pure file move** |
| 33 | Extract `player-onboarding-register.tsx`'s 7 components | — | S–M | **Low — pure file move** |
| 34 | Refactor `member-directory.tsx` | — | L | **Medium — a real refactor, not a move** |
| 35 | `px` → `rem` | F-14 | L | Medium |
| 36 | Read-level caching for the portal read models | F-22b | S–M | Low |

**① `lib/finance/service.ts`** is touched by PRs 9a, 10, 10a and 16. Take them as 10 → 16 → 9a → 10a; PR 9a is the largest and should not share a review window with any of the others.
**② `app/globals.css`** is touched by PRs 3, 5, 21, 23, 24, 25, 26, 27, 29. Line numbers churn — re-derive rather than trusting any recorded here.

### Review order and rationale

**1 → 2–8 in parallel → 9 alone → 9a alone → 9b, 10–22 in parallel → 23–36.**

Wave 0 first, because everything downstream is smaller and unambiguous once it lands. Wave 1 is seven genuinely independent small PRs that between them fix a whole-dashboard outage, a WCAG 1.4.1 failure and the product's worst state treatment — a good warm-up that also removes noise from later diffs. PR 9 gets the review bench to itself. Wave 2 is broad and mostly independent. Wave 3 can be deferred indefinitely without the product degrading, with one exception: PR 31 must precede 32–34.

**Where to spend review attention.** Not on merge conflicts — on whether each finding's stated *mechanism* is real. The verifiers corrected 90 of 152 findings, and the corrections clustered in claims about mechanism ("which error reaches this catch", "are these two functions identical", "what does this config edit cause") and in counts that had gone stale. Symptoms held up almost perfectly. Six PRs above carry an explicit ⚠️ because the obvious remedy would ship a regression; those are the rows to read twice.

---

## 13. Refuted — do not re-file these

Recorded so the next audit does not rediscover them. 58 candidates were disproved across the lenses; these are the ones most likely to recur.

| Candidate | Why it is not a defect |
|---|---|
| The `dialog-focus-restoration` assertion can never fire | The harness sets the attribute itself at `accessibility-interactions.ts:33`; `openDialogFrom` has 3 call sites and the app has exactly 3 native `<dialog>`s, in those same 3 components. **All are covered.** I refuted this, and the re-run verifier independently agreed — corrected Medium→Low, noting all three dialogs capture and restore `previouslyFocused`, and that the coupling was a deliberate choice documented at `:29-31`. **Two prior audits and one lens have now got this wrong.** |
| `auth_sessions` means session revocation is broken | All 3 paths also delete `authRuntimeSessions`, the real table. Revocation works. |
| `lib/operations/record-request-error.node.ts` is dead | Live via `require()` in `instrumentation.ts:9`. |
| `lib/data/index.ts` is dead | Live — 26 directory imports. |
| The `status_*` selectors are dead CSS | Built dynamically via ``styles[`status_${…}`]``. |
| `zod` is a single-use dependency to remove | It is a **direct dependency of better-auth**; already in the tree. |
| "Remove PIN" lacks a confirmation | It requires re-typing the current password — a stronger gate. |
| `robots.ts` omits private routes | Every one carries its own `index: false`. |
| The product should be internationalised | Single Bengaluru academy; `en-IN`/`Asia/Kolkata` is correct. The `en-GB`/`en-CA` uses are ISO date-part extraction, not display. |
| The 18×18px checkboxes fail 2.5.8 | All are wrapped in `<label>`; the target is the label. |
| `globals.css` still has dead CSS | All 523 selectors are live. The 693-line cleanup was thorough. |
| Registration should collect guardian consent | The policy deliberately places it outside the portal. |
| Add `--bp-*` breakpoint tokens | Unusable in a media prelude; `.21st/DESIGN.md:162-167` explains this correctly. |
| Add persistent navigation | Contradicts recorded decision `[navigation]` and the `avoid` list. |
| The two announcements modules are duplicates | They share 2 class names out of 39 and 65. |
| Percentage arithmetic has a zero-data division bug | Guarded at `lib/coach/staff-attendance.ts:244`. |
| The player fee record imports the coach financials module | It imports its own `player-financials.module.css`. No layering violation. |

---

## 14. Method and limits

Eight blind lens agents at `7fac52d`, each with strict scope rules forbidding any read of `output/`, `.next/`, `.data/`, `node_modules/`, `snapshots/` or `test-results/` — a previous audit of this repo published two false findings and a corrupted file count by scanning stale full-repo copies under `output/`, which is 6.6 GB. Each lens was then adversarially verified. A completeness critic and a strengths-only pass followed.

**Five of sixteen agents initially died on 403 auth errors.** A resume replayed the cached successes and re-ran the failures; the final run completed **18 of 18 agents with zero errors**, so every one of the eight lenses received an adversarial pass. Where a re-run agent and my own interim hand-count disagreed, the verifier adjudicated — and it did not always side with me. Three of those adjudications are recorded inline (§6 `loadChargeViews`, §6 selector count, §7 test-case count) because a reader should be able to see which numbers moved and why.

**Nothing was executed against a browser.** No dev server, no Playwright, no build. What that costs: computed styles, real focus order, rendered hit areas, live timings and the actual accessibility tree were not observed. What it does not cost: contrast ratios (computed with the WCAG formula), byte counts (`wc -c`), round-trip counts (derived from code paths and stated as formulae), and every count in this report (each from a command that was run).

Gate status at this commit, measured: **lint clean; 142 test files / 644 tests passing; `typecheck` failing** for the reason in F-4.

**The most important limit.** Two prior remediation campaigns produced ten corrections between them on contact with the code, and this audit's verifiers corrected 90 of 152 findings. The pattern is stable enough to state as a rule: **trust a finding's description of the symptom; re-derive its explanation of the cause; re-count anything numeric before quoting it.** Desk re-verification does not catch these — only implementation does.
