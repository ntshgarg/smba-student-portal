# SMBA Student Portal — Product, Design & Engineering Audit

**Audited:** 2026-08-23 · **Audit baseline:** `3cbd766` on `main`
**Remediated:** 24 commits on `audit-remediation`, squash-merged to `main` as `18a625e8` — [PR #56](https://github.com/ntshgarg/smba-student-portal/pull/56), 2026-08-23 — plus one follow-on commit, `de7f841` (PERF-8), not yet in that PR. The individual commits and their reasoning survive only on `audit-remediation`; `main` carries one squash commit, so that branch is the primary record of *why* each change took the shape it did.
**Scope:** Full application — public marketing site, Player Journal, Head-Coach Workspace, Junior-Coach Dashboard, Platform Admin, authentication flows.
**Reviewed:** 94 files in `app/`, 102 in `components/`, 80 in `lib/`, 16,364 lines of CSS, 137 unit tests + 13 Playwright spec files (of which CI gates five as named regression suites, plus accessibility and failure-evidence — see DEBT-10).

**How to read this.** §1 and §§2–4 describe the codebase **as it stood at `3cbd766`**. Individual findings carry inline status where remediation changed the picture: **Resolved** with the commit that did it, **Partially resolved** where part shipped and the rest is named, **Corrected** where implementation disproved the original claim, **Declined** where a proposal was measured and rejected, **Retracted** where a proposed remedy turned out to be wrong. Line and file references are baseline references and several have since shifted; the identifiers, not the line numbers, are what to search on. [Remediation status](#remediation-status) consolidates all of it in one place. §5 and §6 were rewritten after the merge and describe the position **now**, not at the baseline.

**Method.** Six parallel domain audits (design system, accessibility, UX states, responsiveness, implementation quality, performance), then independent verification of every headline claim against source. Two subagent findings were materially wrong at that stage and were corrected before publication. Implementation then corrected sixteen more of the audit's own claims and retracted two proposed remedies outright — see [Corrected claims](#corrected-claims) for the five that changed a headline number, and the inline **Corrected** markers for the eleven others. Deterministic tooling: `21st review` (285 findings, all `design-hardcoded-color`), `tsc --noEmit`, `eslint .`.

---

## 1. Verdict

This is a **mature, unusually well-disciplined codebase** — materially above average for a product of this size. It has a genuine automated accessibility gate (49 states × 3 profiles × 3 viewports, WCAG 2.2 AA, CI-blocking), zero `any`/`@ts-ignore` in production code, zero ESLint findings across 477 files, server-side idempotency on every money and publish path, and an exceptional written design decision record (`.21st/design.json`, 132 recorded decisions) that most teams never produce.

The defects that remain are **not architectural failures**. They cluster in four places:

1. **Resilience of client action handlers** — a courtside coach on a flaky connection can get a permanently stuck button.
2. **A design token layer that stopped halfway** — 36 tokens exist, but radius/shadow/motion/z-index/breakpoints have none, one token reference is dead, and the product's own 10px type floor is violated by its own CSS.
3. **Two server-side N+1 query patterns** in finance that scale with charge and player count.
4. **Delivery and build hygiene** — all portal CSS parsed on the marketing page, `typecheck` that passes or fails depending on stale build artifacts, and a validation library installed but used once.

Nothing here is an emergency. The highest-severity item (ST-1) is a ~2-hour fix.

**What changed since — addendum, 2026-08-23, after PR #56.** The assessment above is left as written, because its judgement was largely borne out: nothing found during remediation was architectural, and the four clusters were the right four. Three are now substantially closed. Client-handler resilience: ST-1, ST-7 and ST-2's copy-and-deadline work all shipped. The halfway token layer: the 36 baseline tokens became 39 with the contrast and type-floor additions, then **39 → 54** in the token-layer pass, no `var()` reads an undeclared property any more, and 693 lines of dead CSS are gone. Delivery hygiene: `typecheck` is deterministic and both finance N+1 patterns are constant-time rather than linear. What remains of the first cluster is a *durability* problem rather than a resilience one — attendance drafts still live only in React state.

The closing line held: nothing was an emergency, and ST-1 was indeed small. What the verdict under-weighted is how much of this document's own reasoning would not survive contact with measurement. **Sixteen** of its claims were corrected, two findings had their remedies retracted outright, and the largest available win on the public routes was not in the document at all — PERF-8 was found while measuring a finding that then had to be withdrawn, and PERF-9 was found while measuring PERF-8. Both of those follow-on findings then corrected the finding that produced them: PERF-8's stated hypothesis was inverted, and its headline `1,472 ms` baseline did not reproduce. The audit's most valuable output turned out to be the measurements it provoked rather than the conclusions it drew. That is recorded finding by finding and summarised immediately below.

---

## Remediation status

*Recorded 2026-08-23, after PR #56 and the follow-on commit `de7f841`. Of the 49 findings in this document — 41 from the original audit plus 8 discovered during implementation — **20 are resolved**, **4 are partially resolved**, **2 were retracted**, and **23 remain open**. Every figure below is from a commit message on `audit-remediation`, from a measurement report under `output/`, or from the finding body it summarises; where a number was not measured, it says so.*

### What was implemented

| Area | Findings | What changed | Measured outcome | Commits |
|---|---|---|---|---|
| Client-handler resilience | ST-1 | Six handlers now reset the busy flag in `finally`. The `catch` wraps only the awaited call, so a failure inside `onSuccess` is no longer reported as "could not be saved" against an approval that succeeded. | Not measured — a correctness fix | `8d60c85` |
| Unsaved-work guard | ST-7 | The guard now always runs the caller's callback; only the history-boundary release stays conditional. Fixed in the guard, so all four call sites were corrected without being touched. The callback is scheduled on a microtask specifically so it cannot land inside ST-1's `try`. | Regression test drives the real provider with two dirty surfaces; 2 of its 3 cases fail against the previous implementation | `0254bbd` |
| Courtside failure handling | ST-2 (partial) | Network failures get operational copy keyed on the error's **constructor**, not its message, because the message differs per engine. The existing Save control relabels to "Save attendance again". A 20s/15s deadline bounds the indefinite hang, with copy that reports an unknown outcome rather than a failure. | 17 unit tests. Retry-after-timeout is provably safe: both services skip a no-op change, write via `onConflictDoUpdate`, and run in immediate transactions | `f543d10`, `75d3c88` |
| Route boundaries | ST-3, ST-4 | `app/global-error.tsx` plus 4 `loading.tsx` files covering 9 async routes by segment inheritance, and a boundary at the `announcements` segment rather than the `(public)` group so it cannot wrap the static homepage. | 15 routes, not the 18 originally claimed; 4 files, not the 7 estimated | `5f5312e`, `49ad19c` |
| Contrast | A11Y-1, A11Y-2 | `--text-placeholder` and `--line-disabled` added, both computed against composited rather than assumed backgrounds. | Placeholders 3.12:1 → **4.74:1** on white (4.54:1 on paper); disabled month arrows 1.39:1 → **3.37:1** | `a13888f` |
| Form error association | A11Y-3, DEBT-6 | `AuthField` extracted with the control as a render prop, and five forms wired to it — fixing the cause rather than the five symptoms. Two error props, one rendered in-field and one naming an alert the form renders elsewhere, so no existing error paragraph had to move. | Rendered DOM shape and class list unchanged, verified by static render. No `name`, `autocomplete`, `inputMode`, `type` or `required` value changed | `c087412` |
| Keyboard and landmark parity | A11Y-4, A11Y-5 | Admin skip link. All three scroll containers carry `role="region"`, a name and `tabIndex` — including the attendance register this finding had cited as the *correct* example, which had the same defect. Year selector moved to `role="group"`. | Not measured beyond the original 79-Tab-stop reproduction | `5640ee0`, `49ad19c` |
| Accessibility coverage | A11Y-6 | Seven states and three interactions added, with a shared `openDialogFrom` helper so future dialog states inherit the focus-trap, Escape and focus-return checks. | **316 audits** across three profiles (stress 177, admin 87, clean 52). Found three real defects: `not-found.tsx` had no `main` landmark, the finance-activation consent checkbox was an **18px** tap target passing only because a sentence happened to wrap, and `channelPills` carried `aria-label` on a role-less `div` | `eaf1dd4`, `7fac52d` |
| Accessibility gate honesty | A11Y-8 (partial) | `axe.incomplete` and the `best-practice` rule family now surface as labelled non-blocking advisories in the job summary. The blocking path is factored out and unchanged. | Backlog sized at **1,243 advisories** over 316 audits; `color-contrast` is **90.3%** of it and two rules are 98.7%. Per profile: stress 1,068, admin 175, **clean 0** | `6abea0c`, `383ef87` |
| Operational type floor | RESP-1 | `--type-operational-floor: 10px` added and applied across three passes — globals, then five rules whose narrow-viewport override was *larger* than its wide-viewport base, then the CSS modules. | **Zero declarations below 8px remain anywhere in the repo**, and exactly 3 at 8px, each with a stated reason. The sanctioned 9px tier is untouched; its count moved 98 → 99 only because the step-rail label was raised into it. Sizing measured from real Manrope glyph advances, not estimated | `a13888f`, `4722fe3`, `52c0fc9` |
| Token layer | DS-1, DS-2, DS-3 (partial), DS-7, DS-8 | `:root` built out and adopted; `--color-navy` and two further undeclared properties fixed; nine raw `#071b32` plus one `#fbfaf7` the audit missed; one unlayered `.sr-only` keeping the name so 25 call sites are untouched; `.21st/DESIGN.md` and `design.json` regenerated. Two new assertions: no `var()` read of an undeclared property, and no raw hex matching a token value outside `:root`. | `:root` **39 → 54 tokens**, adopted across **101 declarations**. Provably inert: every stylesheet snapshotted, each new token mechanically expanded back to its literal and diffed. Both assertions verified non-vacuous against mutated input | `5204109` |
| Dead CSS | DS-1 follow-on | The 74-line player-register table block, then 23 dead class keys in `financials.module.css` — the residue of a financials-to-modules migration the audit never saw. Pruned with PostCSS because 11 rules were comma-separated groups mixing dead and live selectors. | **693 net lines removed.** Exhaustive rather than probabilistic: CSS Modules hash per file, so all 8 importers were checked for dot access, both bracket forms, template construction, `composes`, destructuring and aliasing | `7fcbba4` |
| Finance query cost | PERF-1 | Both named N+1 patterns rewritten as set-based reads grouped in memory, then the fee register and collections day book in a second pass. Adjustment ordering pinned on rowid, because the originals had no tiebreaker on observable output. | Coach fee record **697 → 23**; player fee record **97 → 13**; fee register **375 → 7** (monthly) and **394 → 6** (registration); collections day book, 92-day range, **266 → 6**; candidate assignment reads at N=100 **200 → 2**; all 291 charges through the loader **1,164 → 4**. All constant rather than linear. Parity proven across 106 accounts, 300+ charges at both `includeInternal` values, 675 register filter combinations and 27 deep cursor walks — JSON-identical row-ID and cursor sequences | `1d57db1`, `d197bcb` |
| Client bundle | PERF-3 | Four presentational dashboard cards moved back to the server. `reports-card` keeps its directive because `useReportResume` reads `localStorage`. | Four cards, not the five originally claimed | `cb80117` |
| Font preloading | PERF-8 | Newsreader split into two `next/font` instances so the upright face can drop its preload. The two styles turned out to be used on complementary surfaces — italic on `/`, `/player`, `/coach`; upright only on auth forms and operational registers — so every route was preloading one face it never rendered. `app/layout.tsx` alone, 20 insertions. | **−58,152 B** preloaded per route (−39.5%). FCP/LCP **−66.9 ms** on `/` [−129.4, −4.4], **−90.3 ms** on `/login`, **−87.4 ms** on `/player` FCP, at slow 4G with 6× CPU over 7 interleaved paired passes. CLS **0.0000 in all 63 runs**. Full-page PNGs byte-identical on seven routes; 0 typography, geometry or platform-font diffs. The finding's own hypothesis was inverted and one of its input numbers did not reproduce — both recorded in PERF-8 | `de7f841` |
| Verification gates | DEBT-1 | `tsconfig` and `vitest.config` given real excludes. Fixed with an `exclude` rather than a narrowed `include`, because `next build` re-appends the `.next` glob and rewrites `tsconfig.json` — so removing an include self-reverts. `.next/types` deliberately kept, since `next build`'s own type check enumerates from this config. | Typecheck **2 → 0** errors; files `tsc` read from `output/` **919 → 0**; Vitest collected files **607 → 142** | `6abea0c` |
| Repository hygiene | DEBT-9 | The 140 KB prompt playbook referencing a dead path and the generated `MASTER.md` wired to nothing, both deleted. | **3,653 lines** removed | `51677e2` |
| Unplanned: upstream token defect | DS-1 class | Merging `origin/main` brought in a fee-preview panel reading `var(--line-strong)`, declared nowhere — not upstream, not locally, not at the merge base. An undeclared custom property invalidates the whole `border` shorthand, so the panel drew **no border at all**. Repointed at `--line`. | Caught by the assertion added for DS-1, on code from a different author within days. Upstream CI could not have caught it: that assertion exists only on this branch | `a47ba64`, `7b1acba` |

### What was deliberately not done

This is the more valuable half of the record, and none of it is a backlog. Two findings were withdrawn after measurement, and several proposals were declined because measuring them showed they would make things worse.

**PERF-2 — the CSS route-group split, retracted as written. Zero code changed.** The finding's own rationale was that the real cost was parse and style-recalculation rather than bandwidth. That is wrong by **14×**: removing 315 KB and ~3,030 unmatched rules is worth **7 ms** on `/` and **2.4 ms** on `/login` at 6× CPU throttling, against a ±90 ms FCP noise floor, because Blink lazily parses declaration blocks and buckets rules by their rightmost compound selector — `ParseAuthorStyleSheet` totals 14 ms for all 366 KB. The cost the finding explicitly *dismissed*, transfer, is the real one: **161 ms of protocol-independent bytes** on slow 4G with up to ~600 ms more depending on HTTP/2 prioritisation. And the proposed three-way `(coach)`/`(student)`/auth partition was unjustified, because a **binary** public/portal split captures **95%** of the perfect per-route ceiling — `/` and `/login` together need 176 of 3,097 rules. Splitting portal CSS is declined entirely: those are warm-cache surfaces behind a login whose real cost is 660–671 KB of JS. **A trap worth preserving:** benchmarking the parse hypothesis via `new CSSStyleSheet().replaceSync()` does cost 50–60 ms at 6×, so the obvious experiment would have *confirmed* the wrong conclusion. The browser never takes that path.

**PERF-4 — PDF streaming, retracted. Zero code changed, and that is the correct outcome.** Streaming cannot bound memory for two independent reasons: both generators pass `bufferPages: true` because they write a "Page N of M" footer, and knowing the total page count requires composing the whole document first — so no byte of page content can leave before the document is already in memory; and PDFKit's `_write` discards the `false` from `this.push()`, so a slow consumer cannot slow it down. The one attempt that produced a diff — removing `new Uint8Array(pdf)` from four routes — was reverted, because it does not compile (four `TS2345`: since TypeScript 5.7 `Buffer` is `Uint8Array<ArrayBufferLike>`, and `BodyInit` demands the concrete type; there is no assertion-free zero-copy form) and because `Response` copies its `ArrayBufferView` regardless, making the removed copy one of roughly six. The declined variant also carried a live hazard: omitting offset and length on a pooled buffer serves the backing store instead of the view — measured as 87,454 bytes beginning `"îîîîî"`, a corrupt PDF that still starts plausibly enough to pass a casual check. Scope was overstated too: only the player statement is unbounded, since the report routes are capped by `REPORT_TEXT_MAX_LENGTH` and the receipt is one page.

Declined on measurement, each with its evidence:

| Declined | Evidence |
|---|---|
| `.coach-month-grid button small` stays at 8px | "sessions" needs **43.3px** in a **25.7px** cell at 320px, so the caption already overflows at its current size. Raising it deepens a pre-existing overflow, on a surface `mobile-calendar-attendance-freeze` covers. |
| The onboarding step-rail label went to 9px, not 10px | `ASSESSMENT` needs **70.5px** in a **64.5px** track at 320px and the grid is `minmax(0, 1fr)`, so the track cannot grow. 9px is the largest size that fits and one the design record already sanctions for small uppercase labels. |
| `financials.module.css:2764` allocation caption stays at 8px | `nowrap` + `ellipsis`. At 8px `SMBA-ABCD2345 · Available ₹12,500` needs **133.6px** in a **135px** track and fits; at 10px it needs **167px** and the ellipsis lands mid-word, removing the amount. The design record's prohibition on hiding ledger facts outranks the type floor, and the adjacent 104px amount-input track is fixed. |
| The mobile "Today" word is hidden, not enlarged | It cannot reach 10px inside a 32px cell. It now sits in an `aria-hidden` subtree, and the state is already carried by `aria-current`, the cell label, a 2px red inset ring and a red top bar. |
| No shadow elevation tokens, against §4.1's proposal | Every drop shadow in the file has a unique value, so a scale could only be created by inventing one and silently unifying existing differences. The real cluster is inset keylines, so those became the tokens; three near-identical menu shadows are recorded as drift instead. |
| No breakpoint tokens, against §4.1's proposal | Media features are evaluated **before** custom-property substitution, so `--bp-*` would be unusable in the only place it belongs. The 20 widths are documented instead. |
| `border-radius: 0` left raw at 19 declarations | The system is deliberately square, and a `--radius-none` token would say nothing the `0` does not. |
| No skip link on `app/not-found.tsx` | The 404 has no header or nav to bypass, so a skip link would add a focus stop before the page's only link in order to skip nothing. Verified empirically that a 404 beneath the coach shell audits clean. |
| `color-contrast` not promoted to blocking | Its 1,122 results are *incomplete*, not violations — axe returns incomplete when it cannot resolve the effective background, which this UI's gradients and transparency cause constantly. The count scales with element volume, not defect count, which is why one profile contributes 1,068 and another zero. Promoting it would make the gate permanently red on cases axe declined to decide. |
| A 320px title wrap accepted rather than avoided | Raising the coach dashboard status stamp to 10px makes the *Monthly reports* card title wrap at 320px only, with the longest stamp. Nothing clips or overlaps and it resolves by 340px — a fair exchange for eliminating illegible 7px text. Do not refile as a regression. |
| Dropping the Newsreader **italic** preload as well, despite it being the largest single number measured | Worth **−241.1 ms** on `/` [−280.3, −202.0] and declined. It removes **31 bytes** — `/` goes 371,325 → 371,294 — because it does not stop the fetch, only moves it out of the render-blocking window. The price is the hero's emphasised word rendering in Times New Roman for an extra **344 ms** on the acquisition surface, a 494 ms delay to the `/player` greeting, and `/player` LCP moving from the shipped arm's 1,960 ms to 2,468 ms. Priced and left as a decision for the design owner, against `public-production-readiness`. |
| Per-route font preloading via route-group instantiation — **rejected on mechanism, not preference** | The preload flag is part of the `next/font` instance and is encoded in the emitted filename (`…-s.p.…woff2` vs `…-s.…woff2`, verified by diffing built font CSS across three arms). Mixing a deferred and a preloaded instance of one family yields two URLs for identical bytes and two competing `@font-face` rules in one document; which wins depends on chunk order. Declaring italic only in the group layouts instead would strip it permanently from `/admin`, `/activate`, `/recover`, `/setup`, `/account` and `/auth/*`, which do render it. |

### What remains

**(a) Blocked on a human decision.** None of these is a code question, and each one blocks work behind it.

| Decision | Finding | The conflict |
|---|---|---|
| The roll-call mobile type size | RESP-4 | The decision record contradicts itself — it mandates a ~10px operational floor for labels *and* separately sanctions "9px desktop/tablet and 8px mobile" for this specific control. Production contradicts both: a specificity accident (0,4,3 beating the floor block's 0,4,2) renders the first button at **11px** and the second at **8px** inside one joined control, up to 760px. Both halves must end up the same size; which size is the design call. |
| Where production errors report to | ST-3 completion, DEBT-10 | `app/global-error.tsx` destructures only `reset` and never reads the `error` Next.js hands it, and the repository contains no error-reporting sink of any kind. So six boundaries now render branded recovery UI and report to nobody. Choosing a destination has a cost and is a platform decision. |
| Tailwind: adopt or drop | DS-6 | The finding framed this as "adopt it properly or drop it and define `.sr-only` directly". Dropping is **more expensive than stated**, because Preflight is load-bearing here — the `box-sizing`/margin/padding/border reset, `list-style: none`, `display: block` on replaced elements, `font-size`/`font-weight: inherit` on headings, and `[hidden] { display: none !important }` all have to be reproduced by hand. Adopting means accepting that every utility sits in the `utilities` layer, beneath ~14,000 lines of unlayered CSS that outranks it regardless of specificity. |

**(b) Ready to pick up, in value order.**

1. **PERF-9 — the `₹` latin-ext pull, and the largest remaining byte win.** `subsets: ["latin"]` controls only *preloading*; all six Google subsets still ship as `@font-face` rules, and Blink fetches one the moment a rendered character falls in its `unicode-range`. `₹` (U+20B9) is in `latin-ext` and is the **only** character in the whole application outside latin. It costs 15,240 B on `/`, 39,708 B on `/player` and `/coach`, and **91,276 B across three separate latin-ext files on `/coach/financials/records`** — more, on the money route, than the 58,152 B PERF-8 removed. The files arrive with initiator `css` at roughly 2,224 ms on `/`, so this is bandwidth wasted after FCP rather than paint time, which is why it sits at S3 despite the larger count. The fix is a narrow `@font-face` scoped to U+20B9 with a `local()` source, ahead of the `next/font` rules; nothing else in the app is affected because nothing else is outside latin. Do **not** widen `subsets` — that would preload latin-ext as well and undo PERF-8.
2. **`lib/finance/documents.ts:216` — the statement-PDF N+1.** `loadChargeView` per charge across all of a player's charges, so a 30-charge player costs **~120 queries per statement PDF**. `loadChargeViews` already serves it with no new code. This is the genuinely actionable part of PERF-4: the statement's problem is 120 queries before a byte is drawn, not its memory profile.
3. **Draft persistence for courtside attendance** (ST-2, gap 2). Drafts are React state only. The guard's generic browser dialog is the only protection, and a confirmed leave, an OS tab kill, or mobile Safari discarding the page under memory pressure — routine on iOS — loses every mark silently. `localStorage` keyed by occurrence closes it without a write queue's correctness hazards, because replay still passes the same optimistic-concurrency check. The deadline shipped in `75d3c88` slightly *enlarged* this: a coach can now hold unsaved drafts while sitting on a "may or may not have been recorded" state.
4. **ST-8's two guard traps.** A surface first dirtied inside the 1-second `allowNavigation` window never gets a history boundary and nothing establishes one later, so back-button protection is silently absent for the rest of that surface's life; and `committedRef` never re-arms on a still-mounted form. Both are silent, state-dependent, and invisible to manual testing. The onboarding steps are masked only incidentally, because `OnboardingEditor` remounts on its `key`.
5. **A11Y-9's assertion** — every selected matrix state must produce at least one result. Two of the seven states added in `eaf1dd4` landed in unwired profile/actor pairs; they would have read as covered while never executing. This is a new blocking check, so it warrants a deliberate decision rather than a quiet addition.
6. **A11Y-10's assertion** — no `aria-label`/`aria-labelledby` on an element lacking an explicit `role`, outside an allowlist. Five instances across three passes, every one found by accident, all invisible to the gate because `aria-prohibited-attr` returns *incomplete* when the element has subtree text. Same shape as the `var()` assertion in `5204109`, which has already earned its place twice.

Also ready, smaller: the two Manrope rules requesting weight 820 and 830 above the font's 800 axis maximum, which clamp silently and should say 800 (PERF-9, secondary); the binary public/portal CSS split (PERF-2's surviving half, M effort — PERF-8 has now landed, so its ordering dependency is discharged); A11Y-8's promotion tiers 1 and 2 (`landmark-one-main` and `region` are already at zero and either would independently have caught the `not-found` defect, so promoting them is free; `landmark-unique` and `aria-allowed-role` are ten occurrences across three states); PERF-1's three other residual N+1 sites, beyond the statement path in item 2 above; and DEBT-1's two further gate instances — `scripts/regression/summarize-accessibility.ts` reads whatever results happen to be on disk and sets an exit code from them, and `npm test` and CI disagree by design over `tests/regression-fixture.test.ts`.

**(c) Explicitly deferred, with reasoning.**

| Deferred | Why |
|---|---|
| DEBT-2 — zod across ~76 actions in 14 modules | L effort, large and mechanical. Domain validators and service-layer invariants do provide real protection, so this is a correctness-and-refactoring hazard, not an open security hole. It does not compete with anything in (b). |
| DEBT-3 — unify four-plus result shapes | M effort, and it is a precondition for DEBT-4 rather than valuable on its own. No user-visible change. |
| DEBT-4 — god-file decomposition | L effort. Natural split boundaries exist, but the finance N+1 work rewrote reads inside the largest of these files and merged cleanly against a 74-file upstream feature — weak but real evidence that the current structure is survivable. |
| The ~70-line dead-selector question | **Closed, not deferred.** `5204109` baselined that block in the token test pending a decision; `7fcbba4` then deleted it — 74 lines — with positive proof of death, and removed the two-entry allowlist that existed only to excuse it. Nothing remains. |
| The S4 polish set | ST-5, ST-6, A11Y-7, RESP-2, RESP-3, DS-4, DS-5, DEBT-5, DEBT-7, DEBT-8, DEBT-10, PERF-5, PERF-6, PERF-7 — unchanged and correctly unprioritised. So are DS-7's third visually-hidden implementation (inside frozen calendar surfaces) and the fault-injection harness capability the six `error.tsx` boundaries need. |

### What this exercise says about the audit's own method

Sixteen of this document's claims were corrected on measurement — five in [Corrected claims](#corrected-claims) and eleven recorded inline in the findings — and two findings had their remedies retracted outright. That proportion is a finding about method, not an incidental blemish, and the pattern in it is consistent: **static reading systematically mis-sized things, in both directions.**

A literal-name grep declared three live CSS classes dead, because they are built as `` `status-${…}` ``. A hook grep enumerated React's built-ins and so could not see a custom hook, inflating PERF-3 from four cards to five. A `font-style` grep declared Newsreader italic unused when it is the dominant face on 8 of 12 routes, because `<em>` and `<i>` are italic from the user-agent stylesheet and a rule can render italic without naming the property. A raw-byte figure (265 KB) stood in for a transfer figure (~28 KB brotli wasted), so the percentage stood but the magnitude did not. A proposed contrast token failed the very 3:1 target it was written for. A parse-cost hypothesis was wrong by 14×, and the obvious way to benchmark it would have confirmed it. An existing type-floor mechanism was missed entirely, which made four of the declarations this audit flagged into dead code. A breakpoint count was off by one and named a `340/341` pair that does not exist. In the other direction, ST-4's route count was inflated while its route *list* had three omissions; PERF-8 — the largest available win on the public routes — was absent until a retracted finding's measurement turned it up; and PERF-9, larger still on the routes it touches, was absent until PERF-8's measurement turned *it* up.

Four rules generalise from that:

1. **A grep is not proof** — not of death, not of absence, not of a property. Every claim of the form "X does not occur here" needs the positive form established instead. This one has now cost twice, in `.status-draft` and in Newsreader italic, and the two instances share a root: a static artifact was read to answer a question only the renderer can answer. Establish it from the running application.
2. **Measure on the real path.** `replaceSync()` would have confirmed the CSSOM hypothesis; the browser never takes that path. The same trap in a different costume: CDP throttling overrides are silently discarded by the renderer swap during form login, so every authenticated measurement in this repository is unthrottled by default and will read as a null result.
3. **Compute proposed values rather than eyeballing them,** and composite translucent backgrounds before computing a ratio.
4. **Quote only the numbers that reproduce.** PERF-8's headline `1,472 ms` came from a synthetic arm at a different commit and does not survive re-measurement; the per-byte effect behind it does (2.25 vs 1.96 ms/KB). The fix was justified on the reproducible quantity. A finding whose conclusions rest on paired same-machine comparisons survives its own headline number failing; one that rests on the headline does not.

And one process lesson, recorded in full under DEBT-1: instructing parallel agents not to run `tsc`, to stop them racing on `tsconfig.tsbuildinfo`, hid a genuine compile error behind runtime verification that was itself correct and thorough. Runtime verification does not substitute for the type checker. If concurrent workers must share a tree, give them a scoped way to typecheck rather than removing the check.

---

## 2. What's working well — preserve these

These are load-bearing patterns. Do not regress them during any refactor below.

| # | Strength | Evidence |
|---|---|---|
| W-1 | **Automated a11y gate that actually gates.** 49 matrix states across 3 DB profiles × 3 viewports (+320px on compact states), axe with `wcag2a/2aa/21a/21aa/22aa`, plus custom checks for landmark count, single `h1`, heading skips, duplicate IDs, broken `aria-*` references, document overflow, clipped controls, touch targets, 16px form floor, and reduced-motion violations. CI-blocking. | `tests/e2e/support/accessibility-audit.ts:15`, `accessibility-matrix.ts`, `.github/workflows/ui-accessibility.yml` |
| W-2 | **Semantic hygiene is genuinely clean.** 0 `<div onClick>`, 0 `<span onClick>`, 0 buttons missing `type`, 0 `<img>` tags, 0 `next/image` without `alt` (18 usages), all inline SVG `aria-hidden`. | Verified by grep across `app/` + `components/` |
| W-3 | **Type safety discipline.** 0 `any`, 0 `as any`, 0 `@ts-ignore`/`@ts-expect-error` in production. `strict: true`. Only 2 non-null assertions, both guarded. ESLint: 477 files, 0 errors, 0 warnings. | `tsconfig.json:7`; `npx eslint .` |
| W-4 | **Global focus visibility with no unreplaced resets.** `:focus-visible` ring globally; all 4 `outline: none` sites have compensating `:focus-visible` rules. | `app/globals.css:1199`, `13711` |
| W-5 | **Reduced motion respected everywhere.** Global `*` collapse, per-module `animation: none`, and all 4 `motion/react` components gate on `useReducedMotion()`. CI-enforced at compact viewports. | `components/{dashboard/welcome-hero,coach/coach-welcome-hero,coach/junior-coach-welcome-hero,reports/report-accordion}.tsx` |
| W-6 | **Server-side idempotency on every consequential mutation.** `publicationKey` on report and announcement publish, `idempotencyKey`/`mutationId` throughout finance, `registrationRequestKey` on registration. This is the correct defence against double-submit, and it is better than client-side guards. | `lib/finance/service.ts`, `report-workspace.tsx:328`, `announcement-composer.tsx:65` |
| W-7 | **Exemplary async failure handling in the attendance recorder.** `try`/`catch`/`finally`, drafts preserved on failure, `isSaving` always reset, error surfaced via `InlineNotice`. This is the pattern the rest of the app should copy. | `components/coach/attendance/player-attendance-recorder.tsx:208-227` |
| W-8 | **Rich empty states on ~25 surfaces**, most with a correct next action, and distinct "no data ever" vs "no data for this filter" variants. | Onboarding, published reports, members, fee registers, attendance registers, schedules |
| W-9 | **Static marketing homepage with edge-cached data.** `dynamic = "error"` enforces static; announcements come from a `s-maxage=60, stale-while-revalidate=300` API, failure-isolated from the shell exactly as the design record requires. | `app/(public)/page.tsx:37`, `app/api/public/announcements/route.ts:6` |
| W-10 | **Progressive reveal is real, not cosmetic.** Members and reports genuinely `.slice()` the array (12 and 10 at a time); the annual attendance register windows to ~16 date columns instead of rendering 365. Worst-case DOM avoided by construction. | `member-window.ts:1`, `published-reports-list.tsx:32`, `use-attendance-register-window.ts:27` |
| W-11 | **CSV exports stream; server-only boundaries hold.** `ReadableStream` with 100-row source pagination. `pdfkit`, `better-sqlite3`, `libsql`, `drizzle-orm` verified never reachable from a client component; `"server-only"` marker present. | `lib/finance/collections-csv.ts:71`, `lib/db/client.ts:1`, `next.config.ts:7` |
| W-12 | **Role-boundary denial explains itself** for junior coaches — redirect carries `?notice=head-coach-only` and renders a real explanation, not a 404. | `lib/auth/current-coach.ts:52`, `components/coach/coach-access-notice.tsx` |
| W-13 | **Deduplication already done where it counts.** The junior-coach calendar *imports* the player calendar's grid builder rather than copying it; 8 dashboard cards genuinely consume the `CoachDashboardCard` primitive. | `junior-coach-attendance-calendar.ts:1`, `components/coach/dashboard-card.tsx` |
| W-14 | **A written design decision record.** 132 explicit, dated decisions including deliberate freezes. This is why this audit could distinguish "defect" from "intentional". | `.21st/design.json` |
| W-15 | **A token-enforcement test already exists** — proof the team accepts this class of guardrail. Extend it rather than inventing a new mechanism. | `tests/design-tokens.test.ts:27` |
| W-16 | **Admin preview is write-guarded at the proxy layer.** | `proxy.ts:6-14` |

---

## 3. Findings

**Classification** — `OBJ` = objective defect (verifiable against a standard, contract, or the product's own design record). `SUBJ` = optional subjective suggestion.
**Severity** — S1 critical · S2 high · S3 medium · S4 low.
**Effort** — XS <1h · S 1–4h · M 1–2d · L 3–5d.
**Confidence** — High = traced in source by me · Med = strong static evidence, runtime unverified.

### 3.1 Resilience & UX states

#### ST-1 · OBJ · S2 · Effort S · Confidence High
**Six async handlers can strand the UI in a busy state on network failure.**

`app/coach/onboarding` (5 handlers) and the admin authenticator-recovery queue `await` a server action and then call `setBusy(null)` on the *next line*, with no `try`/`catch`/`finally`. If the fetch rejects — offline, tab throttled, server 500 — the reset never runs, the promise rejects unhandled, and the control stays disabled with no error message.

```222:230:components/coach/onboarding/player-onboarding-register.tsx
  async function approve() {
    if (busy) return
    setBusy("approve")
    setFeedback(null)
    const result = await approveRegistrationAction(item.id, item.requestedRole)
    setBusy(null)
    if (!result.ok) {
      setFeedback({ message: result.message, tone: "error" })
      return
    }
```

Same shape at `player-onboarding-register.tsx` lines ~242 (`reject`), ~331 (assessment), ~509 (session), ~692 (fee plan), and:

```36:45:components/admin/admin-authenticator-recovery-queue.tsx
    startTransition(async () => {
      const result = decision === "approve"
        ? await approveAuthenticatorResetRequestAction(requestId)
        : await rejectAuthenticatorResetRequestAction(requestId)
      setBusyId(null)
      setMessage(result.message)
    })
```

**Why it matters.** Onboarding is where a head coach approves real players and sets real fee plans. A stuck Approve button with no explanation reads as "the system lost my action" — the coach's only recovery is a page reload, and they cannot tell whether the approval landed. The correct pattern already exists in this codebase (W-7).
**User impact.** Head coach and platform admin; blocks the primary onboarding workflow on any transient failure.

**Resolved (`8d60c85`).** All six handlers now reset in `finally` and surface the failure through their existing feedback channel. One detail was not in the finding and shaped the fix: in the two request handlers the `catch` wraps **only** the awaited server-action call, not the subsequent `onSuccess`. Wrapping both would have reported a throw from `onSuccess` as "could not be saved" against an approval that had in fact succeeded — trading a stuck button for a false failure message on a money path. That same constraint then dictated how ST-7 could be fixed.

#### ST-2 · OBJ · S2 · Effort M · Confidence High
**No offline strategy on a courtside-mobile product.**

Zero `navigator.onLine`, zero `online`/`offline` listeners, no service worker, no manifest, no retry affordance. Traced path for a coach saving attendance with no connectivity: `saveAttendance()` → `saveAttendanceRegister` → server action fetch rejects → `catch` → `InlineNotice` shows `error.message`, which for a failed fetch is the browser string **"Failed to fetch"**.

The mechanics are correct (drafts preserved, `isSaving` reset). The *message* is not: it is untranslated browser jargon at the exact moment a coach is standing on a court with 20 players.

**Why it matters.** This is the product's most repeated real-world task in its least reliable environment.
**User impact.** All coaches, daily, on mobile.
**Note.** Full offline queueing is out of scope for a first pass; mapping network failure to operational copy plus an explicit Retry is the 80% fix.

**Partially resolved (`f543d10`, `75d3c88`).** Network failures in both attendance savers now produce operational copy naming the cause, stating the marks are still on screen, and saying what to do — and the existing Save control relabels to "Save attendance again" as the retry, since no secondary-button class exists in the stylesheet. Classification keys on the error's **constructor** (`TypeError`, plus a `name` check for realm-crossed errors) rather than its message, because the message differs per engine: "Failed to fetch" in Chrome, "NetworkError when attempting to fetch resource." in Firefox, "Load failed" in Safari. `navigator.onLine` only selects between two messages; it never decides whether a failure was network-related, since `onLine === true` means an interface exists, not that the server is reachable.

**Gap 1 — resolved (`75d3c88`).** The indefinite hang is bounded by a 20s/15s deadline. Two findings came out of implementing it:

- **Abort cannot propagate through a Next.js server action.** `callServer(actionId, actionArgs)` accepts exactly two parameters with no options object, and `server-action-reducer.js:72-78` builds its own `fetch` with no `signal` — zero matches for `signal`/`AbortController`/`AbortSignal` in that file. The plumbing beneath it *would* forward an `init`, but the only caller is Next-internal and never populates it. So the deadline is a UI-level escape, not a cancellation: the request keeps running, and the copy says the outcome is unknown rather than failed.
- **Retry after a timeout is provably safe**, which is why the copy can say so. Both attendance services skip a change when the stored choice already equals the target (`lib/sessions/service.ts:652`, before the conflict check is even reached), write via `onConflictDoUpdate` keyed on `(accountId, occurrenceId)` rather than appending, and run in `{ behavior: "immediate" }` transactions that serialise a retry against the in-flight original. So a landed-but-timed-out write makes the retry a no-op reporting success. This also means a *premature* deadline destroys nothing, which is what makes a generous duration low-risk.

**Latent trap discovered in Next.js config (not our code).** `server-action-reducer.js:81-98` contains an offline auto-replay path — on a fetch rejection it waits for connectivity and replays the action — gated on `process.env.__NEXT_USE_OFFLINE`. It is currently disabled (`next.config.ts` has no `experimental` block), which is the only reason the `TypeError` reaches our `catch` at all. **If anyone enables that flag, Next will swallow the rejection and hang, and the offline messaging shipped in `f543d10` will silently stop appearing.** Worth a comment near the classification helper.

**Gap 2 — open, and now the highest-value remaining item; the deadline slightly enlarged it.** A coach can now sit on a "may or may not have been recorded" state while holding unsaved drafts with no durable copy — so the ambiguity and the volatility compound. Combined with ST-8 (where unsaved-work protection can be silently absent), this is the product's worst realistic failure path.

**Drafts are React state only, so a tab close loses everything.** `unsaved-work-guard.tsx:189` fires the browser's generic "leave site?" dialog, but if the coach confirms it, the OS kills the tab, or mobile Safari discards the page under memory pressure (routine on iOS), every mark is gone silently. Note the new copy promises the marks are safe *on screen*, which is true and deliberately scoped — but a coach may read more into it. Persisting drafts to `localStorage` keyed by occurrence would close this without the correctness hazards of a write queue, because the replay still passes through the same optimistic-concurrency check on the next save.

**Gap 3 — open. Nothing auto-recovers.** There is no `online` listener, so the coach must notice connectivity returning and press the button themselves. A captive portal also reports `onLine === true`, producing the vaguer "the request did not complete" message rather than naming the real problem.

#### ST-3 · OBJ · S3 · Effort XS · Confidence High
**No `app/global-error.tsx`.** Confirmed absent. Root-layout render failures (font loading, metadata) bypass all five nested `error.tsx` boundaries and fall through to Next.js's unbranded default. Every other boundary is well-branded via `RouteErrorState`, so this is a one-file gap in an otherwise complete set.

**Resolved (`5f5312e`).** It reuses the branded route recovery panel. Router context and the imported stylesheet both survive the boundary, but the `next/font` variables do not, so they are re-declared as system stacks rather than re-invoking `next/font` inside the boundary that may exist precisely to catch a font failure. **What it does not do:** the component destructures only `reset` and never reads the `error` Next.js passes it, and the repository has no error-reporting sink of any kind — so all six boundaries now render branded recovery UI and report to nobody. Where they should report is an open decision, not an oversight in this change.

#### ST-4 · OBJ · S3 · Effort S · Confidence High
**15 routes perform async data loads with no loading boundary and no `Suspense`.** `Suspense` appears zero times in application code. Navigation to these blocks with no visual feedback. `(student)/*` and `coach/*` are correctly covered.

Verified breakdown (revised 2026-08-23 during PR-4 — every candidate page was read rather than inferred):

| Group | Routes | Treatment |
|---|---|---|
| Named trees | `/admin`, `/account/security`, `/account/recovery-email/setup`, `/auth/two-factor`, `/auth/two-factor/setup`, `/auth/two-factor/reconnect`, `/auth/two-factor/recovery`, `/auth/pin/setup`, `/setup/head-coach` | **Covered by PR-4** with 4 `loading.tsx` files via segment inheritance |
| Root-level auth | `/login`, `/register`, `/recover`, `/recover/reset`, `/activate` | **Deliberately excluded.** Redirect-if-signed-in is the *common* outcome here, so a boundary would flash loading UI on the product's primary entry point. For the anonymous visitor who actually renders them, the session check is a cheap cookie miss. |
| Public detail | `/(public)/announcements/[announcementId]` | Async (`getActiveHomepageAnnouncement`) and **missing from the original finding**. Needed `app/(public)/announcements/loading.tsx` specifically — a `(public)` boundary would wrap the static marketing homepage. Added in `49ad19c`, at the `announcements` segment for exactly that reason. |

**Corrections to this finding.** The original "18 routes" was inflated: `/progress` and `/reports` are one-line synchronous `redirect()` stubs with no `await`, and must never receive a loading boundary. The original list also omitted `/auth/two-factor` and `/auth/two-factor/recovery` (both async) and the public announcement detail page. PR-4's estimate of "7 new `loading.tsx`" became **4**, because a boundary is inherited by all nested segments.

**Known trade-off accepted by PR-4.** A `loading.tsx` makes its segment stream, so Next can flush the fallback before a page's `redirect()` resolves — turning a clean 307 into a visible flash then a client-side redirect. For the nine covered routes the redirect is always the exception path (wrong role, unauthenticated, step already complete), so this trades a flash on the rare path for removing a blank block on the common one.

**Resolved (`5f5312e`, `49ad19c`).** Four `loading.tsx` files cover the nine named-tree routes by segment inheritance, plus one at the `announcements` segment. The five root-level auth routes remain deliberately uncovered, per the table above.

#### ST-5 · SUBJ · S4 · Effort XS · Confidence High
**Player hitting `/coach` is silently redirected with no explanation**, while a junior coach in the same situation gets `CoachAccessNotice` (W-12). Inconsistent treatment of the same class of event.

#### ST-6 · SUBJ · S4 · Effort XS · Confidence High
**Two roster empty states are bare `<p>` text** without the structured empty-state treatment used elsewhere: `session-calendar.tsx:472`, `session-schedules.tsx:622`.

#### ST-7 · OBJ · S3 · Effort S · Confidence High
**A successful save can produce no confirmation and no progression, because a guard's failure signal is discarded.** *Found during PR-1 implementation, 2026-08-23.*

```146:148:components/unsaved-work-guard.tsx
    commitSurfaceAndNavigate(id, navigate) {
      dirtySurfaces.current.delete(id)
      if (dirtySurfaces.current.size) return false
```

When any *other* registered surface is still dirty, the supplied `navigate` callback is never invoked and the method returns `false`. All four `navigateAfterCommit` call sites ignore that return value:

- `components/coach/onboarding/player-onboarding-register.tsx:381` (assessment), `:550` (session assignment), `:745` (fee plan)
- `components/coach/announcements/announcement-composer.tsx:272`

In those three onboarding handlers, `navigate` is the wrapper around `onSuccess(...)`. So on this path the server write **succeeds**, the busy flag clears normally, and the coach sees: no success notice, no advance to the next onboarding step, and no removal from the queue. It reads as "nothing happened."

The follow-on risk is worse than the missing message. A coach who retries the assessment hits `saveMemberAction`'s `expectedRevision` optimistic-concurrency check, which will now fail — producing a confusing conflict error *after* an operation that actually succeeded. The finance action is idempotency-keyed and so is safer on retry.

**Likelihood.** Lower than it first appears in the onboarding register, because the design contract opens exactly one row at a time, so usually only one surface is dirty. But `useUnsavedWorkGuard` has **13 consumers**, the guard is shared, and the real defect is structural: a method whose contract includes "I did not run your callback" has four callers that never check.
**Why it matters.** Silent no-ops on a system of record are the failure mode users trust least, and this one is invisible to tests — `tests/coach-onboarding-register-ui.test.tsx:28` mocks the guard as `navigateAfterCommit: (navigate) => navigate()`, i.e. unconditionally synchronous, so the skip branch is never exercised.
**Fix shape.** Either have the three call sites handle a `false` return by surfacing feedback themselves, or change the guard to always run the callback and let navigation be the only conditional part. Needs its own PR — 13 consumers.

**Resolved (`0254bbd`).** Fixed in the guard rather than at the call sites, so all four are corrected without being touched. The deciding evidence came from the same file: `RequestStep` already calls the identical `onSuccess` — `router.replace` and `router.refresh` included — with no guard involvement at all, which proves no caller can depend on boundary-release ordering. One subtlety worth preserving: the callback is scheduled through a microtask rather than invoked synchronously, because a synchronous call would execute *inside* the `try`/`catch` added by the ST-1 fix, and a throw from `onSuccess` would then be reported as "could not be saved" against a save that succeeded — trading one misleading-success bug for another. A regression test drives the real provider with two dirty surfaces; 2 of its 3 cases fail before the fix.

#### ST-8 · OBJ · S3 · Effort M · Confidence Med
**Two further latent traps in the unsaved-work guard.** *Found while fixing ST-7, 2026-08-23. Not fixed — reported.*

1. **Back-button protection can be permanently absent for a surface.** `ensureHistoryBoundary` returns early while `allowNavigation.current` is true (the 1-second window after a confirmed navigation), and `setSurface` only calls it when the dirty map *was* empty. A surface first dirtied inside that window therefore never gets a history boundary, and nothing establishes one later — so unsaved-work protection is silently missing for the rest of that surface's life.
2. **`committedRef` never re-arms on a still-mounted form.** `navigateAfterCommit` sets it true, and the clearing effect only fires when `isDirty` transitions to false. A long-lived form edited again after a commit, without passing through a clean state, stays suppressed and unguarded. The onboarding steps are masked from this only incidentally, because `OnboardingEditor` remounts on its `key`.

Also minor: `ignoreNextPopState` is a boolean rather than a counter, so it assumes at most one in-flight `history.back()`. Safe today because the release path clears the pending timer, but any new code path calling `history.back()` would consume the wrong `popstate`.

**Why it matters.** Both failures are silent and state-dependent — the guard appears to work in every manual test, and only stops protecting under a specific interaction order. That is the hardest class of bug to catch by hand and the easiest to regress.

### 3.2 Accessibility

#### A11Y-1 · OBJ · S3 · Effort XS · Confidence High
**Placeholder text fails WCAG AA contrast.** `#8a939b` at `app/globals.css:1545` and `:5410` gives **3.12:1** on `#ffffff` and **2.99:1** on `--paper` `#fbfaf7`, against a 4.5:1 requirement. Mitigated — not eliminated — by the fact that every field has a visible `<label>`, so no information is placeholder-only.

**Resolved (`a13888f`).** Replaced with `--text-placeholder` `#6b7480` — **4.74:1** on white and 4.54:1 on `--paper`, computed against the composited background rather than an assumed one.

#### A11Y-2 · OBJ · S3 · Effort XS · Confidence High
**Disabled month-navigation controls are effectively invisible.** `app/globals.css:8905` sets `color: var(--line)` = `#d7dbde` on white → **1.39:1**, against the 3:1 non-text/UI minimum. A coach cannot tell a disabled month arrow from a rendering artifact.

**Resolved (`a13888f`).** Replaced with `--line-disabled` `#858d94` — **3.37:1** on white, 3.23:1 on the composited `rgba(255,255,255,.48)`-over-ivory month control. The originally proposed value failed its own target; see [Corrected claims](#corrected-claims).

#### A11Y-3 · OBJ · S3 · Effort S · Confidence High
**Five forms omit the error-association pattern the login form implements correctly.** Missing `aria-invalid`, `aria-describedby` → error node, and/or first-invalid focus: `pin-setup-form.tsx` (error is a standalone `role="alert"`, not linked), `head-coach-setup-form.tsx:52`, `recovery-form.tsx:36`, `recovery-reset-forms.tsx:35` (2FA step), `two-factor-verification-form.tsx` (no post-error focus). The reference implementation is `components/login-form.tsx:36-41` and it is CI-tested — these five simply were not brought up to it.

**Resolved (`c087412`), together with DEBT-6 and by way of it.** The five forms were fixed by extracting the `AuthField` primitive they had drifted for want of, so the cause was addressed rather than the five symptoms. `AuthField` takes the control as a render prop, letting `input`, `PasswordInput` and `select` share identical wiring; it exposes two error props, one rendered in-field and one naming an alert the form renders elsewhere, which is what allowed every form to be corrected without moving a single existing error paragraph — necessary because `.login-form` is a 24px grid on a surface the design record freezes. Rendered DOM shape and class list unchanged, verified by static render.

#### A11Y-4 · OBJ · S3 · Effort XS · Confidence High
**`/admin` has no skip link.** `components/app-shell.tsx:17`, `coach-shell.tsx:17`, `app/(public)/page.tsx:438` and the public announcement page all have one; `app/admin/page.tsx:90` renders `<main className="admin-page page-shell">` directly with none.

**Resolved (`5640ee0`).** One further page turned out to have no landmark at all rather than no skip link — `app/not-found.tsx`, found later by the extended matrix (A11Y-6). It was given a `<main>` and deliberately *not* a skip link, since a 404 has no header or nav to bypass.

#### A11Y-5 · OBJ · S3 · Effort XS · Confidence High
**A horizontal scroll container is not keyboard operable.** `.tableWrap` sets `overflow-x: auto` over a `min-width: 980px` table but has no `tabIndex` and no `aria-label` — unlike the attendance register, which does both (`player-attendance-register.tsx:267-268`). A keyboard user cannot scroll the region to reach clipped columns.

**Evidence corrected (2026-08-23, by runtime measurement).** The original finding named `financial-records-workspace.tsx:314` (the registration/monthly fee register) and claimed it scrolls from 721px up. It does not: `.registrationTableWrap` is reset to `overflow: visible` with a stacked block table inside `@media (max-width: 980px)`, and at 1000px the table fits exactly (`clientWidth 950` = `scrollWidth 980`→`950`). The container that genuinely traps content is the **collections day book** at `financial-records-workspace.tsx:566`, which keeps `overflow-x: auto` over a 980px table down to 720px. Measured at 800px: `scrollWidth 980` vs `clientWidth 750`, no `tabindex`, no `aria-label`, **79 Tab stops never reach it**, and `End`/`ArrowRight` while hovered leaves `scrollLeft` at 0.

The defect and the fix are unchanged — PR-3 added `tabIndex`, `role="region"` and labels to both containers. Only the reproduction viewport and the primary affected surface were wrong.

**Extended during PR-3.** The attendance register's own container — the pattern this finding pointed at as correct — carried `aria-label` on a role-less `<div>`, where ARIA prohibits naming and the accessible name may be discarded by some browser/AT pairings. All three containers now carry `role="region"`, which is already this repo's dominant convention for named non-semantic containers (`attendance-adjustments-workspace.tsx:523`, `player-onboarding-register.tsx:833`, `report-accordion.tsx:119` and `:182`); `role="group"` is reserved here for radio-like button clusters.

**Residual, recorded as not yet fixed:** `player-attendance-register.tsx:188` — `<div className="coach-year-selector" aria-label="Choose attendance year">` is the same shape, a named role-less div, while its three siblings at `:204`, `:217` and `:243` all carry `role="group"`. It looks like a straightforward oversight in the same family. One-word follow-up.

**Residual resolved (`49ad19c`), and the finding closed with it.** The year selector took `role="group"` rather than `role="region"` — group because it is a mutually-exclusive toggle cluster with nothing scrollable, so it does not earn a landmark, which is the same distinction the three scroll containers were decided on in the opposite direction. This was the fifth instance of the same shape, and finding it by accident for the fifth time is what produced A11Y-10.

#### A11Y-6 · OBJ · S3 · Effort S · Confidence High
**Seven routes and two dialog states sit outside the otherwise-excellent axe matrix**: `/coach/announcements/[id]`, `/coach/reports/publications/[publicationId]`, `/announcements/[announcementId]`, `/coach/financials` (inactive/activation), `app/not-found.tsx`, and both financials `error.tsx` pages; plus the announcement **Review** and **Withdraw** dialogs, which are never opened during the run. Given W-1, these are the only places a11y regressions can enter unnoticed.

**Partially resolved (`eaf1dd4`, `7fac52d`).** Seven states and three interactions added, verified live across all three profiles — 316 audits (stress 177, admin 87, clean 52). Both dialog states are covered, and the `data-accessibility-dialog-opener` hook — previously set inline by the single dialog interaction that had it — is now a shared `openDialogFrom(trigger)` helper, so every future dialog state inherits the focus-trap, Escape and focus-return checks automatically.

The six `error.tsx` boundaries remain unreachable: an `error.tsx` renders only when its segment throws during render, and the harness has no fault injection. A concrete route exists — `readFinanceActivation` throws when the `finance_activated` audit metadata lacks `trackingMonth`, so corrupting that one row would render the boundary — and the spec already mutates fixture databases directly for recovery-challenge setup, so the precedent is there. It is a new harness capability and belongs in its own change.

**The new coverage immediately found two real defects, which is the entire point:**
- `app/not-found.tsx` renders a bare `<section>` with **no `main` landmark** — `main-landmark-count`, serious, all three viewports. Every other route group supplies its own; the 404 was the only page with none.
- The finance-activation consent checkbox `input[name="confirmPermanentLedger"]` is an **18px tap target** at tablet width against a 24px minimum. It passes at 390px only because the consent sentence wraps and props the grid row open — accidental compliance rather than a sized control.

#### A11Y-7 · SUBJ · S4 · Effort S · Confidence High
**Dropdown menus have no focus trap or background `inert`.** `account-menu.tsx:63`, `public-header.tsx`. Escape closes and focus returns correctly; Tab can walk out into the page behind the open menu. Not a WCAG failure — a polish gap relative to the three `<dialog>` implementations, which are exemplary.

#### A11Y-8 · OBJ · S3 · Effort S · Confidence High
**The accessibility gate silently discards every axe "incomplete" result.** *Found during PR-3 implementation, 2026-08-23.*

The harness collects findings from `axe.violations` only:

```590:591:tests/e2e/support/accessibility-audit.ts
  const axe = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze()
  const findings = axe.violations.flatMap((violation) => violation.nodes.map((node) => finding({
```

`axe.incomplete` is never inspected. Axe returns *incomplete* when a check cannot decide automatically and a human must review — it is not a pass. Concrete case discovered here: `aria-prohibited-attr` (enabled, `wcag2a`, in this project's `WCAG_TAGS`) returns `undefined` → incomplete, rather than a violation, whenever the offending element has subtree text. Verified against the installed axe-core 4.13.0 evaluate function:

```js
var textContent = subtree_text_default(virtualNode, { subtreeDescendant: true });
if (sanitize_default(textContent) !== '') { return void 0; }  // incomplete
return true;                                                   // violation
```

So the labelled-but-role-less scroll containers in this codebase (`.coach-register-scroll`, and the fee-register `.tableWrap` wrappers) produce incomplete results that the gate throws away. The `aria-label` on an implicit `generic` role is ARIA-prohibited and may be dropped entirely by some browser/AT pairings — a real defect that the gate is structurally unable to report.

**Why it matters.** Given how strong this gate otherwise is (W-1), the blind spot is disproportionately costly: the team reasonably treats a green run as "no accessibility problems", when in fact an entire result class is invisible. Contrast checks on gradients/images, and several ARIA name checks, commonly land in `incomplete`.
**Suggested fix.** Surface `axe.incomplete` as a distinct non-blocking "needs review" section in the report first, so the existing backlog is visible before deciding what to promote to blocking.

**Backlog now measured (2026-08-23) — 1,243 advisories across 316 audits, and it is one rule plus a tail:**

| Rule | Bucket | Occurrences | States |
|---|---|---:|---:|
| `color-contrast` | needs-review | 1,122 | 25 |
| `aria-prohibited-attr` | needs-review | 105 → 101 | 13 |
| `aria-allowed-role` | best-practice | 7 | 2 |
| `landmark-unique` | best-practice | 3 | 1 |
| `landmark-one-main` | best-practice | 3 → **0** | 1 |
| `region` | best-practice | 3 → **0** | 1 |

`color-contrast` alone is **90.3%** of the backlog and two rules are 98.7%. Per profile: stress 1,068 over 177 audits, admin 175 over 87, **clean 0 over 52** — so the backlog concentrates on data-dense and auth surfaces, not empty-state paths.

**Promotion recommendation, in three tiers rather than 1,243 obligations:**

1. **Promote now, free.** `landmark-one-main` and `region` are both at zero after the `not-found` fix, and either would independently have caught that defect. Promoting an already-green rule costs nothing and locks the fix in.
2. **Fix then promote, small.** `landmark-unique` (3 occurrences, one state) and `aria-allowed-role` (7, two states) — ten occurrences across three states, narrow enough that promotion won't generate churn.
3. **Sequence, do not promote yet.** `aria-prohibited-attr` is the only advisory rule with **demonstrated true positives** — all five instances in A11Y-10 were real. It deserves to be blocking, but promoting it today turns the gate red on 13 states. Remediate, then promote.

**Do not promote `color-contrast`.** These are *incomplete* results, not violations: axe returns incomplete when it cannot resolve the effective background, which happens with gradients, background images and transparency — all of which this UI uses heavily. The count scales with element volume rather than defect count, which is exactly why one profile contributes 1,068 and another contributes zero. Promoting it would make the gate permanently red on 1,122 cases where axe declined to decide. Contrast assurance belongs in a direct token-level test, plus a hand-checked sample to establish whether any real failure is hiding in the pile.

**Operational caveat for the next run:** the `clean` fixture database is effectively single-use, because its flow requires the head coach to be at first-time authenticator setup. Both `clean` and `stress` are now partially consumed and must be restored from source before a full three-profile run.

**Second, related blind spot (same root cause).** `withTags([...WCAG_TAGS])` also excludes every rule axe tags `best-practice`, which is where all the landmark and structural rules live. Verified in axe-core 4.13.0: `region` (`axe.js:33358`), `landmark-unique` (`:33128`), `landmark-one-main` (`:33114`), `landmark-no-duplicate-main` (`:33101`) and `aria-allowed-role` (`:32200`) are all `best-practice`-tagged and therefore never evaluated. So landmark structure — a primary screen-reader navigation mechanism — is currently unchecked. The custom `collectDomAudit` partially compensates by asserting exactly one `<main>` and one `<h1>`, but nothing verifies landmark naming, uniqueness, or that content sits within a landmark at all.

Together with the discarded `incomplete` results, this means a green run is narrower evidence than it appears: it certifies "no WCAG-tagged violations axe could decide automatically", not "no accessibility problems". Both are cheap to surface as non-blocking sections.

**Partially resolved (`6abea0c`).** Both blind spots now surface as labelled non-blocking advisories in the job summary — `axe.incomplete` and the `best-practice` rule family — with the blocking path factored out and unchanged. What remains is the promotion decision above, not the visibility problem.

#### A11Y-9 · OBJ · S3 · Effort S · Confidence High
**The accessibility matrix silently drops states it cannot route.** *Found while extending coverage, 2026-08-23. Not fixed.*

`accessibility-regression.spec.ts` wires up specific profile-and-actor pairs. A matrix state whose pair is not wired up is **not an error** — it never executes, never appears in results, and reports nothing. Two of the seven states added in this pass fell into exactly that gap: the `stress` branch never opened a guest context, and the `clean` branch only scanned guest states, never head-coach ones. Both would have been dead entries that looked live.

**Why it matters.** This is A11Y-8's failure class one level up: the gate's *coverage* is as invisible as its discarded results. Someone adding a state with a mistyped profile gets a green run and believes the surface is protected. Taken together, a green result today means "no WCAG-tagged violations, among the states that happened to be routable, excluding everything axe could not decide automatically."

**Fix shape.** Assert every selected state produced at least one result. That is a new blocking check, so it warrants a deliberate decision rather than a quiet addition.

#### A11Y-10 · OBJ · S4 · Effort S · Confidence High
**`aria-label` on role-less containers is a recurring pattern, not isolated incidents.** Five instances across three separate passes: both fee-register scroll wrappers, the attendance register scroll container, the attendance year selector, and the announcement Review dialog's `channelPills`. Every one was found by accident, and all are invisible to the gate because `aria-prohibited-attr` returns *incomplete* rather than a violation when the element has subtree text (A11Y-8).

Fixing them one at a time is not converging. An assertion — no `aria-label`/`aria-labelledby` on an element lacking an explicit `role`, outside an allowlist of elements whose implicit role permits naming — would catch the whole family for the cost of one file. Same shape as the `var()`-undeclared assertion added in `5204109`, which has already proved its worth.

### 3.3 Responsiveness

#### RESP-1 · OBJ · S2 · Effort S · Confidence High
**The product violates its own 10–11px operational type floor with text as small as 5px.**

`.21st/design.json` mandates "a readable operational type floor of approximately 10px for labels and supporting facts and 12px for row values", and sanctions 9px only for specific uppercase roll-call controls. Verified counts across all CSS: **1× 5px, 2× 6px, 8× 7px, 34× 8px, 98× 9px**.

```11381:11385:app/globals.css
  .personal-attendance-calendar .player-attendance-calendar-today {
    right: 4px;
    bottom: 4px;
    font-size: 5px;
  }
```

Also unsanctioned: 7px completion badge (`globals.css:11378`), 7px calendar notes (`:11395`), 7px weekday headers (`:11328`), 7px `.player-ticket-context` at ≤340px (`:11424`), 7px card `.status` at ≤340px (`dashboard-card.module.css:438`).

**Why it matters.** A 5px label is not small text, it is *absent* text — and it is the "today" marker on a player's attendance calendar at mobile width, which is precisely the orienting cue the calendar depends on.
**User impact.** All players and junior coaches on mobile; worst at 320–360px.

**Accepted trade-off (2026-08-23, confirmed by product).** Raising the coach dashboard status stamp from 7px to 10px makes it wider, which at **320px only** causes the *Monthly reports* card title to wrap to two lines when paired with the longest stamp (`76 OUTSTANDING`). Verified by measurement: nothing clips or overlaps, it is confined to that single longest title-plus-stamp combination (`ATTENDANCE` + `12 SCHEDULES` still fits on one line), and it resolves by 340px. Accepted as a fair exchange for eliminating illegible 7px text, at the extreme edge of the supported width range. Do not file this as a layout regression.

**Resolved (`a13888f`, `4722fe3`, `52c0fc9`) — closed for sub-8px, 8px reduced to three documented exceptions.** `--type-operational-floor: 10px` now exists and **zero declarations below 8px remain anywhere in the repo**. Of the original 34 8px declarations, 23 were raised — 11 in globals, 12 in the CSS modules — and **exactly three remain**, each with a stated reason rather than an assumption:

| Site | Why it stays at 8px |
|---|---|
| `financials.module.css:2764` | Declined on measurement. The allocation-row caption is `nowrap` + `ellipsis`; at 8px `SMBA-ABCD2345 · Available ₹12,500` needs 133.6px in a 135px track and fits. At 10px it needs 167px and the ellipsis lands mid-word around "Availa…", removing the amount. The design record's prohibition on hiding ledger facts outranks the type floor here, and the adjacent 104px amount-input track is fixed, so widening is unavailable. |
| `globals.css:8016` | `.coach-month-grid button small` — "sessions" needs 43.3px in a 25.7px cell at 320px, so it already overflows at 8px. On a surface `mobile-calendar-attendance-freeze` covers. |
| `globals.css:12898` | Design-sanctioned roll-call mobile 8px, and demonstrably still live — see RESP-4, which also shows it is currently applied to only one of the control's two halves. |

Two side findings from the final pass. `financials.module.css:3721` (`.summary dt`) is **unreachable**: the only `styles.summary` consumer is `dashboard-card.tsx`, which imports a different CSS module, and CSS Modules hash class names — so the rule cannot match. It was raised for sheet consistency but is a zero-render change and is a candidate for deletion. And `.balancePlayerRail > button` ("Change player") now wraps to two lines at 320px; nothing clips, and no defensible padding trim buys a single line — even at 5px padding the box is still 0.9px short.

**Reconciling the 8px arithmetic, because the intermediate figures do not add up to 34.** 23 raised + 3 remaining + 4 dead is 30, not 34. The gap is not four unfixed declarations: a fresh count across all CSS today returns **exactly 3**, matching the table above, so nothing at 8px is unaccounted for in the current tree. The gap is in the bookkeeping — the three passes counted overlapping scopes at three different commits, and `7fcbba4`'s deletion of 693 lines of dead CSS removed rules that were never re-counted against the original 34. Trust the endpoints, which are directly verifiable (34 at `3cbd766`, 3 today); the middle terms are approximate.

**The 9px tier is untouched, but the count moved from 98 to 99, and that is this finding's own doing.** The step-rail label below was raised 7px → 9px, which is exactly one addition to the sanctioned tier. Both numbers are correct: 98 at the baseline, 99 today. No pre-existing 9px declaration was changed.

Measurement note: both passes computed real Manrope glyph advances from the font files Next.js cached in `.next/static/media`, applying HVAR weight deltas manually — `fontkit`'s `getVariation()` loses its cmap in this build and silently returns ExtraLight metrics, roughly 9% narrow. The second pass calibrated against the first by reproducing its published 43.3px figure for "sessions" exactly.

Three corrections to this finding, all found by measurement during implementation:

1. **8px is not unsanctioned everywhere.** I asserted it had no explicit sanction. It does: `.21st/design.json`'s `coach-staff-roll-call-daily-ledger` decision specifies "the same 9px desktop/tablet and **8px mobile** uppercase typography". The finding's premise was too strong.
2. **A type floor mechanism already existed and I missed it.** `app/globals.css:13799-13855` contains an "Internal operations typography floor" block that overrides several selectors to `var(--type-utility-label)` (11px). Four of the 8px declarations are therefore **dead code** — they render at 11px today, and editing them would be a no-op. The vestigial 8px lines are the remains of the roll-call sanction above, already superseded in the stylesheet.
3. **One site was declined on evidence, not preference.** `app/globals.css:8016` (`.coach-month-grid button small`, the "N sessions" caption in the coach Session Calendar month grid) offers 25.7px of content width at 320px, while the word "sessions" alone needs 43.3px at 10px — it already overflows at its current 8px. It also sits on the surface `mobile-calendar-attendance-freeze` explicitly freezes. Raising it would deepen a pre-existing overflow on frozen work.

One knock-on: the step-rail label at `player-onboarding-register.module.css` could not reach 10px either — the longest label `ASSESSMENT` needs 70.5px in a 64.5px track at 320px, and the grid uses `minmax(0, 1fr)` so the track cannot grow. It was raised 7px → **9px**, the largest size that fits and the size this design system already sanctions for small uppercase labels.

#### RESP-2 · SUBJ · S4 · Effort S · Confidence High
**Several coach controls sit at 42px against the design record's 44px contract**: `.coach-year-selector button` (`globals.css:3635`), `.coach-occurrence-actions > button` (`:7377`), `.coach-series-end-action` (`:7701`), `.coach-assignment-days label > span` (`:7813`). These **pass** WCAG 2.2 SC 2.5.8 (24px minimum), so this is a consistency issue against the team's own stricter bar, not an accessibility failure.

#### RESP-3 · SUBJ · S4 · Effort XS · Confidence Med
**The onboarding register uses off-grid breakpoints** (`max-width: 1000px` / `700px`) instead of the app's 980/760/720 system, leaving 701–720px on a cramped five-column desktop row.

#### RESP-4 · OBJ · S3 · Effort XS · Confidence High
**The two halves of the staff roll-call Present/Absent control render at different font sizes.** *Found while completing RESP-1, 2026-08-23. Not fixed — needs the design decision below.*

`app/globals.css:12898` styles the roll-call choice controls at 8px via a two-selector rule. The "Internal operations typography floor" block later in the file (`:13799-13855`) repeats those selectors at 11px and would normally win by source order — and for the first selector it does. But the second selector ends `> .staff-roll-call-choice-box button + button`, whose extra type selector gives it specificity **(0,4,3)** against the floor block's **(0,4,2)**. So it wins.

The consequence: inside a single joined control, **the first button renders at 11px and the second at 8px** on screens up to 760px.

This contradicts the product's own spec. `.21st/design.json`'s `coach-staff-roll-call-daily-ledger` requires "one joined Present and Absent pressed-state control inside a shared neutral outline… using the same 9px desktop/tablet and 8px mobile uppercase typography." Neither button is at 9px or 8px-consistently, and the two do not match each other.

**Why it matters.** A joined two-option control with mismatched type reads as a rendering bug to a coach, and it is the kind of defect that survives indefinitely because each half looks plausible in isolation. It also resolves the ambiguity flagged under RESP-1: the 11px floor override was almost certainly accidental drift rather than a deliberate supersession of the 8px sanction, since a deliberate change would have moved both halves.

**Blocked on:** whether the recorded 8px mobile roll-call sanction still stands. Both halves should end up the same size; which size is the design call.

#### Verified NOT defects — do not "fix" these
The 1px media-query pairs **760/761, 720/721, 900/901, 340/341** are clean mutually-exclusive gaps, not destructive overlaps; each produces exactly one correct layout at the boundary pixel. **980/981** has no `min-width: 981px` counterpart *by design* — above 980px the unprefixed desktop rules apply. The 900px + 980px member-directory overlap at 851–980px resolves correctly by source order. Distinct breakpoint widths total 19, which is high but coherent.

**Corrected (`5204109`).** The count is **20**, not 19, and the `340/341` pair named above does not exist — there is no `min-width: 341px` rule anywhere in the tree, only the three genuine pairs `720/721`, `760/761` and `900/901`, plus the `980` with no counterpart, as stated. The enumerated set is 320, 340, 360, 380, 430, 600, 640, 700, 720, 721, 760, 761, 780, 820, 860, 900, 901, 980, 1000, 1100. The finding's conclusion — high but coherent — is unaffected; its arithmetic was not checked.

### 3.4 Design system

#### DS-1 · OBJ · S3 · Effort XS · Confidence High
**A CSS variable is referenced that is never defined anywhere.**

```12981:12981:app/globals.css
  color: var(--color-navy, #071b32);
```

`--color-navy` does not exist in any stylesheet — the only occurrence in the repository is this consumption site. The hardcoded fallback therefore always wins. It renders correctly today and will keep rendering correctly, which is exactly why it is dangerous: it is an invisible dead reference that a future theming or dark-mode pass would silently skip.

**Resolved (`5204109`), and the sweep found two more.** `--player-register-width` (`globals.css:2887-2888`) and `--player-register-mobile-width` (`:5973-5974`) are also declared nowhere — and unlike `--color-navy` they carry **no fallback**, so those declarations are invalid at computed-value time. It does not currently matter, because they live inside a `.player-attendance-register-table` rule whose class no element carries: the player register became a focused-month calendar, and `tests/junior-coach-dashboard.test.tsx` already asserts the class is absent from rendered output.

**Fully resolved (`7fcbba4`).** The dead block was removed — 74 lines — along with the two baseline entries in the token test that existed solely to excuse it. Removing the allowlist made the assertion stricter and surfaced nothing new, confirming it covered exactly those two properties. Positive proof of death rather than an absent grep hit: both components that render `player-attendance-register` now emit `<section className="player-attendance-month-sheet personal-attendance-calendar">` where the table used to be (`player-attendance-card.tsx:256`, `junior-coach-attendance-card.tsx:216`), and the coach-side register is a different component using different, live classes.

That deletion turned out to be the smaller half. A sweep of `financials.module.css` found **23 dead class keys totalling 615 lines** — the residue of the financials-to-modules migration, with every replacement live elsewhere (`setupPanel` → `setupDefaults`/`activationPanel`, `paymentPanel` → `balancePaymentPanel`, `filters` → `financial-records.module.css`). **Total dead CSS removed: 693 net lines.**

One side effect worth knowing: `tests/junior-coach-dashboard.test.tsx`'s `not.toContain("player-attendance-register-table")` assertion is now **tautological** — neither the class nor any styling for it exists, so it can no longer fail. The `role="columnheader"` and `role="gridcell"` counts above it are what actually pin the calendar shape now.

A guardrail now prevents recurrence: `tests/design-tokens.test.ts` asserts no `var()` reads an undeclared custom property, gathering declarations from all CSS plus React `style` props and `setProperty` calls, with the `next/font`-injected `--font-manrope`/`--font-newsreader` allowlisted. It was verified non-vacuous by catching both the original `--color-navy` and a synthetic typo.

**The guardrail immediately earned its place.** Merging `origin/main` (three commits, including a 74-file feature) failed this assertion on **upstream** code: a new fee-preview panel reads `var(--line-strong)`, a token declared nowhere — not upstream, not locally, not at the merge base. An undeclared custom property invalidates the whole `border` shorthand, so that panel was rendering with **no border at all**.

Two things make this worth recording beyond the fix itself. First, **upstream's CI could not have caught it**, because the token-integrity assertion exists only on this branch — the same test file upstream ships contains only the colour-role block. Second, it is the identical bug class as DS-1, arriving from a different author within days, which is the strongest argument available that this assertion needed to exist rather than the two DS-1 instances being one-off mistakes.

Resolved by repointing to `--line`, matching the eleven other neutral panel borders in that module. **Flagged for review:** that it was broken is certain, but `--line` being the *intended* shade is a judgement call — upstream wrote "strong", implying a heavier rule than `--line`. If a darker rule was wanted, the token needs declaring.

#### DS-2 · OBJ · S3 · Effort XS · Confidence High
**Nine raw `#071b32` literals where `--navy` exists**, all inside the platform-admin block: `app/globals.css:13289, 13291, 13300, 13313, 13349, 13360, 13400, 13538, 13549`. The admin surface was evidently built without the token layer in view.

**Resolved (`5204109`).** All nine, plus one raw `#fbfaf7` this finding missed. A second assertion in `tests/design-tokens.test.ts` now rejects any raw hex outside `:root` that matches a declared token value, so the class cannot recur silently.

#### DS-3 · OBJ · S3 · Effort M · Confidence High
**Five token categories are completely empty.** 36 `:root` tokens cover colour (20), typography (4) and spacing (12). There are **zero** tokens for radius, shadow, motion/duration, z-index and breakpoints — confirmed by empty `radius: {}` and `shadows: {}` in `.21st/design.json`. Consequence: 41 raw `box-shadow` declarations, 8 distinct raw `z-index` values (1, 2, 3, 40, 50, 90, 100, 1000), ~30 mixed `.16s`/`160ms` durations, and raw `999px`/`50%`/`4px` radii.

**Partially resolved (`5204109`) — three categories filled, two declined on evidence.** `:root` went from 39 tokens to 54, adopted across 101 declarations and proved inert by snapshotting every stylesheet, mechanically expanding each new token back to its literal, and diffing. Radius, motion and z-layer tokens were added and adopted. The other two were **not** oversights in the implementation but corrections to this finding's premise:

- **No shadow elevation tokens.** Every drop shadow in the file has a unique value, so a scale could only be produced by inventing one and silently unifying existing differences — a visual change disguised as a refactor. The genuine cluster turned out to be inset keylines, so those became the tokens instead. Three near-identical menu shadows are recorded as drift rather than quietly merged.
- **No breakpoint tokens.** Media features are evaluated *before* custom-property substitution, so `--bp-*` is unusable in the only place it would belong. The 20 widths are documented in `.21st/DESIGN.md` instead. This finding proposed a token category that CSS cannot support.

Also declined, and worth recording for the same reason: `border-radius: 0` is left raw at 19 declarations. The system is deliberately square, and a `--radius-none` token would say nothing the `0` does not.

#### DS-4 · SUBJ · S3 · Effort M · Confidence High
**Near-duplicate colour clusters have formed around tokenized values.** The strongest cluster is greys/borders around `--line` `#d7dbde`: `#d8dbdd` (8×), `#d6dadd` (4×), `#d9dddf` (3×), `#dde0e2` (3×), plus `#d5dadd`, `#d2d6d9`, `#ced4d7`, `#d8d5cf`, `#d7d2cb`. Also ivory (`#f3f2ef` 6×, `#ebe9e5` 4×), steel (`#667387` 6×), coral (`#f47c83` 5×). Token proposals in §4.

#### DS-5 · SUBJ · S3 · Effort M · Confidence Med
**An implicit spacing sub-scale exists but is untokenized.** `18px` (176×), `12px` (175×), `10px` (154×), `14px` (129×), `20px` (128×), `22px` (87×) — a coherent operational rhythm below the 8/16/24/32/40/48/56 token scale, used consistently but expressed as raw values.

#### DS-6 · SUBJ · S4 · Effort S · Confidence High
**Tailwind v4 is installed, imported, and used for exactly one utility.** `@import "tailwindcss"` at `globals.css:1`; the only utility appearing in any `className` was `sr-only` (25×). No `@theme` block, no config file, zero matches for `flex`/`p-4`/`text-sm`/`bg-`/`rounded-`.

**Correction (2026-08-23).** I framed this as "adopt it properly or drop it and define `.sr-only` directly", implying that consolidating off `sr-only` would free the project from Tailwind. **It does not.** Tailwind's Preflight (`@layer base`) is load-bearing here: the `box-sizing`/margin/padding/border reset, `list-style: none` on lists, `display: block` on replaced elements, `font-size`/`font-weight: inherit` on headings, and `[hidden] { display: none !important }`. Dropping Tailwind means reproducing that reset by hand, which is a materially larger question than one utility class. DS-7 is now resolved and Tailwind is still required — the adopt-or-drop decision stands on its own, but its cost is higher than stated.

**Related discovery, and the more important one.** `@import "tailwindcss"` establishes `@layer theme, base, components, utilities`, and **unlayered CSS outranks every cascade layer regardless of specificity**. So every Tailwind utility in this project sits in the `utilities` layer, beneath ~14,000 lines of unlayered hand-written CSS. Any future adoption of Tailwind utilities here would find them systematically outranked — which is a real constraint on the "adopt it properly" option, not a detail.

#### DS-7 · OBJ · S4 · Effort XS · Confidence High · **Resolved (`5204109`)**
**Two parallel visually-hidden implementations**: Tailwind `sr-only` (25×) and custom `.coach-published-visually-hidden` (`globals.css:8909`, 10×).

They were **not** equivalent, and the difference mattered. Tailwind's uses `clip-path: inset(50%)` and `border-width: 0`; the custom one used the deprecated `clip: rect(0,0,0,0)`, `border: 0`, and `!important` on all nine declarations. That `!important` was load-bearing, for the cascade-layer reason above: a content-hiding class being the weakest thing in the cascade is a hazard, not a stylistic preference.

Consolidated onto a single **unlayered** local `.sr-only` using the union of both recipes. Keeping the name means all 25 existing call sites are untouched and only the 10 renamed ones changed — the smallest possible DOM diff.

**Residual:** a *third* visually-hidden implementation exists — `.personal-attendance-calendar .player-attendance-month-nav span` — a scoped rule rather than a utility, and the only one that already carried both `clip` and `clip-path`. Folding it in needs `.tsx` edits inside frozen calendar surfaces, so it is left.

#### DS-8 · OBJ · S4 · Effort XS · Confidence High
**The generated design context is stale.** `.21st/DESIGN.md` documents 15 tokens and reports "Components: None detected"; the real `:root` set is 36. Anyone trusting the doc under-counts the system by more than half.

**Resolved (`5204109`).** `.21st/DESIGN.md` and `.21st/design.json` were both regenerated against the 54-token set, and now also carry the two decisions this pass declined — the absent shadow scale and the 19 deliberate `border-radius: 0` declarations — so the record states what is intentionally missing rather than only what exists.

### 3.5 Performance

#### PERF-1 · OBJ · S2 · Effort M · Confidence High
**Two server-side N+1 query patterns in finance.**

`chargeView` issues **three** queries per charge — payment allocations, refund allocations, charge adjustments — and is called inside `.map()` over every charge for a player:

```646:650:lib/finance/repository.ts
  const charges = database.select().from(financialCharges)
    .where(eq(financialCharges.playerAccountId, playerId))
    .orderBy(asc(financialCharges.dueDate), asc(financialCharges.issuedAt))
    .all()
    .map((charge) => chargeView(database, charge, now, includeInternal))
```

Cost: **1 + 3C** queries, C = charges for that player. A player two years into a monthly plan has C ≈ 25 → **~76 queries** for one fee record, on every render of the player fee page, the rapid-desk selection, and every statement PDF. The same 3-per-row shape recurs for receipts at `repository.ts:394-406`.

`monthlyPreparationCandidates` adds **two** queries per candidate:

```666:678:lib/finance/service.ts
  return [...candidatesByPlayer.values()].map((candidate) => ({
    ...candidate,
    firstAssignment: readFirstAssignmentDate(database, candidate.agreement.playerAccountId),
    hasAssignment: hasAssignmentInPeriod(...),
  }))
```

Cost: **1 + 2N**, N = active fee agreements. This runs in `getCoachFinanceDashboardSummary`, i.e. on **every coach dashboard load** — an 80-player academy pays ~161 queries for one card.

**Why it matters.** SQLite queries are cheap individually, which is why this has not surfaced; the cost is linear in academy size and lands on the two most frequently loaded finance surfaces. Mitigating factor: finance is the best-tested domain in the repo (~2,630 lines of tests), so this refactor is unusually safe.

**Resolved across two passes (`1d57db1`, `d197bcb`).** All measured on the 100-player stress fixture:

| Path | Before | After |
|---|---|---|
| Coach fee record, dense player | 697 | 23 |
| Player fee record, dense player | 97 | 13 |
| Fee register, any page size | 375 | 7 |
| Fee register, registration mode | 394 | 6 |
| Collections day book, 92-day range | 266 | 6 |
| Candidate assignment reads, N=100 | 200 | 2 |

All now constant rather than linear in academy size. Behaviour was proven rather than assumed: parity harnesses compared old against new as JSON strings across every account, every charge at both `includeInternal` values, 675 register filter combinations and 27 deep cursor walks — with row-ID and cursor sequences identical throughout, which was the real risk given the register is cursor-paginated.

**One correction to this finding's framing.** The register cost was never page-size-bound. `loadFeeRegister` builds a row for every approved player *before* filtering, because the summary counts cover the whole filtered set and the cursor is an in-memory slice. So the cost scaled with player count, not page size — confirmed by measuring identically at `limit=10` and `limit=100`.

**Remaining N+1 sites, on the record:**

1. **`lib/finance/documents.ts:216`** — `loadChargeView` per charge across *all* of a player's charges when building the statement read model. A player with 30 charges costs ~120 queries **per statement PDF**. `loadChargeViews` serves it with no new code. **This one cross-references PERF-4:** that finding treated the player statement as an unbounded *memory* problem, but a large part of its cost is 120 queries before a single byte is drawn. Since PERF-4's own remedies were both retracted, this is the actual actionable improvement to statement generation — and it is cheap.
2. `prepareMonthlyCharges` (`service.ts:1288-1301`) — one existence query per candidate inside a write transaction, so it needs separate care.
3. Four bounded `loadChargeView` maps at `service.ts:1490`, `:2083`, `:2363`, `:2469` — small in practice, flattened by the same loader.
4. `readCharge` per allocation at `service.ts:1414`.

**Known bound:** `loadChargeViews` binds one parameter per charge ID, so it is capped by SQLite's 32,766 variable limit — roughly 32k charges in one register. Not a practical concern at academy scale, but it is a real ceiling rather than an unbounded batch.

#### PERF-2 · OBJ · S3 · Effort M · Confidence High
**Every route parses the entire portal stylesheet.** `app/globals.css` (14,005 lines, 1,806 distinct selectors) is imported by the root layout and therefore ships to `/` and `/login`:

```4:4:app/layout.tsx
import "./globals.css"
```

Measured from the existing build: the globals chunk is **277,041 bytes raw → 42,521 gzip → 33,647 brotli**. An anonymous homepage visitor also gets the public chunk (31,847 raw / 6,304 brotli) for a CSS total of ~40 KB brotli, of which roughly 85% is coach/player/admin rules they can never see. `/login` downloads the globals chunk alone, using a small fraction of it.

**Measured verdict (2026-08-23) — my framing was wrong in both directions.** Full report at `output/PERF-2-measurement-report.md`, raw data in `output/perf-harness/results/`, measured from an isolated production build of `4722fe3`.

**The CSSOM hypothesis is disproven by 14×.** I claimed the real cost was parse and style-recalculation, not bandwidth. Removing 315 KB and ~3,030 unmatched rules is worth **7 ms** on `/` and **2.4 ms** on `/login` at 6× CPU throttling; steady-state full-tree recalc goes 0.6 ms → 0.0 ms. That is below the ±90 ms FCP noise floor — not measurable end-to-end. The reason: Blink lazily parses declaration blocks and buckets rules by their rightmost compound selector, so unmatched rules sit in hash buckets that are never probed. `ParseAuthorStyleSheet` totals **14 ms for all 366 KB**. Recalc scales with elements (456 on the homepage), not stylesheet size.

**There is a trap here worth recording.** Eagerly parsing that CSS via `new CSSStyleSheet().replaceSync()` genuinely does cost 50–60 ms at 6×. So the obvious way to benchmark this hypothesis would have *confirmed* it — but the browser never takes that path. Anyone re-testing this must measure the real load path, not a synthetic parse.

**The waste percentage was understated.** `/` is **89.0%** unused CSS and `/login` **94.8%**. The homepage matches **67 of 3,097** rules in the globals chunk. The CSS modules are fine — already route-scoped, ~76% used. The entire problem is one file reaching every route through the root layout.

**The real win is transfer — which this finding explicitly dismissed.** CSS is the only render-blocking resource type on these routes; every stylesheet is a `<link>` in `<head>` while every script is non-blocking. On slow 4G at 6× CPU a split moves FCP and LCP on `/` from 1,678 ms to 842 ms. Decomposed: **161 ms is protocol-independent bytes** (matching the 32,420 B brotli arithmetic to within 1 ms) and ~600 ms is bandwidth contention whose survival on Vercel's HTTP/2 depends on prioritisation quality. So the case holds even at the pessimistic end — but for the opposite reason to the one I gave.

**The proposed three-way split is unjustified.** A *binary* public/portal split captures **95%** of the perfect per-route ceiling, because `/` and `/login` together need only 176 of 3,097 rules. The `(coach)`/`(student)`/auth partition buys almost nothing over something far smaller and safer.

**Revised recommendation:** decline PERF-2 as written (L effort, three-way split, parse-cost rationale). Do the font fix in PERF-8 first — it has since landed in `de7f841`, so this dependency is discharged — then a **binary** globals split at M effort. **Decline splitting portal CSS entirely** — `/coach` and `/player` are warm-cache surfaces behind a login whose real cost is 660–671 KB of JS and 460–534 ms of scripting at 6×, not their stylesheet.

Two measurement gaps stated for the record: `openssl` is policy-blocked so no local HTTP/2 origin could be stood up, which is why the win is decomposed rather than assumed; and `UpdateLayerTree` no longer exists as a trace event in Chromium 151, that work having folded into `PrePaint`.

#### PERF-3 · OBJ · S3 · Effort XS · Confidence High
**Four presentational dashboard cards are needlessly client components.** `attendance-card.tsx`, `members-card.tsx`, `sessions-card.tsx` and `player-onboarding-card.tsx` each declare `"use client"` while containing **zero** hooks, handlers or browser APIs — and they are rendered from `app/coach/page.tsx`, which is a server component. Their sibling `financials-card.tsx` is correctly left server-side, proving the intended pattern.

The shared `components/coach/dashboard-card.tsx` primitive has **no** directive of its own and imports only `next/link`, one `lucide-react` icon and a CSS module — so today each card's `"use client"` is the only thing pulling the primitive and its import graph into the client bundle.

**Correction (2026-08-23):** this finding originally listed five cards. `reports-card.tsx:25` calls `useReportResume()`, and `components/coach/reports/report-resume.ts` is a `"use client"` module using `useState`/`useEffect` to read `localStorage` — so it legitimately requires the client boundary and is excluded. See [Corrected claims](#corrected-claims).

**Resolved (`cb80117`).** The four remaining cards lost their directive, putting the boundary where interactivity actually begins and matching `financials-card.tsx`.

#### PERF-4 · OBJ · S3 · Effort S · Confidence High
**PDFs are fully buffered in memory.** `Buffer.concat(chunks)` at `lib/finance/pdf.ts:125` and `lib/reports/pdf.ts:371`, returned as a complete `Response` body. A player statement covering a long fee history buffers entirely before the first byte reaches the client.

**Remedy retracted (2026-08-23) — streaming cannot fix this.** The original finding proposed converting to `ReadableStream`, citing the CSV path as precedent. That was wrong, for two independently verified reasons:

1. **The page footers require full buffering.** Both generators pass `bufferPages: true` (`lib/finance/pdf.ts:112`, `lib/reports/pdf.ts:359`) because they write a "Page N of M" footer — `lib/finance/pdf.ts:405` calls `bufferedPageRange()` and `:421` writes `Page ${…} of ${range.count}`. Knowing the total page count requires composing the whole document first, so with `bufferPages: true` pages accumulate in `_pageBuffer` and are flushed only inside `end()`. No byte of page content can reach a client before the entire document is already in memory.
2. **PDFKit ignores stream backpressure.** Verified in the installed source:
```js
  _write(data) {
    if (!Buffer.isBuffer(data)) { data = Buffer.from(data + '\n', 'binary'); }
    this.push(data);
    this._offset += data.length;
  }
```
The `false` return from `this.push()` is discarded, so a slow consumer cannot slow PDFKit down. Even a correct `pull`-based bridge bounds only its own buffering — peak memory stays O(document size).

So streaming would buy a modest time-to-first-byte improvement and **no memory ceiling relief whatsoever**. Genuinely fixing the memory profile means dropping `bufferPages` and the "Page N of M" footer, which changes the PDF output and is a product decision rather than a refactor.

**Scope was also overstated.** Only the player statement is unbounded. The two report routes are capped by `REPORT_TEXT_MAX_LENGTH` (5,000 characters, enforced in `lib/reports/service.ts`), making them bounded 2–4 page documents, and the receipt is a single page. Converting those would have been reflexive.

**Nothing was fixed, and that is the correct outcome.** An attempt to remove the `new Uint8Array(pdf)` wrap from all four routes — on the reasoning that `Buffer` already *is* a `Uint8Array` — was **reverted**. Two reasons, both measured:

- It does not compile. Since TypeScript 5.7 `Uint8Array` is generic over its backing buffer and `@types/node` types `Buffer` as `Uint8Array<ArrayBufferLike>`, which does not satisfy `BodyInit` (`BufferSource = ArrayBufferView<ArrayBuffer> | ArrayBuffer` demands the concrete type). Four `TS2345` errors. The zero-copy view form `new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength)` fails identically, because the constructor overload is generic and infers `ArrayBufferLike` from `Buffer.buffer`. There is **no assertion-free zero-copy form**.
- The win was not worth an assertion anyway. `Response` copies its `ArrayBufferView` argument regardless (verified by mutating the source after construction and observing an unchanged body), so on top of PDFKit's `_pageBuffer`, its internal readable buffer, the `chunks` array and `Buffer.concat`'s allocation, the removed copy was **one of roughly six** full-document copies. Going from ~6× to ~5× of 87 KB does not justify `pdf.buffer as ArrayBuffer` in a codebase with two total assertions — particularly since that assertion means "this Buffer is not backed by a `SharedArrayBuffer`", a non-local claim about a value produced in a different module.

The declined variant also carries a live hazard: omitting the offset/length arguments on a pooled buffer (`Buffer.concat` was observed returning `byteOffset: 2912`) serves the backing store instead of the view — measured as 87,454 bytes beginning `"îîîîî"`, a corrupted PDF that still starts plausibly enough to pass a casual check. The retained form is structurally immune, because `new Uint8Array(typedArray)` copies the view and has no offset to forget.

**Net: PERF-4 has no worthwhile remedy at the route layer.** The finding stands as a description of the memory profile, but both proposed fixes — streaming and copy removal — are retracted.

**The one viable improvement lives in the generators, not the routes.** Replacing `Buffer.concat(chunks)` with a summed-length preallocated `Uint8Array` filled via `.set()` yields a single copy instead of two, returns `Uint8Array<ArrayBuffer>` so all four routes could drop their wrap entirely, needs no assertion, and leaves PDF bytes untouched since it does not go near the drawing code. Still ranks well below the `bufferPages` constraint in impact, and is not worth doing on its own.

**Incidental finding — brittle test mocks.** All four routes are covered by tests whose `vi.mock` factories enumerate the mocked module's exports. Vitest 3.2.7 throws `No "X" export is defined on the mock` when the route imports anything not listed, the route's `catch` turns that into a 500, and the test fails. So **adding any new export to a mocked module breaks its route test**, independent of whether the new export is used. That is a latent tax on every future refactor in these modules.

#### PERF-5 · SUBJ · S3 · Effort M · Confidence High
**No code splitting anywhere.** Zero `next/dynamic` occurrences. The largest client surfaces load eagerly with their route bundles: `player-ledger.tsx` (1,593 lines), `member-directory.tsx` (1,072), `report-workspace.tsx` (805), `financials-rapid-desk.tsx` (679). `qrcode.react` is statically imported for a single 2FA route.

#### PERF-6 · SUBJ · S4 · Effort S · Confidence High
**`motion` ships for four hero/accordion components** where an equivalent CSS-native mechanism already exists in-repo (`components/reveal.module.css`, used on the public path). The design record itself asks for motion to be "CSS-native where it can preserve the same experience with less client payload" — done for the public homepage, not for the authenticated heroes.

#### PERF-7 · SUBJ · S4 · Effort S · Confidence Med
**`/login` is forced dynamic** by a `sessionProvider.getCurrentIdentity()` call in the page (`app/login/page.tsx:26` → `headers()`), preventing a static login shell. A middleware cookie check would restore static rendering for the overwhelmingly common anonymous case.

#### PERF-8 · OBJ · S2 · Effort S · Confidence High
**Font preloading is the largest render-blocking cost on the public routes, and it outweighs the CSS problem.** *Found while measuring PERF-2, 2026-08-23.*

`app/layout.tsx` loads Manrope and Newsreader, the latter in both normal and italic, and the root layout preloads them across four files — **147–187 KB per route**. That is as much wire weight as all the JavaScript, and unlike CSS it is already compressed, so brotli cannot help.

Removing just the three font preloads on `/` moves FCP from **1,472 ms to 1,148 ms** with zero CSS work — the best win per unit of risk anywhere in this audit, confined to a single file.

**This is not simply "delete the preloads", and the trade-off needs deciding rather than assuming.** Both fonts already use `display: swap`, so text paints in the fallback and swaps when the font arrives; dropping a preload makes that swap land later and the flash of fallback text more visible. The real work is deciding *which* faces genuinely need preloading on *which* routes — Newsreader italic almost certainly does not need it anywhere, and the authenticated portal has different needs from the editorial public homepage. The audit's original estimate of "~85–130 KB, SUSPECTED" was low and marked unverified; it is now measured.

---

**Resolved (`de7f841`) — and the hypothesis above is inverted.** Full report at `output/perf-font/PERF-8-report.md`, raw data in `output/perf-font/results/`. The direction of the finding was right and its reasoning was wrong, so both are worth reading.

**Newsreader italic is not the face to suspect; it is the dominant one.** It renders above the fold on **8 of the 12 routes** audited, including the emphasised word of the `/` hero headline and the oversized greeting name on both portal dashboards. Static CSS analysis undercounts it structurally: `<em>` and `<i>` are italic from the **user-agent stylesheet**, so a rule like `.hero h1 em { font-family: var(--font-newsreader) }` renders italic without ever naming `font-style`. Faces were read from the renderer instead — computed `font-family`/`font-style` per text-bearing element, `document.fonts` activation state, glyph-level platform fonts via CDP `CSS.getPlatformFontsForNode`, and viewport intersection. Dropping italic would have changed rendered typography on the acquisition surface.

**This is the second instance of one error class, which makes it a methodology finding.** The `.status-draft` false positive in [Corrected claims](#corrected-claims) came from grepping for literal class names in a codebase that builds them with template literals. This came from grepping for `font-style` in a stylesheet whose italics are inherited. Both are the same mistake: reading a static artifact to answer a question only the renderer can answer. Two independent instances in one day is a pattern, not bad luck. **Any claim of the form "X is unused" must be established from the running application.**

**The real waste was structural, and neither the finding nor its "which faces" framing had spotted it.** The two Newsreader styles are used on almost perfectly *complementary* surfaces — italic on `/`, `/player`, `/coach` and their sub-routes; upright only on the auth forms and the operational registers, always as secondary copy — yet the root layout preloaded both on every route. So **every single route preloaded one Newsreader face it never rendered**: 58,152 B wasted on the eight italic routes, 64,500 B on the four upright ones. The question was never "which faces are unused" but "which faces are unused *here*".

**What shipped.** `app/layout.tsx` only, 20 insertions and 2 deletions: Newsreader is split into two `next/font` instances so the upright face can carry `preload: false`. No stylesheet was touched.

| Measure | Result |
|---|---|
| Preloaded font per route | **−58,152 B** (147,228 → 89,076, −39.5%) |
| `/` FCP = LCP | **−66.9 ms** [CI −129.4, −4.4] |
| `/login` FCP = LCP | **−90.3 ms** [CI −119.1, −61.5] |
| `/player` FCP | **−87.4 ms** [CI −114.0, −60.9] |
| `/player` LCP | −186.9 ms [CI −920.1, +546.4] — **not significant**, sd 470–630 ms |
| CLS | **0.0000 in all 63 runs**, all arms |
| Rendered output | Full-page PNGs **byte-identical** on seven routes; 0 typography, 0 geometry, 0 platform-font diffs across 508 text-bearing elements |

Slow 4G (1.6 Mbit/s, 150 ms RTT), 6× CPU, mobile 390×800 DPR 2, cold cache, 7 interleaved paired passes with arms measured back-to-back within each pass. CLS holds at zero because `adjustFontFallback` is already on and emits `size-adjust: 105.48%` with ascent/descent overrides for Newsreader, so the swap repaints in place rather than reflowing.

The bytes table states the trade-off more honestly than the timings do: the change removes 58.5 KB from the wire on `/` and `/player`, where the upright face is never rendered, and removes **117 bytes** on `/login`, where it is — there it merely stops a fetch competing with the render-blocking stylesheet before FCP, and still wins 90 ms.

**Declined on measurement: dropping the italic preload as well.** Worth **−241.1 ms** on `/` [−280.3, −202.0], the largest single number in this audit, and declined anyway. It removes **31 bytes** — `/` goes from 371,325 to 371,294 — because it does not stop the font being fetched, only moves the fetch out of the render-blocking window. It buys those 241 ms by rendering the hero's emphasised word in Times New Roman for an extra **344 ms** on the acquisition surface, delaying the `/player` greeting by 494 ms, and moving `/player` LCP from the shipped arm's 1,960 ms to 2,468 ms (2,004 ms in the baseline arm). Against `public-production-readiness` — "a locked editorial composition … without changing SMBA's visual identity" — that is a decision for the design owner, not a unilateral one. It is priced and recorded, not forgotten.

**Rejected on mechanism, not preference: per-route preloading.** Instantiating italic in the route-group layouts and leaving upright in the root would give true per-route preloading, and it is not safely available. The preload flag is part of the *instance* and is encoded in the emitted filename — the same face is `…-s.p.…woff2` when preloaded and `…-s.…woff2` when not, verified by diffing the built font CSS across the three arms. Mixing a deferred and a preloaded instance of one family therefore puts **two URLs for identical bytes** and two competing `@font-face` rules for the same family, style and unicode-range into a single document; which wins depends on chunk order, and the loser is either wasted or duplicated as a second 64.5 KB download. Declaring italic *only* in the group layouts avoids the duplication and is worse: `/admin`, `/activate`, `/recover`, `/setup`, `/account` and `/auth/*` do render italic Newsreader and would lose the face permanently.

**One input number did not reproduce, and the fix is not justified on it.** The `1,472 ms` baseline quoted above came from the PERF-2 report's §4f **synthetic** arm — static copies of documents served by the harness's own HTTP/1.1 static server — at commit `4722fe3`. The live `next start` baseline at `7fcbba4`, 693 lines of CSS lighter, measures **1,752 ms**. Different arm, different commit, different host load; the absolute figure should not be quoted again. What did reproduce independently is the per-byte effect: the original stripped 147,228 B for −324 ms, or **2.25 ms/KB**; the arm-C measurement here strips 122,652 B for −241 ms, or **1.96 ms/KB**. Same mechanism at the same scale. Every conclusion above rests on paired, interleaved, same-machine comparisons and none on cross-run absolute medians — which is the only reason a headline number failing to reproduce does not take the finding down with it.

**Also recorded, and not acted on.** Newsreader italic latin (64,500 B) is *larger* than Newsreader normal latin (58,152 B), so the face that must stay preloaded is the more expensive one, and there is no smaller option: the stylesheets ask for 24 distinct Manrope weights between 400 and 830 and 6 Newsreader weights between 400 and 620, most non-standard (470, 570, 580, 750), so static weight files cannot reproduce the rendered result. The larger remaining problem in this area is PERF-9.

**A harness detail worth carrying forward.** CDP CPU and network overrides are silently discarded by the renderer swap during form login, so authenticated runs must inject session cookies into a pristine context rather than navigating through the login form. Without that fix the `/player` numbers were unthrottled — FCP ≈ 230 ms — and the change would have looked like a null result. Any future authenticated performance measurement in this repository is wrong by default until this is handled.

#### PERF-9 · OBJ · S3 · Effort S · Confidence High
**One currency symbol pulls a second font subset on almost every route, and 91 KB of it on the financial register.** *Found while measuring PERF-8, `de7f841`. Not fixed.*

`subsets: ["latin"]` in `app/layout.tsx` controls **only preloading**. `next/font` emits an `@font-face` rule for every subset Google publishes — six of them — and Blink downloads any one of them the moment a rendered character falls inside its `unicode-range`. The build contains **12 woff2 files**, of which 3 were preloaded before `de7f841` and 2 after; the other 9 are live, unpreloaded, and one `₹` away from being fetched.

The rupee sign **`₹` (U+20B9) is in `latin-ext`, not `latin`** — Google's latin range stops at U+20AC. It is the **only** character in the entire application outside the latin subset, and it costs:

| Route | Extra subset fetched, for `₹` alone | Bytes |
|---|---|---:|
| `/` | Manrope latin-ext | 15,240 |
| `/player`, `/coach`, `/coach/reports` | Newsreader italic latin-ext | 39,708 |
| `/player/financials` | both of the above | 54,948 |
| `/coach/financials/records` | Manrope + Newsreader italic + Newsreader normal latin-ext | **91,276** |

**Size this against PERF-8, because the comparison is the point.** PERF-8 shipped and removed 58,152 B of preloaded font per route. This removes **91,276 B on `/coach/financials/records`** — the route whose entire purpose is displaying money — and 39,708 B on the two dashboards, so on the routes where it bites it is the larger byte win of the two, for one glyph. On `/` it is smaller, at 15,240 B.

**It is S3 rather than S2 despite the larger byte count, and the timing data is why.** These files arrive with initiator `css` at roughly **2,224 ms** on `/`, i.e. discovered only after the stylesheet is parsed and the glyph is matched — well after FCP. They are not render-blocking, so they do not cost paint time the way PERF-8's preloads did; they cost bandwidth, and they cost it late, contending with everything else on a slow connection. Pure waste, but waste after the user has seen the page.

**Fix direction: serve U+20B9 from a system font via `unicode-range`.** A single narrow `@font-face` scoped to U+20B9 with a `local()` source, placed ahead of the `next/font` rules in the cascade, takes the glyph out of every latin-ext range and nothing else changes — no other character in the app is affected, because no other character is outside latin. Substituting `Rs.` in the copy would also work and is a **product decision of last resort**, since it changes what a parent reads on a fee statement.

**What not to do:** widening `subsets` to include `latin-ext` makes it strictly worse, since it would *preload* those files as well as ship them — undoing PERF-8 and more.

**Secondary observation, non-performance.** Two CSS rules request Manrope weights of **820 and 830**, above the variable font's 800 axis maximum. They silently clamp to 800, so the rules render identically to a `font-weight: 800` rule while reading as if they do something. Correct them to 800 rather than leave a distinction the font cannot express.

### 3.6 Technical debt & maintainability

#### DEBT-1 · OBJ · S2 · Effort XS · Confidence High
**`npm run typecheck` is non-deterministic.** `tsconfig.json` explicitly includes generated build output:

```json
"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"]
```

With a `.next` present, `tsc --noEmit` reports **2 errors** referencing a module that does not exist:

```
.next/dev/types/validator.ts(633,39): error TS2307: Cannot find module '../../../app/admin/layout.js'
.next/types/validator.ts(633,39): error TS2307: Cannot find module '../../app/admin/layout.js'
```

`app/admin/` contains only `actions.ts`, `page.tsx`, `preview/` — there is no layout. CI survives only because it runs `typecheck` (step 44) *before* `build` (step 99), so `.next` is absent. **Any developer with a warm `.next`, or any future CI change that caches build output or reorders these steps, sees a red typecheck caused by a stale artifact.** A quality gate whose result depends on leftover files is not a gate.

**Same theme, second instance (found 2026-08-23).** `vitest.config.ts` has no `exclude` for build/artifact directories, so Vitest discovers and runs any test file that happens to sit under the repo root. Demonstrated accidentally during this work: a `git worktree` created at `output/baseline-worktree` for screenshot capture caused Vitest to collect **295 test files instead of 140**, reporting 17 failed files that were duplicates of passing tests. `eslint.config.mjs` already ignores `output`, and `tsconfig.json` only excludes `node_modules` — so of the three verification commands, one is protected and two are not.

Both instances share a root cause: **`tsconfig.json` includes `**/*.ts` with only `node_modules` excluded, and Vitest inherits an equally open default.** Any stray directory inside the repo silently changes what `typecheck` and `test` mean. Cheap fix: exclude `.next`, `output`, `coverage` and any worktree path from both, and narrow the tsconfig `include` to real source roots.

**Resolved (`6abea0c`), with measurements.** Typecheck errors 2 → **0**. Files `tsc` read from `output/`: 919 → **0**. Vitest collected files 607 → **142**. The Vitest baseline was observed growing from 451 to 607 *during* the session as another agent extracted a tree under `output/` — the defect demonstrating itself in real time.

Root cause of the phantom errors was confirmed as a stale artifact, not a Next bug: `app/admin/layout.tsx` was deleted in commit `3cbd766` (Aug 23 12:46), while both validator files were written Aug 22. Two facts shaped the fix — `next build`/`next dev` **re-append** any missing `.next` type glob to `include` and rewrite `tsconfig.json` (`writeConfigurationDefaults.js:302-317`), so removing an include is self-reverting whereas an `exclude` is stable; and Next's own build type check already filters `.next/dev/types` out, commented *"to prevent stale dev types from causing errors when routes have been deleted since the last dev session"* (`runTypeCheck.js:31-40`). A bare `tsc` has no such filter. `include` was narrowed to real source roots, `.next/dev` excluded to mirror Next's own behaviour, and `.next/types` deliberately **kept**, because `next build`'s type check enumerates from this same tsconfig and excluding it would drop route-validator coverage from the build too.

**Two further instances of the same theme (found 2026-08-23, not fixed):**

1. **`scripts/regression/summarize-accessibility.ts` reads whatever is on disk.** It loads `output/accessibility/<profile>/results.sanitized.json` for every profile with no freshness check, and sets exit code 1 from what it finds. Local runs today would summarise stale results — several sibling directories (`accessibility-before`, `accessibility-after`, `accessibility-full`) already exist. CI is safe only because it checks out clean.
2. **`npm test` and CI disagree by design.** `npm test` collects `tests/regression-fixture.test.ts`, which CI deliberately splits into a separate `regression:test` invocation. So a developer's local full run fails where CI passes — the inverse of instance 1, and equally corrosive to trusting the gates.

**Process lesson (mine).** While delegating this remediation I instructed agents not to run `tsc`, to stop them racing each other on `tsconfig.tsbuildinfo`. That hid a genuine compile error: a change to four PDF routes was correct at runtime and verified byte-identical by SHA-256, but `Buffer<ArrayBufferLike>` does not satisfy `BodyInit` under TypeScript 5.7+, so it broke the build and the agent's own verification could not see it. Runtime verification does not substitute for the type checker. If concurrent workers must share a tree, give them a way to typecheck (a scoped invocation or a separate `tsBuildInfoFile`) rather than removing the check.

#### DEBT-2 · OBJ · S2 · Effort L · Confidence High
**Zod is a dependency used in exactly one production file.** `lib/auth/pin-plugin.ts:14` is the sole consumer. Across 14 server-action modules (~76 exported actions), inputs are read with bare coercion:

```60:61:app/login/actions.ts
  const academyId = normalizeAcademyId(String(formData.get("academyId") ?? ""))
  const password = String(formData.get("password") ?? "")
```

Domain validators (`isAcademyId`, `validateNewPassword`) and service-layer invariants do provide real protection, so this is **not** an open security hole. It is a correctness-and-refactoring hazard: rename a form field and `String(undefined ?? "")` yields `""` silently, with no compile-time or runtime signal. Highest-risk surfaces are the eight auth/account/admin action files that build objects straight from `FormData`.

#### DEBT-3 · SUBJ · S3 · Effort M · Confidence High
**Four-plus parallel server-action result shapes.** `OperationalActionResult<T>` (~24 uses), `FinanceActionResult`/`FinanceDataActionResult` (~27), `AnnouncementActionResult`, and ~20 bare `FormState` types with no `ok` discriminant (`app/login/actions.ts:40`). Every new action requires choosing a convention, and no generic error-handling UI is possible without adapters.

#### DEBT-4 · SUBJ · S3 · Effort L · Confidence High
**God files.** `lib/finance/service.ts` 3,766 lines / 38 exports / ≥8 responsibilities; `components/coach/financials/player-ledger.tsx` 1,593 lines with 12+ inline subcomponents and 9 `router.refresh()` calls; `member-directory.tsx` 1,072; `player-onboarding-register.tsx` 980. Natural split boundaries exist (finance mutations vs. read models around line 3205; one file per ledger panel).

#### DEBT-5 · OBJ · S4 · Effort XS · Confidence High
**The badminton-court SVG is duplicated verbatim in three hero components** — byte-identical `viewBox="0 0 1340 610"`, `<rect>`, and the full court `<path d="M20 63H1320M20 547H1320…">` in `coach-welcome-hero.tsx:40-47`, `junior-coach-welcome-hero.tsx:27-34`, `dashboard/welcome-hero.tsx:34-41`. The design record explicitly requires these heroes to stay visually paired, which makes three copies a guaranteed future drift.

#### DEBT-6 · SUBJ · S4 · Effort M · Confidence High
**No shared form-field primitive across 12 auth/setup forms** — ~64 repetitions of the label + input + error/helper + `aria-*` block. This is the structural reason A11Y-3 exists: there was no single place to fix.

**Resolved (`c087412`), jointly with A11Y-3.** `AuthField` now exists and five forms consume it. This was the one place the original roadmap's cross-finding pairing predicted correctly: extracting the primitive *was* the fix for the five forms, not a prerequisite to it.

#### DEBT-7 · SUBJ · S4 · Effort S · Confidence High
**The two-digit "folio" register pattern is reimplemented at 8 sites** — `folio()` helper, inline `padStart(2,"0")` (×2), and five separate CSS class families across `globals.css` and three modules.

#### DEBT-8 · SUBJ · S4 · Effort XS · Confidence High
**Two CSS strategies with no documented rule.** ~60% of interactive UI uses global BEM-ish classes in `globals.css`; ~40% uses 10 CSS modules. Newer features (financials, announcements, onboarding) trend toward modules, suggesting an undocumented in-progress migration.

#### DEBT-9 · OBJ · S4 · Effort XS · Confidence High
**Stale repository artifacts.** `SMBA_UI_CARD_BY_CARD_PROMPT_PLAYBOOK.txt` (140 KB) references a dead path `/Users/nitishg/Documents/SMBA/student-portal`; `design-system/smba-player-journal/MASTER.md` is a generated doc with a generic palette wired to nothing. Neither is imported by runtime code.

**Resolved (`51677e2`).** Both deleted — 3,653 lines. It shipped with a documentation pass rather than with the `tsconfig` change it was planned alongside, which is the only reason it does not appear under DEBT-1.

#### DEBT-10 · SUBJ · S4 · Effort S · Confidence High
**CI has no bundle, dependency or coverage gate.** `quality.yml` gates lint, typecheck, `drizzle-kit check`, unit tests, build and five named Playwright regression suites — registration, finance, authentication, onboarding, attendance — plus the accessibility matrix and the failure-evidence sentinel, in their own workflows. That is genuinely strong, and it is a subset: the repository holds 13 spec files, so the remainder run only on demand. Absent: bundle/CSS size budget, `npm audit`, coverage thresholds.

### Corrected claims

Claims from this audit that did not survive verification, recorded here so they are not acted on. The first two came from the parallel audits and were caught before publication; the rest were caught by implementation, which is later and more expensive. Each row is a headline number that changed; the corrections that only affected a finding's internals are marked **Corrected** in the findings themselves. PERF-8's inverted hypothesis is the sixth and is recorded in its own body, because the correction *is* the finding.

| Claim | Reality |
|---|---|
| "~265 KB / 86% of CSS bytes wasted on the homepage" | Raw-byte framing. Actual transfer is **42.5 KB gzip / 33.6 KB brotli** for the globals chunk; wasted brotli ≈ 28 KB. The percentage stands, the magnitude does not. Reframed as a parse/recalc issue in PERF-2. |
| "532 duplicate selector groups in `globals.css`" | Not reproducible. Measured: **235 of 1,806 distinct selectors (13%) appear 2+ times, maximum 5 repetitions** — the normal base-rule-plus-responsive-override pattern. Not a defect; removed. |
| "Dead CSS: `.status-draft`, `.status-published`, `.status-revision` not found in any `.tsx`" | **False positive — all three are live.** They are constructed dynamically as `` `status-${getCoachReportState(report)}` `` at `report-workspace.tsx:386` and `:778`, with the state strings asserted by `tests/coach-report-utils.test.ts`. Nine `is-*` state classes were flagged the same way and are live for the same reason. **A literal-name grep is not proof of death in this codebase** — it builds class strings via template literals, `styles[key]` bracket access, and `data-*` attribute selectors. Any future dead-code claim must rule out all three. |
| §4.4: "`--line-disabled: #9aa3ab` — 3.1:1" | **Wrong — it is 2.56:1 and fails.** Found during PR-2 implementation. The proposed remedy for a contrast defect was itself a contrast defect. Corrected to `#858d94` (3.37:1). Lesson: compute every proposed token value rather than eyeballing it, and composite translucent backgrounds first. |
| PERF-3: "five dashboard cards have zero hooks" | **Four, not five.** Found during PR-5 implementation. The verification grep matched React's built-in hooks (`useState`, `useEffect`, `useMemo`, …) but not *custom* hooks, so `reports-card.tsx`'s call to `useReportResume()` was invisible to it. That card reads `localStorage` and must stay a client component. Any future "could this be a server component?" check must match `use[A-Z]\w*\(`, not an enumerated list of React hooks. |

---

## 4. Design system audit & token proposals

**Current state.** 36 `:root` tokens: 20 colour, 4 typography, 12 spacing/layout. Coverage is good for colour, thin for type, absent for five categories. `var()` adoption inside CSS modules is genuinely strong (360 references in `financials.module.css` alone) — the modules consume tokens well; the problem is that the token set does not extend far enough for them to consume.

### 4.1 Close the empty categories

Highest value, lowest risk: these are all *new* tokens that replace raw values with identical computed output, so they are visually inert.

**Two of these five blocks were wrong, and are declined.** The proposals are left standing below so the error is legible; what shipped in `5204109` is radius, motion and z-layer only, and the annotations on each block say which is which.

```css
/* SHIPPED. Radius — replaces 7× 999px, 23× 50%, raw 4px */
--radius-sm: 4px;
--radius-pill: 999px;
--radius-circle: 50%;

/* DECLINED — see below. Elevation, consolidating 41 raw box-shadow declarations */
--shadow-raised: 0 1px 2px rgba(7, 27, 50, 0.06);
--shadow-overlay: 0 12px 32px rgba(7, 27, 50, 0.12);
--shadow-modal: 0 32px 90px rgba(0, 0, 0, 0.18);   /* from globals.css:1428 */

/* SHIPPED. Motion — normalises ~30 mixed .16s / 160ms values */
--duration-fast: 160ms;
--duration-base: 240ms;
--ease-standard: cubic-bezier(0.2, 0, 0.2, 1);

/* SHIPPED. Z-index — replaces 8 ad-hoc values (1,2,3,40,50,90,100,1000) */
--z-base: 1;
--z-sticky: 40;
--z-header: 50;
--z-overlay: 90;
--z-dialog: 1000;

/* DECLINED — CSS cannot do this. Breakpoints, documenting the real 19-width system */
--bp-xs: 340px;
--bp-sm: 430px;
--bp-md: 720px;
--bp-lg: 760px;
--bp-xl: 980px;
```

**Why the elevation block is declined.** It asserts that 41 raw shadows consolidate to three. They do not: every drop shadow in the file has a distinct value, so those three tokens could only be adopted by rewriting 41 declarations to one of three approximations — a visual change presented as an inert refactor, which is exactly what this section promises not to do. The three literals above were read off three arbitrary rules and given category names. The real cluster is inset keylines, and that is what `5204109` tokenised instead. The three near-identical menu shadows are recorded as drift in `.21st/DESIGN.md` rather than quietly unified.

**Why the breakpoint block is declined.** Media features are evaluated before custom-property substitution, so `@media (max-width: var(--bp-md))` does not work in any browser. The tokens would be declared, never referenced from a media query, and would decay. The hedge "reference values for review discipline" was a comment pretending to be a mechanism. The 20 widths are documented in `.21st/DESIGN.md` instead — 20, not the 19 the comment above and RESP-2 both claim. A direct count returns 320, 340, 360, 380, 430, 600, 640, 700, 720, 721, 760, 761, 780, 820, 860, 900, 901, 980, 1000, 1100. RESP-2 is corrected accordingly.

### 4.2 Name the colour clusters (DS-4)

| Proposed token | Value | Consolidates | Occurrences |
|---|---|---|---|
| `--line-muted` | `#d9dddf` | `#d9dddf`, `#d8dbdd`, `#d6dadd`, `#dde0e2`, `#d5dadd`, `#d2d6d9` | ~20 |
| `--ivory-muted` | `#f3f2ef` | `#f3f2ef`, `#ebe9e5` | ~10 |
| `--steel-muted` | `#667387` | `#667387` (admin block) | 6 |
| `--coral` | `#f47c83` | `#f47c83` (public accents) | 5 |

### 4.3 Name the operational spacing sub-scale (DS-5)

```css
--space-compact: 12px;   /* 175 raw uses */
--space-inline: 18px;    /* 176 raw uses */
--space-row: 22px;       /*  87 raw uses */
```

### 4.4 Accessibility-driven token additions

```css
--text-placeholder: #6b7480;    /* replaces #8a939b — 4.74:1 on white, 4.54:1 on --paper. Fixes A11Y-1 */
--line-disabled: #858d94;       /* replaces var(--line) on disabled controls — 3.37:1 on white. Fixes A11Y-2 */
--type-operational-floor: 10px; /* makes the design record's own floor enforceable. Fixes RESP-1 */
```

**Correction (2026-08-23):** `--line-disabled` was originally proposed as `#9aa3ab`. That value has relative luminance 0.35999, giving **2.56:1** on white — it fails the very 3:1 target it was specified for. Verified value is `#858d94` (L = 0.26167 → **3.37:1** on white, 3.23:1 on the composited `rgba(255,255,255,.48)`-over-ivory month control). Always composite translucent backgrounds before computing the ratio; the month control is not on pure white.

### 4.5 Enforcement

Extend `tests/design-tokens.test.ts` (W-15) rather than adding new tooling. Three assertions worth adding:

1. No `font-size` below `10px` outside an explicit allowlist of design-sanctioned 9px roll-call selectors.
2. No `var(--…)` reference to an undefined custom property — this class of bug is DS-1 and is currently invisible.
3. No raw `#071b32` / `#f7f5f0` / `#c81d2a` outside `:root` — locks in DS-2 and prevents recurrence.

### 4.6 Constraints that bound this work

`.21st/design.json` freezes several surfaces: mobile authentication, the account menu, mobile calendar/attendance, and the mobile member directory. Token consolidation in those areas **must preserve exact computed values**. All proposals above are value-preserving except the three in §4.4, which are deliberate contrast corrections and should be reviewed as visual changes.

---

## 5. Roadmap

**Rewritten 2026-08-23, from the position after PR #56 and `de7f841`.** The original three-wave plan is spent. Its "Now" bucket has shipped almost entirely; its "Later" bucket led with PERF-2, which measurement retracted; and it predates eight of this document's findings. What is left is not a queue of cheap wins — it is three decisions, a handful of measurement-backed increments, and a cluster of large refactors that should not start this quarter. Sequencing the remainder aggressively would manufacture urgency the findings do not support, so this roadmap is deliberately short.

### Decide first

These block the work behind them and none is a code question. Each has been open since the finding that raised it.

| Decision | Blocks | What is needed |
|---|---|---|
| Roll-call mobile type size | RESP-4, and the last open question in RESP-1 | The design record contradicts itself and production contradicts both readings. Pick one size for both halves of the control; the CSS is then a one-line change. |
| Where production errors report to | ST-3's completion, DEBT-10 | Six branded boundaries currently report to nobody, and `global-error.tsx` does not even read the `error` it is handed. Choosing a destination has a real cost. |
| Tailwind: adopt or drop | DS-6, and any future use of utilities | Dropping means hand-reproducing Preflight; adopting means accepting that utilities sit beneath ~14,000 lines of unlayered CSS. Leaving it undecided keeps a dependency for one class and blocks the utility question permanently. |

### Then, in this order

Each item is bounded, has a measured or stated justification, and depends on nothing else in the list.

| # | Work | Finding | Why here | Effort |
|---|---|---|---|---|
| 1 | Serve `₹` from a system font via `unicode-range` | PERF-9 | 91,276 B of `latin-ext` on `/coach/financials/records` for one glyph, 39,708 B on the dashboards — larger, on those routes, than the 58,152 B PERF-8 removed. One `@font-face` rule; nothing else in the app is outside latin. Not render-blocking, which is why it is here rather than urgent. | S |
| 2 | Batch the statement read model | PERF-1 residual | ~120 queries per statement PDF, and `loadChargeViews` already exists. Also the only actionable part of PERF-4. | XS |
| 3 | Persist attendance drafts | ST-2 gap 2 | The product's worst realistic failure path, and the deadline in `75d3c88` enlarged it. `localStorage` per occurrence; replay keeps the existing concurrency check, so no write queue is needed. | S |
| 4 | Close the two unsaved-work guard traps | ST-8 | Both silent and state-dependent; 13 consumers share the guard, and the one surface that looks safe is masked only incidentally. | M |
| 5 | Assert matrix coverage, and prohibited names | A11Y-9, A11Y-10 | Two assertions, one file each, each catching a whole family that one-at-a-time fixing has not converged on. Both are new blocking checks, so decide before adding. | S |
| 6 | Promote the free and cheap advisory rules | A11Y-8 tiers 1–2 | `landmark-one-main` and `region` are already at zero, so promotion costs nothing and locks in the `not-found` fix. `landmark-unique` and `aria-allowed-role` are ten occurrences across three states. Remediate `aria-prohibited-attr` before promoting it — it would turn 13 states red today. | S |
| 7 | Binary public/portal CSS split | PERF-2, surviving half | 95% of the per-route ceiling; 161 ms of protocol-independent bytes on slow 4G. Its font-first dependency is discharged — PERF-8 landed in `de7f841`. Portal CSS stays unsplit. | M |

Below that line, and genuinely optional: the two Manrope rules asking for weight 820 and 830 above the font's 800 axis maximum, which clamp silently (PERF-9, secondary); PERF-1's three other residual N+1 sites (item 2 above is the first of the four); and DEBT-1's two further gate instances. All are recorded so they are not rediscovered; none is worth displacing anything above.

**Not on this list, and priced:** dropping the Newsreader italic preload is the largest single timing number in this audit at −241 ms on `/`, and it is declined rather than deferred — it removes 31 bytes and pays 344 ms of Times New Roman in the hero. It becomes available only if the design owner accepts that trade. See PERF-8.

### Deferred, deliberately

DEBT-2, DEBT-3 and DEBT-4 — zod adoption across ~76 actions, unifying four result shapes, and god-file decomposition — are all large, all mechanical, and none user-visible. DEBT-3 must precede DEBT-4. The S4 polish set (ST-5, ST-6, A11Y-7, RESP-2, RESP-3, DS-4, DS-5, DEBT-5, DEBT-7, DEBT-8, DEBT-10, PERF-5, PERF-6, PERF-7) is unchanged and correctly unprioritised.

Not on this roadmap at all, and deliberately: the three-way CSS route-group split, PDF streaming and the `Uint8Array` copy removal — all retracted on measurement — and promoting `color-contrast` to blocking, which would make the gate permanently red on 1,122 results that are not violations.

---

## 6. What actually shipped

This section previously proposed ten PRs in four waves. Reality was **one branch, squash-merged as `18a625e8`, plus one follow-on commit `de7f841`**. The decomposition survived in substance — nine of the ten planned PRs shipped in some form — but not in shape: three needed multiple passes because the first pass proved the finding's own scope wrong, one produced no code by design, one more was attempted and reverted, and six changes were not planned at all because their findings did not exist yet.

Nineteen changes below: **sixteen changed code, two produced none, one is documentation.** Planned PR numbers are retained because several finding bodies above cite them ("Found during PR-1 implementation", "Extended during PR-3").

| # | Change | Planned as | Findings | Commits | How it differed from the plan |
|---|---|---|---|---|---|
| 1 | Async action handlers made failure-safe | PR-1 | ST-1 | `8d60c85` | As scoped. Scoping the `catch` to only the awaited call prevented a new bug rather than fixing an old one. |
| 2 | Unsaved-work guard stops discarding callbacks | — | ST-7 | `0254bbd` | **Unplanned**, found while implementing PR-1. Fixed in the guard rather than at the four call sites, so none was touched. |
| 3 | Contrast and operational type floor | PR-2 | A11Y-1, A11Y-2, RESP-1 | `a13888f`, `4722fe3`, `52c0fc9` | **Three passes, not one.** Pass 1 closed sub-8px; pass 2 caught five rules whose narrow-viewport override exceeded its wide-viewport base; pass 3 reached the CSS modules. Two sites declined on measurement. |
| 4 | Keyboard and landmark parity | PR-3 | A11Y-4, A11Y-5 | `5640ee0`, `49ad19c` | Widened: the container this finding cited as *correct* had the same defect. Surfaced A11Y-8 and A11Y-10. |
| 5 | Route error and loading boundaries | PR-4 | ST-3, ST-4 | `5f5312e`, `49ad19c` | 4 `loading.tsx` covered the 9 routes rather than the planned 7, via segment inheritance. Route count corrected 18 → 15. |
| 6 | Dashboard cards server-rendered | PR-5 | PERF-3 | `cb80117` | Four cards, not five. |
| 7 | Design token layer | PR-6 | DS-1, DS-2, DS-3, DS-7, DS-8 | `5204109` | Shadow and breakpoint tokens from §4.1 declined with reasons rather than added. Added the two assertions that later caught upstream's undeclared token. |
| 8 | Dead CSS removed | — | DS-1 follow-on | `7fcbba4` | **Unplanned, and the larger half** — 693 lines, mostly a financials-to-modules graveyard the audit never saw. |
| 9 | Finance read models batched | PR-7 | PERF-1 | `1d57db1`, `d197bcb` | **Two passes.** Pass 2 covered the register and collections day book, which the finding had mis-framed as page-size-bound. Four further N+1 sites recorded rather than fixed. |
| 10 | Courtside network copy and retry | PR-8 | ST-2 | `f543d10` | As scoped, and the commit named its own two remaining gaps rather than claiming the finding closed. |
| 11 | Attendance saves bounded by a deadline | — | ST-2 gap 1 | `75d3c88` | **Unplanned.** A UI-level deadline, not a cancellation — abort cannot propagate through a Next.js server action. |
| 12 | Auth field primitive | Next bucket | A11Y-3, DEBT-6 | `c087412` | Exactly as the roadmap intended: fixed the cause, not the five symptoms. DOM shape unchanged. |
| 13 | Verification gates made deterministic | PR-10 + A11Y-8 | DEBT-1, A11Y-8 | `6abea0c` | **Two planned items merged**, because both were "a gate that does not mean what it says". DEBT-9's artifact deletion moved to the docs commit. |
| 14 | Accessibility matrix extended | Next bucket | A11Y-6 | `eaf1dd4`, `7fac52d` | 316 audits, and it found three real defects — the point of the exercise. Surfaced A11Y-9. |
| 15 | CSS split by route group | PR-9 | PERF-2 | **none** | **No code, and correctly so.** Measurement retracted the finding as written before the L-effort, High-risk PR was written. The surviving binary split is on the roadmap. |
| 16 | PDF streaming | Next bucket | PERF-4 | **none** (one attempt reverted) | **No code, and correctly so.** `bufferPages: true` makes streaming structurally incapable of the claimed benefit; the incidental copy removal did not compile. |
| 17 | Upstream merge and undeclared token fix | — | DS-1 class | `a47ba64`, `7b1acba` | **Unplanned.** Both sides had rewritten the finance read layer. The assertion from change 7 caught an undeclared `--line-strong` in upstream code that upstream's own CI could not see. |
| 18 | Documentation | — | DEBT-9 | `0d856d7`, `51677e2`, `383ef87` | The audit itself, then two passes recording corrections, retractions and post-merge findings. The stale artifacts were deleted here. |
| 19 | Newsreader upright preload dropped | — | PERF-8 | `de7f841` | **Unplanned, after the squash merge**, and the only change here justified entirely by its own measurement. The finding it implements had its hypothesis inverted by that measurement and one of its headline numbers fail to reproduce, yet the change stands — because the reasoning it rests on is paired and same-machine. It also produced PERF-9. |

### What the decomposition got right, and wrong

**Right: the dependency claim.** The `globals.css` chain was real, was worked in the predicted order, and nothing outside it conflicted — the parallel-review framing held. Pairing A11Y-3 with DEBT-6 as a single change also worked exactly as predicted: extracting the primitive *was* the fix for the five forms.

**Wrong, in four ways.**

1. **It assumed one pass per finding.** RESP-1 took three and PERF-1 took two, in both cases because the first pass proved the finding had mis-scoped itself. A decomposition built from static reading inherits the reading's errors.
2. **It scheduled an L-effort, High-risk PR that should never have been written.** PR-9 was the largest item in the plan and the finding behind it did not survive measurement. Measuring first cost a fraction of the PR and produced a better finding (PERF-8) as a by-product — which, measured in turn, produced PERF-9. Two of the three most valuable performance findings in this document were generated by measuring the one that had to be withdrawn. Any plan containing a High-risk item justified by an unmeasured hypothesis should measure before it schedules.
3. **It could not schedule the eight findings that did not exist yet** — A11Y-8, A11Y-9, A11Y-10, ST-7, ST-8, RESP-4, PERF-8 and PERF-9. Six of the eight were found *while fixing or measuring something else*, and two of them outweigh every performance item in the original plan. Roughly a sixth of this document was written by implementing the rest of it.
4. **It mispredicted coupling in both directions.** Nothing anticipated that ST-1's `try`/`catch` would constrain how ST-7 could be fixed, or that a token assertion written for DS-1 would fire on an unrelated upstream merge. Conversely, the `globals.css` "continuous conflict" risk never materialised.

### Cross-cutting guidance, still current

- Every change must keep `npm run lint`, `npm run typecheck`, `npm run test:ci` and `regression:accessibility` green. Anything touching type sizes or layout additionally requires `regression:capture:responsive`.
- The surfaces `.21st/design.json` freezes (mobile auth, account menu, mobile calendar/attendance, mobile member directory) need a recorded design decision, not just a code review. The RESP-1 work produced one accepted trade-off (the 320px title wrap) and left one decision open (RESP-4); both are recorded above rather than in `design.json`, which is where they should eventually land.
- New token-enforcement assertions will fail on sites this audit did not enumerate. That is the point — treat new failures as scope, not as a broken test. This has now happened twice, once on this branch and once on upstream code.
- **Restore the `clean` and `stress` fixture databases from source before any full three-profile accessibility run.** Both are partially consumed, and `clean` is effectively single-use because its flow requires the head coach to be at first-time authenticator setup.
- If parallel workers share a tree, give them a scoped way to run `tsc` (or a separate `tsBuildInfoFile`) rather than forbidding it. Removing the type check to avoid a race hid a real compile error behind otherwise-correct runtime verification.
