# SMBA Student Portal — Design and Engineering Audit

**Date:** 24 August 2026
**Commit audited:** `fa88c08` (merged `main`, after PR #56 and PR #57)
**Scope:** the whole application — visual design, UX flows and states, design-system consistency, missing states, accessibility, responsiveness, implementation quality, performance, technical debt.

---

## 1. How to read this report

Five independent audits were run against the same commit, one per lens, each blind to the others and each forbidden from citing the previous audit (which was deleted before this pass began, deliberately, so no finding here inherits an earlier conclusion). Their full reports are preserved as appendices in `docs/audit/`, with complete evidence for every finding. This document is the consolidation: the verdict, the findings index, the design-system audit, the roadmap, and the PR plan.

Every finding carries a classification, an objective/subjective marker, a severity, a `path:line` location, verbatim evidence, why it matters, who it affects, an effort estimate, and a confidence level. Confidence is meant literally: **High** means proved by execution or arithmetic, **Medium** means strong static inference, **Low** means it needs a runtime check that could not be run here.

**A note on the severities.** They are weighted against how this product is actually used. Coaches mark attendance courtside, on a phone, on unreliable connectivity, while a session is running. A defect that loses a register mid-session outranks the same defect on a finance screen. Players and parents, some of them older, read reports and fee status.

### What was independently re-verified

Findings do not enter this report on an agent's authority. The load-bearing claim from each lens was re-proved from scratch, and the working is in `docs/audit/verification-log.md`. That process changed four things. The last two rows, marked *(implementation)*, were not produced by re-reading at all: they come from attempting the Wave 1 deletions, and they correct claims that had already survived the desk check.

| Claim | Outcome |
|---|---|
| `useActionState` rejection destroys auth forms (ST-1) | **Confirmed** in React 19.2.8 source. Count corrected 20 → **22** sites. Confidence raised Medium → **High**. |
| Production uses the *synchronous* DB driver (PERF) | **Confirmed.** This is the most consequential fact in the audit. |
| Placeholder contrast fails 1.4.3 (A11Y-1) | **Confirmed** by independent arithmetic: 2.93:1 and 3.05:1. |
| Hardcoded colours are token bypasses (DS) | **Confirmed inverted** — exactly **zero** are. See §5. |
| CI never validates the 67 route modules (IQ-1) | **Partly refuted.** Downgraded High → **Medium**; see §4.4. |
| The `.development-track` styles are orphaned and deletable (DEBT-3) *(implementation)* | **Refuted.** `app/globals.css:2714-2718` is a shared selector list, and the other selector, `.attendance-track`, is live at `player-attendance-card.tsx:159`. Deleting the stated range would have unstyled the player attendance card. |
| 307 lines of CSS are dead, at the stated ranges (DS-7) *(implementation)* | **Confirmed in substance, corrected in detail.** Every enumerated rule is dead, but the range `:4106-4192` spans a live rule, roughly 30 further dead rules were missed, and a test asserts on two of the dead selectors. 307 is a lower bound. |

Two candidate findings were retracted before publication, both artifacts of stale build output that a naive scan would have reported: a `transition: all` that exists nowhere in real source, and error-level `focus-outline-none` hits from concatenated bundles of *older* CSS.

### What Wave 1 implementation disproved

Work on Wave 1 began before this report was published, and the attempt to land two of its PRs — the dead-CSS deletion (DS-7) and the dead-export deletion (DEBT-3) — disproved five claims and established that those two PRs cannot be parallelised. Acting on a finding is a harsher test than re-proving it, and these are results that only the harsher test produces.

The serious one is DEBT-3's. One of the three ranges it lists for deletion is a shared selector list whose other selector styles the live player attendance card, so the deletion as specified would have shipped a visible regression. DS-7 came out better: every rule it enumerates is genuinely dead. But one of the summary *ranges* it is filed under spans a live rule, its proof search never covered `tests/`, and it misses roughly thirty further dead rules sitting in media queries. Two smaller corrections follow — VD-1 counts one dead selector among the live sites of a variant group, and the two deletion PRs turn out to be coupled through `components/development-meter.tsx`, whose only styles are the ones DS-7 removes.

All six corrections are recorded with evidence in `docs/audit/verification-log.md`. None of them changes the counts in §3: DS-7 and DEBT-3 both survive as findings, corrected in scope rather than withdrawn.

---

## 2. Headline verdict

**This is a well-built application with a serious, specific, and fixable performance problem.**

The engineering fundamentals are genuinely strong, and the audit found no reason to soften that: zero `any`, zero `@ts-ignore`, zero `eslint-disable` in source; no import cycles; all 62 `"use client"` directives justified under scrutiny; lint and typecheck both clean; loading and error state coverage near-total; and an accessibility investment well above what most products of this size carry. Several findings below exist *because* someone built the right abstraction — they simply never finished adopting it.

Three things need attention now.

**The database driver is synchronous.** `lib/db/client.ts` wires Turso through libsql's synchronous runtime behind Drizzle's `better-sqlite3` adapter. Queries return values, not promises, so `Promise.all` around them provides no concurrency whatsoever — each one blocks until its network round trip completes. Against a local file that is microseconds. Against Turso it is a full network hop, serialised, and 53 write paths hold an `immediate` transaction lock while it happens. This single fact promotes every query-per-row pattern in the codebase from untidy to expensive, and it is why the performance lens produced both Criticals.

**Every authentication form can be destroyed by a dropped request.** All 22 `useActionState` sites pass a Server Action directly with no rejection handling. When the request fails in transport, React re-throws during render and the error boundary swaps out the form with everything typed into it. The action does not have to be buggy; bad connectivity is sufficient.

**The good abstractions are not adopted.** The app owns a network-failure classifier that writes actionable sentences — wired into 2 of 23 mutating surfaces. It owns a batched charge loader — called from 1 site while its per-row wrapper is called from 33. It owns a draft-persistence module with versioned keys and quota tolerance — used for attendance and not for report prose, the longest free text in the product. The remedy in each case is adoption, not invention, which makes these unusually cheap wins.

---

## 3. Findings at a glance

**98 findings.** 80 objective defects, 18 subjective suggestions. Confidence: 87 High, 10 Medium, 1 Low.

| Severity | Count | Design | UX | A11y/Resp | Code | Perf |
|---|---|---|---|---|---|---|
| **Critical** | 3 | — | 1 | — | — | 2 |
| **High** | 23 | 5 | 3 | — | 5 | 10 |
| **Medium** | 39 | 10 | 7 | 9 | 5 | 8 |
| **Low** | 33 | 6 | 5 | 7 | 10 | 5 |
| **Total** | **98** | **21** | **16** | **16** | **20** | **25** |

That the accessibility lens produced no Critical or High finding is itself a result, not an omission. The obvious defects have already been fixed; what remains sits in the gaps the tooling structurally cannot see.

---

## 4. Critical and High findings

Full evidence for each is in the appendix named in brackets.

### 4.1 Critical

**PERF-1 — Coach attendance save issues 7 queries per player row inside one write transaction.** `lib/sessions/service.ts:555`. Round trips are `2 + 7C + D × (1 + 2A)` for `C` changed rows over `D` player-date pairs with `A` adjustments: **194 sequential network round trips for a 24-player roster**, against roughly 10 batched. All of it inside an `immediate` transaction, so every other writer queues behind it. This is the daily workflow of the product's primary user, on its worst network. Effort L, confidence High. *[performance]*

**PERF-2 — Monthly fee preparation runs ~10 queries per player inside a single transaction.** `lib/finance/service.ts`. The migration to batched reads stopped mid-function: `monthlyPreparationCandidates` already uses the batched `loadPeriodAssignmentIndex`, and then `prepareMonthlyCharges` reverts to per-player queries in the loop directly beneath it. At academy scale this is the path most likely to hard-fail on a serverless timeout rather than merely run slowly. Effort XL, confidence High. *[performance]*

**ST-1 — A dropped form submission destroys the page and everything typed into it, on every authentication surface.** 22 `useActionState` sites across 13 files. Verified in `react-dom` 19.2.8: `updateActionStateImpl` re-throws a rejected action's thenable during render, and it propagates to the error boundary. Affects login, PIN setup, TOTP setup and verification, recovery, and account security — the paths where a user has least patience and least ability to recover. Effort M, confidence High (raised from the lens's Medium after verification). *[ux-flows-states]*

### 4.2 High — performance

Every one of these is round-trip amplification over a network database, which is why they cluster at the top.

| ID | Finding | Effort |
|---|---|---|
| PERF-3 | `getPlayerFeeStatement` calls the single-charge loader per charge though the batched loader exists; statement PDF goes from `25 + 4C` round trips to a constant 30 | S |
| PERF-4 | Financial activity view reads eight whole tables on every page load and every CSV page | M |
| PERF-5 | Coach announcements list issues one query per announcement, and the page calls it twice | S |
| PERF-6 | Staff attendance pages issue three queries per junior coach | S |
| PERF-7 | Staff attendance save runs four queries per change, two of them identical | S |
| PERF-8 | Withdrawal-refund eligibility issues nine queries per charge when batched equivalents already exist | M |
| PERF-9 | Payment preview and recording load each charge ledger individually | M |
| PERF-10 | `app/globals.css` puts 236 KB minified on the critical path of every route; 139 KB of it is portal-only and unmatched on the public homepage | M |
| PERF-11 | `motion` costs a measured 36.6 KB brotli for a mount fade on three dashboards | S |
| PERF-12 | `LIKE 'YYYY-MM%'` on `session_occurrences.occurrence_date` cannot use its index | S |

PERF-3 deserves emphasis because it is nearly free: `loadChargeView` is a one-element wrapper that already delegates to `loadChargeViews`, so each substitution is mechanical against an already-tested helper. The genuine loop sites are `lib/finance/service.ts:2054`, `:2647`, `:2927`, `:3033` and `lib/finance/documents.ts:216`.

### 4.3 High — UX

**ST-2 — A failed onboarding reset leaves the button disabled and spinning forever**, with the coach's fee preview already discarded. `player-onboarding-register.tsx:744`. The only async handler in the codebase that can strand its own busy state; every other one resets in a `finally`. Effort S.

**ST-3 — Twenty-one mutating surfaces show raw browser exception text on network failure.** A head coach recording a payment offline reads `Load failed`. The app already owns `describeSaveFailure`, which writes the correct sentence, and uses it on two surfaces. Effort M.

**UX-1 — Two-factor recovery codes are shown once, with no copy control, no download, no acknowledgement gate, and no reissue surface anywhere in the product.** A user who closes that screen without writing them down has no path back. Effort M.

### 4.4 High — code quality

**DEBT-1 — Five end-to-end specs, 1,186 lines and 26 test cases, are never executed by any pipeline.** One config, `playwright.phase8-followup.config.ts`, is referenced by nothing at all: not `package.json`, not `.github/`, not the e2e README. That is 31% of the end-to-end corpus sitting beside the specs that do run, looking like protection it is not providing. Effort M.

**IQ-2 — The finance audit event-type list is hand-maintained in five places and two have drifted**, leaving `training_start_redated` unfilterable both on screen and in CSV export. The one copy typed as `Record<FinanceAuditEventType, …>` is the only complete one — the enforced pattern already exists, four lines away. Effort S.

**IQ-3 — Eleven of thirteen server-side `console.error` calls log a static string and discard the caught error**, making every 500 on the finance and report download surface undiagnosable — while `lib/telemetry/redaction.ts` already provides the helper that would make logging the cause safe. Effort S.

**DEBT-2 — One fifth of the unit suite asserts against source text.** Roughly 250 assertions string-match `.tsx` files, which can pass a broken implementation and fail a correct rename. Effort L.

**IQ-1 — The typecheck gate checks a different file set in CI than locally** *(downgraded from High to Medium after verification)*. `tsconfig.json:32-33` pulls gitignored `.next/types` into the program, and CI's `static` job runs lint and typecheck with no build. The asymmetry is real and worth removing. But the stated consequence — that the 67 route validators never run — is **false**: `npm run build` runs in the required `Build and browser regression` job, `ignoreBuildErrors` is set nowhere, and `next build` performs its own check and regenerates those validators. Effort S.

### 4.5 High — design system

**DS-1 — The five typography tokens are declared but effectively unused.** The real type scale is 30 literal sizes plus ~150 one-off `clamp()` expressions across **1,107** `font-size` declarations; token adoption is 4%. The second-most-common size is 9px across 99 sites, below the token literally named `--type-operational-floor: 10px`. Effort L.

**DS-2 — The spacing scale is a clean 7-step 8px grid in `:root` and a 58-value continuum in the code.** Adoption 2.6%: `18px` (203 uses) beats `16px` (179), while `--space-block: 32px` is read 17 times. Effort XL.

**VD-1 — One design idea exists in 103 distinct variants across 160 rules.** The SMBA uppercase micro-label is the atom most responsible for the product's editorial identity. Two of the largest variant groups differ by 0.01em of tracking at 9px — nine hundredths of a pixel per character. Effort M.

**DS-3 — Seven near-identical hairline greys duplicate `--line` across 22 sites**, all within ΔE 2.74, which is imperceptible at 1px. Effort S — the cheapest High in the report.

**VD-2 — Three different on-dark greens and two on-dark roses express the same semantic on the same navy field**, ΔE 16–31 apart, because the token set has no on-dark tier. Effort S.

---

## 5. Design system audit

### The central result

The `21st review` deterministic pass returned 272 `design-hardcoded-color` findings. Triaging them inverts the obvious remedy:

| Population | Count | Verdict |
|---|---|---|
| Inside the `:root` declaration block | 22 | False positive — a literal is correct in a token declaration |
| **Opaque literals outside `:root` that equal a token's value** | **0** | **The defect the rule name implies does not occur anywhere** |
| `rgba()` whose RGB triple *is* a token value | 157 | No alpha mechanism exists |
| Values the token set does not contain | 96 | No on-dark tier exists |
| `app/layout.tsx:82` `themeColor` | 1 | Exactly `--navy`; a TS metadata object cannot read a custom property |

Independently re-derived; the zero is exact. **Nobody is bypassing tokens they know about** — the same authors use `color-mix()` correctly dozens of times. There is no convention saying which form to use, so both persist. The work is additive token design, not find-and-replace.

This converges with the accessibility lens from the opposite direction. The two proved WCAG 1.4.3 failures are placeholders set to a grey at 72% alpha. The opaque tokens pass comfortably on the same backgrounds — `--steel` gives 5.39:1 on ivory and 5.88:1 on white — so **the missing alpha mechanism is not merely untidy, it is producing accessibility defects**. `globals.css:9001` is simultaneously a contrast failure, an alpha-mechanism gap and palette drift; one edit to `var(--steel)` resolves all three.

### Other structural findings

The palette has grown from 23 declared colours to **72**, with 49 undeclared values across 96 sites. Weight, line-height and letter-spacing are continuous dials rather than scales: 37, 39 and 42 distinct values. The 1px hairline is used 583 times and is the only primitive in the system with no token. **At least 307 lines of CSS are provably dead** — 13 false positives were eliminated first by tracing every dynamic `className` construction in the repo. Every rule DS-7 enumerates is dead, but 307 is a lower bound rather than a total: implementation found roughly 30 further dead rules, nearly all inside media queries. The line *ranges* DS-7 is summarised by are a different matter and need care, because one of them spans a live rule; delete from the per-rule list, not the ranges. See §9 and `docs/audit/verification-log.md`.

`app/public-home.css` is **not** outside the token system, despite its 105 raw literals: it reads `var()` 202 times across 28 tokens and drifted in exactly one role, the hairline. That makes it far cheaper to fix than the raw count suggests.

`.21st/DESIGN.md` is largely accurate. It has five checkable drift items, and in every case **the document is stale rather than the code being wrong**.

### Token proposals

Ordered by value per unit of risk. Call-site counts are measured, not estimated.

| Token | Value | Replaces | Sites | Risk |
|---|---|---|---|---|
| *(existing)* `--line` | `#d7dbde` | 7 near-identical greys | 22 | **Very low** — max ΔE 2.74 at 1px |
| *(existing)* `--text-placeholder` | `#6b7480` | `#667387` ×6, `#617083` ×2 | 8 | Low — ΔE ≈ 4.9, visible only side by side |
| `--on-dark-success` | on-navy green, TBD by eye | `#b9e4cc`, `#8dd9b6`, `#9bd3aa` | 3 | Medium — changes 2 of 3 surfaces by design |
| `--on-dark-error` | on-navy rose, TBD | `#ffb4ba`, `#f7a1a7` | 2 | Medium — as above |
| `--on-dark-muted` | `rgba(255,255,255,0.7)` | 2 agreeing sites + a home for the white-alpha cluster | 2 → 20 | Low, rising if the cluster is normalised |
| `--ticket-paper` → `:root` | `color-mix(in srgb, var(--white) 88%, var(--ivory))` | two byte-identical tokens under different names | 2 (+1 divergent) | **Very low** — zero visual change |
| `--type-page-title` | `clamp(58px, 7.5vw, 102px)` | 6 H1 declarations, one drifted to `8vw` | 6 | Very low — 5 unchanged, 1 corrected |
| *(merge)* `--type-utility-meta` / `--type-operational-action` | pick one name for `12px` | a duplicate-valued token pair | 5 | Very low — no visual change |
| `--border-hairline` | `1px` | 583 literal border widths | 583 | Very low if adopted opportunistically; **not worth a mass rewrite** at 97% existing consistency |
| `.eyebrow` **class**, not tokens | `10px / 800 / 0.1em / uppercase` + colour modifiers | the 103 micro-label variants | 160 rules | Medium — highest design value here; stage it, biggest variant first |
| `--alpha-*` scale or a `color-mix` convention | 4/8/12/20/35/55/70% | the 157 raw alpha variants (65 distinct alphas) | 157 | **Medium–High** — convert to `color-mix` at current alpha first (near-lossless), normalise steps later |

**Deliberately not proposed:** `--radius-none` (the 19 explicit zeroes say it better), `--bp-*` breakpoint tokens (unusable in a media prelude), and a token for the 15 local `z-index: 1/2/3` values (would couple unrelated stacking contexts).

---

## 6. Accessibility and responsiveness

### The gate, assessed

The existing harness is substantial — roughly 316 audits across three seeded profiles, dispatch derived from a state matrix so an unwired profile/actor pair fails loudly rather than skipping silently, plus custom DOM checks beyond axe. It is better than most.

Its most consequential blind spot is that **everything axe marks `incomplete` is collected into advisories and never asserted** (`accessibility-audit.ts:48-49`, `:653`). That single decision hides four categories at once: unresolvable-background and single-character contrast, undersized targets outside the tab order, every `aria-prohibited-attr` case with text content, and all landmark rules. The harness documents the choice honestly, but a green run on a job named "WCAG 2.2 AA" is a narrower claim than it reads as.

Two structural gaps compound it. **The dialog focus-restoration assertion can never execute** (A11Y-4): the gate contains a written `serious`-impact check keyed on `data-accessibility-dialog-opener`, and none of the three dialog triggers sets it — so the most common modal defect is entirely unguarded. And of the six new WCAG 2.2 AA criteria, **axe 4.13 ships exactly one rule** (`target-size`), verified as actually running despite `enabled: false` because naming `wcag22aa` bypasses that flag in `matchTags`.

### What was proved

All **17** focus-outline removal sites pass. Twelve are saved by a single deliberate `!important` floor at `globals.css:13691`, scoped to `input`/`select`/`textarea`; two are `div`s outside that scope and are correct only because someone hand-wrote a matching rule — the floor will not protect the next one (A11Y-9).

The two placeholder contrast failures at 2.93:1 and 3.06:1 (A11Y-1) are the strongest proved defect, and **no axe rule reads `::placeholder` colour at all**, so the gate can never find them at any severity.

Authentication is close to exemplary for the new 2.2 criteria: no paste blocking anywhere, `one-time-code` on every TOTP field, identity carried forward as read-only or hidden inputs rather than re-requested. 2.5.7 Dragging Movements is genuinely not applicable — zero drag, pointer, touch or range handlers exist.

Breakpoints match `.21st/DESIGN.md` exactly on all 20 widths; nine singleton widths are undocumented drift. The one apparent dead band at 761–779px turned out to be coherent when traced.

---

## 7. What's working well

Preserved deliberately, because several of these are load-bearing and a future change could undo them without anyone noticing.

**State coverage is near-total.** Once App Router inheritance is resolved, 41 of 46 routes have a loading boundary and **all 46 have an error boundary**. Not one missing empty state was found across 30 applicable routes, after searching a dozen naming conventions. A pessimistic audit would have got this badly wrong.

**Attendance is the best-built path in the product** — which is right, since it is the highest-stakes one. `lib/client/attendance-draft-storage.ts` is exemplary: versioned keys, whole-payload rejection, quota tolerance, symmetric staleness handling. The UX lens tried to prove the "saving again is safe" timeout copy was a lie and found `lib/sessions/service.ts:651-658` deliberately orders the idempotent no-op before the conflict check. The copy is accurate.

**Type and lint discipline is genuinely clean.** Zero `any`, zero `@ts-ignore`, zero `eslint-disable` in source. No import cycles, no inverted layering. All 62 `"use client"` directives justified — every custom hook was resolved to its definition to confirm it. Every async handler except one resets pending state in a `finally`.

**The font work from the previous cycle is intact and correct** — `preload: false` on the upright Newsreader face, 3,444 bytes of rupee-glyph subsets overriding `latin-ext`. Do not touch it.

**Destructive-action copy is mostly excellent**: 11 of 14 confirmations name their consequence, which is why the three that don't read as omissions rather than policy.

**The accessibility investment is real** — the derived state matrix, the deliberate focus floor, the custom DOM checks, and honest documentation of what the harness chooses not to assert.

**`components/registration-form.tsx` already solves the network-failure problem correctly**, with a Playwright test proving two 503s preserve the typed name. ST-1 and ST-3 are both failures to generalise a solved problem, not failures to solve one.

---

## 8. Roadmap

### Now — correctness and data loss (1–2 weeks)

The three Criticals plus the cheap High-value fixes. Ordered so the near-free wins land first and de-risk the rest.

1. **A11Y-1** placeholder contrast — two colour values, proved arithmetic, one hour.
2. **ST-2** stranded onboarding reset — one `try`/`finally`.
3. **IQ-2** finance event-type single source — one closed set, already-drifted twice.
4. **PERF-3 + PERF-9** swap `loadChargeView` for the batched loader at 5 loop sites — mechanical, already tested.
5. **ST-1** authentication forms survive a dropped request — the one Critical that is not a performance problem.
6. **PERF-1** batch the attendance save — highest amplification in the product, on the daily workflow.
7. **PERF-2** batch monthly fee preparation — the path most likely to hard-fail outright.

### Next — adoption and honesty (3–6 weeks)

Finish the abstractions that already exist, and make the gates mean what they say.

- **ST-3** route 21 surfaces through `describeSaveFailure`.
- **UX-1** let users actually save their recovery codes.
- **IQ-1** make the typecheck gate deterministic; **DEBT-1** wire up or delete the 1,186 unrun spec lines.
- **A11Y-4 / A11Y-2** make the gate see what it discards, starting with the assertion that can never fire.
- **PERF-4/5/6/7/8** the remaining round-trip amplification.
- **DS-3 + on-dark tier + the alpha convention** — the token work that unblocks the rest of the design system.
- **PERF-11** drop `motion` for a CSS fade; the three heroes become Server Components.

### Later — structural (quarter-scale)

Real value, real risk, no urgency. Sequence behind the above.

- **DS-1 / DS-2 / VD-1** typography, spacing and the eyebrow class — the largest design-consistency wins, best done in stages.
- **DEBT-2** convert ~250 source-text assertions to behavioural tests. Land before the big component refactors or the string assertions will fight them.
- **IQ-7 / IQ-8** split `lib/finance/service.ts` (4,355 lines) and the two 900-line components.
- **PERF-10** split portal-only CSS out of the global critical path.
- **PERF-20** introduce caching; currently every portal page is fully dynamic.
- **UX-7 / UX-8** persistent navigation and offline awareness — product decisions, not just engineering ones.

---

## 9. PR plan

57 PRs are proposed across the five appendices. This table is the merged, deduplicated view, in **recommended review order**. Waves are gated: everything in a wave is parallelisable, and a wave should be substantially merged before the next begins.

**The two contention points** are `app/globals.css` (touched by 8 PRs) and `lib/finance/service.ts` (touched by 6). Both are called out per row.

### Wave 1 — near-free, no conflicts (review first)

| # | PR | Findings | Files | Effort | Risk |
|---|---|---|---|---|---|
| 1 | Fix the two placeholder contrast failures | A11Y-1 | `globals.css`, `financials.module.css` (1 line each) | S | Very low |
| 2 | Fix the stranded onboarding reset | ST-2 | `player-onboarding-register.tsx:744-760` | S | Low |
| 3 | Add the five missing loading states | ST-5 | 4 new `loading.tsx` | S | Low — new files only |
| 4 | Tokenise the 22 hairline greys | DS-3 | `public-home.css` (21), `globals.css` (1) | S | Very low — ΔE ≤ 2.74 |
| 5 | Delete the dead CSS **and** the orphaned exports together | DS-7, DEBT-3, DEBT-4 | 3 modules, `globals.css`, 9 `lib/` exports, `development-meter.tsx` | M | Medium — see the two notes below |
| 6 | Make the typecheck gate deterministic | IQ-1 | `tsconfig.json` | S | Low |
| 7 | Give the staff register scroll region a role | A11Y-7, A11Y-5 | `staff-attendance-register.tsx` +12 sites | S | Low — re-run the gate |

**PRs 5 and 8 have been merged into one, and the numbering after it is left unchanged so that the cross-references elsewhere in this section still resolve.** They are not independent. `components/development-meter.tsx` is the dead component DEBT-3 removes, and its only styles are rules DS-7 deletes — `app/globals.css:3024-3058` plus the `.development-track` fragments in the shared rules at `:2713-2718` and `:2724-2729`. Deleting the CSS alone leaves a component that still renders with no styling; deleting the component alone leaves orphaned rules behind. Land them as one PR, or land the component deletion first.

**DS-7's line ranges are not safe to act on; its enumerated per-rule list is.** Delete from the rule list in `docs/audit/visual-design-system.md`, not from the ranges in its PR-2 line. Three specific hazards, all verified: `app/globals.css:4106-4192` spans `.coach-directory-notice` at `:4172`, live at `components/coach/members/member-directory.tsx:617`; DEBT-3's `app/globals.css:2714-2718` is a shared rule from which only the `.development-track` selector may be taken, since `.attendance-track` is live; and deleting the remaining `.coach-registration-approved` rules will fail `tests/accessibility-hardening.test.ts:48`, which asserts on the text of `globals.css`. The risk on this row is Medium for these reasons, not because the dead rules are in doubt.

### Wave 2 — round trips and adoption

| # | PR | Findings | Files | Effort | Risk |
|---|---|---|---|---|---|
| 9 | Swap `loadChargeView` → `loadChargeViews` at every loop site | PERF-3, PERF-9 | `finance/service.ts`, `finance/documents.ts` **①** | M | Low |
| 10 | Fix the announcements 1+N and the duplicate page call | PERF-5 | `announcements/queries.ts`, 2 pages | S | Low |
| 11 | Batch staff attendance read and write | PERF-6, PERF-7 | `coach/staff-attendance.ts`, 2 pages | M | Low |
| 12 | Indexes and predicate shape (`LIKE` → half-open range) | PERF-12, PERF-13, PERF-25 | `schema.ts`, new migration | S | Low — additive |
| 13 | Finance event-type single source of truth | IQ-2 | `schema.ts`, `finance/*` **①** | S | Medium — `db:check` must stay green |
| 14 | Log the cause; extract a download-route primitive | IQ-3, IQ-6 | 6 route handlers | M | Medium — 5 route tests must stay green |
| 15 | Explain network failures on 21 surfaces | ST-3 | 12 components | M | Low — failure branch only |
| 16 | Authentication forms survive a dropped request | ST-1 | new hook + 13 form files | M | **Medium** — gate on the auth regression suites |
| 17 | Memoise `Intl` formatters | PERF-18 | `format.ts` + 12 components **①** | S | Low |
| 18 | Replace `motion` with a CSS fade | PERF-11 | 3 heroes, `globals.css` **②** | S | Low — check visual snapshots |

### Wave 3 — the two Criticals and the gate

| # | PR | Findings | Files | Effort | Risk |
|---|---|---|---|---|---|
| 19 | **Batch the attendance-save write path** | PERF-1, PERF-19 | `sessions/service.ts`, `attendance/adjustments.ts` | L | **High** — touches conflict detection and the adjustment invariant |
| 20 | **Batch monthly fee preparation** | PERF-2 | `finance/service.ts` **①** | XL | **High** — idempotency keys, fee refs, audit metadata |
| 21 | Rebuild withdrawal-refund eligibility on batched helpers | PERF-8 | `finance/service.ts` **①** | M | Medium — money-critical; needs refund tests |
| 22 | Scope the activity/collections reads and CSV exports | PERF-4, PERF-16, PERF-17 | `finance/records.ts`, 3 CSV routes | M | Medium — narrowing reads must not narrow summaries |
| 23 | Wire up or delete the 5 unrun E2E specs | DEBT-1 | `package.json`, `.github/` | M | Medium — newly-run specs may fail; that is the point |
| 24 | Make the gate see what it discards | A11Y-4, A11Y-2, A11Y-9 | `accessibility-audit.ts` | M | Medium — land behind a flag; **after** PRs 1 and 7 |
| 25 | Recovery codes: copy, download, acknowledge | UX-1 | `two-factor-setup-form.tsx` | M | Low — adds an enrolment step |
| 26 | Confirm the destructive actions that don't | ST-6, UX-2, UX-3 | 3 components | S | Low |
| 27 | Persist report drafts locally | ST-4 | new storage module + `report-workspace.tsx` | M | Low |

### Wave 4 — design system

| # | PR | Findings | Files | Effort | Risk |
|---|---|---|---|---|---|
| 28 | Add the on-dark tier; unify coach status colours | VD-2 | `globals.css` **②**, `financials.module.css` | M | Medium — needs a designer to pick 3 values |
| 29 | Adopt a `color-mix` convention at current alphas | DS-4 | `globals.css` **②** | L | Medium — near-lossless if alphas are preserved |
| 30 | Collapse the top 8 eyebrow variants into one class | VD-1 | 8 files + TSX **②** | M–L | Medium — highest design payoff; land after PR 5 |
| 31 | Small provable typography fixes | DS-5, VD-6, DS-11, DS-12 | `globals.css` **②**, `layout.tsx` | S | Low |
| 32 | Close the 2.5.8 desktop target-size gap | RESP-1 | `globals.css` **②** | S | Low — visible change on 2 surfaces |
| 33 | Horizontal scroll padding on the registers | RESP-2 | `globals.css` **②** | S | Low |
| 34 | Unify the "unavailable" hatch and ticket-paper tokens | VD-3, VD-4 | `globals.css` **②**, `dashboard-card.module.css` | S–M | Low/Medium |
| 35 | Remove the 27 `!important`s from the Fee Register module | DS-10 | `financial-records.module.css` | M | Medium — cascade surgery; screenshot 3 widths |
| 36 | CI guards against colour/dead-CSS/themeColor drift | guards DS-3, DS-7, DS-12, DS-15 | `.github/`, `scripts/` | M | Very low — **must land after PRs 4 and 5** |

### Wave 5 — structural (schedule deliberately)

| # | PR | Findings | Effort | Risk |
|---|---|---|---|---|
| 37 | Convert ~250 source-text assertions to behavioural tests | DEBT-2 | XL | Medium — **land before 38 and 41** |
| 38 | Extract `<WindowedRegisterTable>` | IQ-5 | M | Medium — accessibility-sensitive |
| 39 | Extract the 4 small shared primitives | IQ-9, IQ-10, IQ-11 | S | Low |
| 40 | Split `lib/finance/service.ts` (4,355 lines) | IQ-7 | M | Low as a pure move with a re-export shim; **after** wave 3 |
| 41 | Break up the 912- and 688-line components | IQ-8 | XL | Medium |
| 42 | Tests first, then route admin/account through the service layer | IQ-12, DEBT-6 | L | **High** — least-covered surface; tests must land first, separately |
| 43 | Split portal-only CSS off the critical path | PERF-10 | M | Medium — verify against visual regression |
| 44 | Caching: `React.cache` + revalidation strategy | PERF-20, PERF-21, PERF-22 | S–M | Low |
| 45 | Extend the unsaved-work guard beyond the coach workspace | ST-7 | S | Medium — widens global listeners |
| 46 | Offline awareness banner | UX-8 | S | Low — word it as a hint, not a verdict |
| 47 | Route-change focus management | A11Y-6 | M | Medium — can fight existing focus calls |
| 48 | Correct `.21st/DESIGN.md` | DS-8, DS-13 | S | None — **land last**, after everything above |

**① `lib/finance/service.ts`** — PRs 9, 13, 17, 20, 21 all touch it. Merge order within wave: 9 → 13 → 17, then 20 → 21 in wave 3. PR 40 (the split) must come after all of them.

**② `app/globals.css`** — PRs 18, 28, 29, 30, 31, 32, 33, 34 all touch it. They edit disjoint regions, but line numbers churn: land PR 5 (dead-CSS deletion) first, then take them in table order.

### Review order rationale

Wave 1 is seven small, low-risk PRs that between them fix a proved WCAG failure, a stranded-state bug, and the gate determinism problem — a good warm-up that also removes noise from later diffs. Six of the seven are genuinely independent; PR 5 is the exception, and it carries the only real care requirement in the wave. Wave 2 delivers most of the performance benefit at low risk, because the batched helpers already exist and are tested. Wave 3 holds the two genuinely dangerous refactors; both need their existing test suites green before merge, and neither should be reviewed while anything else is landing in the same file. Waves 4 and 5 are safe to defer indefinitely without the product degrading.

---

## 10. Method and limits

Five independent lens audits at the same commit, each with strict file ownership, plus a deterministic pass (`21st review` scoped to `app components lib`) and a review against Vercel's Web Interface Guidelines. Load-bearing claims were re-verified centrally; see `docs/audit/verification-log.md`.

**No agent ran a browser, a dev server, or the Playwright suites.** Five concurrent agents contending for port 3000 and the shared `.data` fixtures would have produced unreliable results. The cost is that anything requiring runtime observation carries an explicit "how to prove" command and honest Medium or Low confidence rather than a fabricated number. Ten findings are Medium confidence and one is Low; the other 87 are proved by execution, arithmetic, or source reading.

**What this means in practice:** computed styles, real focus order, rendered hit areas, actual timings and the live accessibility tree were not observed. Byte counts were measured. Contrast ratios were computed. Round trips were derived from code paths, not timed.

**One process note worth recording.** The gitignored `output/` directory holds full copies of the repository at older commits from a previous session. A naive scan reports defects from them as if they were current — it produced two false findings here before they were caught, and it corrupted a file count in the briefs themselves (100 CSS Modules; the real number is 10). Any future audit of this repo should scope its tools to real source paths and prefer `rg`, which respects `.gitignore`.

## Appendices

Full findings with complete evidence, in `docs/audit/`:

- `visual-design-system.md` — 21 findings, token proposals, 10 PRs
- `ux-flows-states.md` — 16 findings, the 46-route state coverage matrix, 11 PRs
- `accessibility-responsiveness.md` — 16 findings, the 17-site focus audit, the gate assessment, 10 PRs
- `code-quality-debt.md` — 20 findings, 8 disproved candidates, 13 PRs
- `performance.md` — 25 findings with round-trip formulae, 13 PRs
- `verification-log.md` — independent re-proofs, corrections, and retractions
