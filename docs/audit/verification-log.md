# Verification log

Claims from the lens agents that I re-checked myself before they enter the consolidated
report. Each entry records what was claimed, what I ran, and the verdict.

---

## ST-1 (Critical, UX lens) — `useActionState` sites have no rejection handling

**Claimed:** all `useActionState` sites pass a server action directly with no rejection
handling; a rejected action is thrown during render and escalates to the error boundary,
destroying the form and everything typed into it. Agent stated 20 sites.

**Verdict: CONFIRMED, with a count correction — 22 sites, not 20.**

### Site count

```
$ rg -n 'useActionState[(<]' components app --glob '*.tsx' | wc -l
22
```

22 invocations across 13 files, every one an authentication or account-security surface:

| File | Invocations |
|---|---|
| `components/account-security-workspace.tsx` | 3 |
| `components/authenticator-recovery-form.tsx` | 2 |
| `components/login-form.tsx` | 2 |
| `components/recovery-email-enrollment-form.tsx` | 2 |
| `components/recovery-email-security-panel.tsx` | 2 |
| `components/recovery-reset-forms.tsx` | 2 |
| `components/two-factor-setup-form.tsx` | 2 |
| `components/two-factor-verification-form.tsx` | 2 |
| `components/activation-form.tsx` | 1 |
| `components/head-coach-setup-form.tsx` | 1 |
| `components/pin-setup-form.tsx` | 1 |
| `components/recovery-form.tsx` | 1 |
| `components/two-factor-reconnect-form.tsx` | 1 |

None wraps its action.

### The React mechanism, proved rather than assumed

`react` and `react-dom` are both 19.2.8. Three points in
`node_modules/react-dom/cjs/react-dom-client.development.js` establish the path:

1. `runActionStateAction` (line 8370) invokes the action inside `try`, routing a
   *synchronous* throw to `onActionError`.
2. `onActionError` (line 8448) marks the node `"rejected"` and stores `reason`, but does
   not surface it to the component.
3. `updateActionStateImpl` (line 8564) is where an *async* rejection lands. If the state
   hook holds a thenable it calls `useThenable`, and re-throws anything that is not a
   Suspense signal:

```js
        try {
          var state = useThenable(currentStateHook);
        } catch (x) {
          if (x === SuspenseException) throw SuspenseActionException;
          throw x;
```

A rejected server action therefore throws during render and propagates to the nearest error
boundary. Because every route has an error boundary (confirmed separately — 46 of 46), the
failure mode is not a blank screen but a boundary swap, which still discards the form and
its contents.

**Why this bites in practice:** the action need not itself be buggy. A transport failure
while posting the Server Action rejects the promise regardless of how carefully the action
handles its own errors. That is precisely the poor-connectivity case this product runs in.

---

## Network-failure classifier adoption

**Claimed:** `lib/client/network-failure.ts` is wired into 2 of 23 mutating surfaces.

**Verdict: CONFIRMED for the numerator.**

```
$ rg -n 'describeSaveFailure|network-failure' app components lib | grep -v '^lib/client/network-failure.ts'
components/coach/attendance/player-attendance-recorder.tsx:37
components/coach/attendance/player-attendance-recorder.tsx:276
components/coach/attendance/staff-roll-call.tsx:17
components/coach/attendance/staff-roll-call.tsx:181
```

Exactly two consumers, both attendance recorders. The denominator of 23 mutating surfaces
was not independently re-derived; treat the ratio as approximate and the numerator as exact.

---

## Retracted before it was ever reported

- **`transition: all`** — the `21st` CLI flagged it, but only inside
  `output/perf-harness/*.css`, which are concatenations of *older* CSS. Direct grep of real
  source returns nothing. Not a finding.
- **`focus-outline-none` error-level hits** — same origin, same stale bundles. The real
  source has 17 `outline: 0` / `outline: none` sites which need individual adjudication
  against their `focus-visible` pairings; that is live work, but the CLI's error-level
  result is not evidence for it.

---

## DS triage (Design lens) — the 272 hardcoded colours are not what the rule name implies

**Claimed:** none of the 272 `design-hardcoded-color` findings are the classic "wrote a hex
instead of using the token". 22 are the tool misreading the `:root` block; the genuine 250
split into `rgba()` alpha-variants of token colours and off-palette values with no on-dark
tier.

**Verdict: CONFIRMED on the load-bearing claim.** I re-derived it independently with a
script that parses `:root`, resolves each token to an RGB triple, and classifies every
colour literal outside the token block.

```
hex tokens in :root: 22

OPAQUE hex literals outside :root that EXACTLY equal a token value: 0
rgba() total: 167 | whose RGB triple IS a token value: 151
   by token: {"ivory":59,"white":56,"navy":30,"red":4,"green":2}
hex literals NOT matching any token: 77
color-mix() uses: 41
```

**Zero** is the number that matters, and it is exact. Nobody is bypassing a token they know
about. My sweep covered `app/globals.css` and `app/public-home.css` only; the agent's also
covered the CSS Modules, which accounts for its slightly higher counts (157 vs my 151
token-matching `rgba()`, 96 vs my 77 off-palette). The per-token distribution agrees closely
— `ivory` 59 in both, `navy` 30 in both, `red` 4 in both, `green` 2 in both.

**Why this changes the remedy.** The obvious fix — "replace hex literals with `var()`" —
would address nothing, because there are no such literals. The two real gaps are that the
palette has no way to express a token at partial alpha, and no on-dark tier. Both are
additive token work, not a find-and-replace.

---

## Correction to my own brief — CSS Module count

I told all five agents the repo has **100 CSS Modules**. It has **10**. The error was mine:
I counted with `find . -name '*.module.css' -not -path './node_modules/*'`, which swept ten
stale copies of the tree under `output/`. Scoped correctly:

```
$ rg --files -g '*.module.css' app components lib | wc -l
10
```

The ten are: `components/reveal.module.css`, `components/announcements/`,
`components/financials/player-financials`, `components/coach/dashboard-card`,
`components/coach/junior-coach-dashboard`, `components/coach/player-onboarding-card`,
`components/coach/announcements/`, `components/coach/onboarding/player-onboarding-register`,
and both `components/coach/financials/` modules.

Every other figure in the briefs was scoped to real directories and is correct: 46 pages,
75 components, 90 `lib` files, 187 test files, `globals.css` at 13,985 lines.

This is the same stale-scratch trap I warned the agents about, which is a fair reminder that
the warning was worth writing — the design lens caught it independently rather than taking
my number on trust.

---

## IQ-1 (High, Code-quality lens) — the typecheck gate is not honest

**Claimed:** `tsconfig.json` pulls gitignored `.next/types/**` into its program. CI's `static`
job runs lint and typecheck with no build, so the 67 generated route validators "never
execute on any pull request."

**Verdict: PARTLY CONFIRMED. The premise is exact; the stated consequence is wrong, and the
severity should fall accordingly.**

### What is true

`tsconfig.json:32-33` does include both `.next` type globs:

```json
  "include": [
    "next-env.d.ts", "*.ts", "*.tsx",
    "app", "components", "lib", "scripts", "tests",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
```

And the CI `static` job genuinely has no build step — `.github/workflows/quality.yml:23-46`
runs checkout → setup-node → `npm ci` → `npm run lint` → `npm run typecheck` → validate
migrations. So `.next/types` is absent there and present locally for anyone who has run
`next dev` or `next build`.

**That asymmetry is real and worth fixing.** "Typecheck is green" denotes a different file
set locally than in CI, which is exactly the class of defect that quietly devalues a gate.

### What is not true

The route validators are not lost. `npm run build` runs in the `Build and browser
regression` job (`quality.yml:96-99`), that job is a required check — it passed on PR #57 in
2m46s — and `next build` performs its own TypeScript check. `ignoreBuildErrors` and
`ignoreDuringBuilds` appear nowhere in the repo:

```
$ rg -n 'ignoreBuildErrors|ignoreDuringBuilds' . --glob '!node_modules' --glob '!output'
(no matches)
```

`next build` also regenerates `.next/types` and re-adds those globs to `include` — the
tsconfig comment at lines 21-22 says so explicitly. So every pull request does validate all
67 routes, in the build job rather than the static one.

### Net effect

Downgrade from High to **Medium**, and restate the finding: the `static` job's typecheck is
non-deterministic across environments, not a hole in route coverage. The fix is also
cheaper than the agent's framing implies — the two candidate remedies (drop the globs, or
build before typechecking in CI) are about making one gate mean one thing, not about
restoring lost validation.

Worth noting the tsconfig comments show this configuration was reasoned about deliberately,
including the `.next/dev` exclusion for validators of deleted routes. This is a refinement
of a considered choice, not the correction of an oversight.

---

## A11Y placeholder contrast (Accessibility lens) — two proved 1.4.3 failures

**Claimed:** two search placeholders render at 2.93:1 and 3.06:1 where WCAG 1.4.3 requires
4.5:1, and no axe rule can detect them because axe never reads `::placeholder` colour.

**Verdict: CONFIRMED. Re-derived independently; my numbers are 2.93:1 and 3.05:1.**

Both sites set the placeholder to a grey at 72% alpha over an opaque background, so the
composite is what the eye sees:

```
Site 1  .coach-published-reports-search input::placeholder   app/globals.css:9001
  rgba(97,112,131,0.72) over --white #ffffff
  composited rgb(141.2, 152.0, 165.7)   contrast 2.93:1   FAIL

Site 2  .search input::placeholder      financials.module.css:428
  color-mix(in srgb, var(--steel) 72%, transparent) over --ivory #f7f5f0
  composited rgb(133.2, 142.0, 150.0)   contrast 3.05:1   FAIL
```

### The part that matters for the fix

The opaque tokens **pass comfortably on the same backgrounds**:

```
  --steel on --ivory: 5.39:1
  --steel on --white: 5.88:1
```

So nothing is wrong with the palette's chosen greys. The 72% alpha is the entire defect, and
dropping it fixes both sites with no new colour and no design decision to make.

### Cross-lens convergence

This is the same root cause the design lens identified from a completely different
direction. Its finding was that the token set has no way to express "this token at partial
alpha", which is why 151 `rgba()` literals exist whose RGB triple is a token value. Here that
missing capability produces an actual WCAG failure rather than merely untidy CSS. Two
independent lenses arriving at one root cause raises confidence in both.

A second convergence at site 1: the literal is `rgb(97,112,131)` = `#617083`, which is **not**
`--steel` (`#596673`). It is one of the off-palette values the design lens counted. So that
one line is simultaneously an accessibility defect, an alpha-mechanism gap, and a palette
drift — and a single edit to `var(--steel)` resolves all three.

---

## PERF driver claim (Performance lens) — production uses the synchronous driver

**Claimed:** production runs the *synchronous* libsql driver against Turso, so every query is
a serialised blocking network round trip and `Promise.all` provides zero concurrency.

**Verdict: CONFIRMED. This is the single most consequential fact in the audit.**

`lib/db/client.ts` imports `drizzle-orm/better-sqlite3` — the synchronous Drizzle adapter —
and routes Turso through libsql's synchronous runtime:

```js
    // libsql's synchronous runtime supports authToken, but its compatibility
    // declaration still mirrors the older better-sqlite3 Options type.
    return new LibsqlDatabase(url, { authToken } as never) as unknown as BetterSqlite3.Database
```

Queries return values rather than promises, so wrapping them in `Promise.all` cannot overlap
anything: each call blocks until its network round trip completes. Against a local SQLite
file that is microseconds; against Turso it is a full network hop, serialised.

This validates ranking round-trip amplification above every other performance concern, and
it means the usual intuition — "these run in parallel" — is false throughout this codebase.

**Compounding factor, also confirmed:** 53 write transactions repo-wide use
`{ behavior: "immediate" }`, 20 of them in `lib/finance/service.ts` and 7 in
`lib/sessions/service.ts`. An immediate transaction takes the write lock at the start, so
every serialised round trip inside one holds that lock against all other writers.

---

## PERF partial-migration claim — `loadChargeView` vs `loadChargeViews`

**Claimed:** the finance batching is good but partial; the batched `loadChargeViews` exists,
yet the one-element wrapper `loadChargeView` is still called inside eight loops.

**Verdict: CONFIRMED, and sharper than stated.**

The batched helper has exactly **one** consumer:

```
lib/finance/records.ts:131   loadChargeViews(...)
```

The singular wrapper has **32** call sites in `lib/finance/service.ts` plus one in
`lib/finance/documents.ts`. `lib/finance/repository.ts:512` confirms the singular is a
one-element wrapper over the batched form:

```js
  return loadChargeViews(database, [chargeId], now, includeInternal).get(chargeId) ?? null
```

The call sites that are genuinely per-row loops, and therefore the mechanical substitution
targets, are:

| Site | Shape |
|---|---|
| `lib/finance/service.ts:2054` | `allocations.map((allocation) => loadChargeView(tx, allocation.chargeId, now))` |
| `lib/finance/service.ts:2647` | `[...chargeIds].map((chargeId) => loadChargeView(tx, chargeId, now))` |
| `lib/finance/service.ts:2927` | `.map((chargeId) => loadChargeView(tx, chargeId, now))` |
| `lib/finance/service.ts:3033` | `chargeIds.map((chargeId) => loadChargeView(tx, chargeId, now))` |
| `lib/finance/documents.ts:216` | `loadChargeView(database, id, now, true)` inside the statement loop |

Because the singular already delegates to the batched form, each substitution is a
mechanical change against an already-tested helper rather than new query code.

---

## PERF attendance-save shape

**Claimed:** `lib/sessions/service.ts:555` issues `2 + 7C + D × (1 + 2A)` round trips inside
one immediate write transaction — 194 for a 24-player roster against ~10 batched.

**Verdict: SHAPE CONFIRMED; exact coefficients not independently re-derived.**

`changes.forEach(...)` at line 555 runs inside the transaction and its body contains `.get()`
and `.all()` calls (relative lines 52, 70, 76, 96 from the loop head), so the per-change
query pattern is real and it is inside an immediate write transaction. I verified the
structure rather than recounting every branch, so treat the formula as the agent's
derivation and the *pattern* as independently confirmed. The severity does not depend on the
exact coefficients.
