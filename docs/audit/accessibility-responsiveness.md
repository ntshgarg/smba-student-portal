# SMBA Student Portal — Accessibility (WCAG 2.2 AA) and Responsiveness Audit

Independent audit, lens: **WCAG 2.2 AA accessibility, and responsiveness including touch targets
and breakpoints.** Repository `/Users/nitishg/smba-student-portal`, branch `audit/fresh-pass`,
HEAD `fa88c08`. Read-only pass; no application file was modified.

---

## 1. Method

### What I examined

| Area | Sources read |
|---|---|
| Focus outlines | All 17 `outline: none` / `outline: 0` sites plus every `:focus`, `:focus-visible` and `:focus-within` rule in `app/globals.css` (26 selectors), `app/public-home.css` (8), and the four CSS modules that remove outlines |
| The automated gate | `tests/e2e/playwright.accessibility.config.ts`, `accessibility-regression.spec.ts` (1,029 lines), `accessibility-sentinel.spec.ts`, `support/accessibility-audit.ts` (797 lines), `support/accessibility-matrix.ts`, plus the sibling `playwright.responsive-overflow.config.ts`, `accessibility-hardening.spec.ts` and `responsive-overflow.spec.ts` |
| axe rule semantics | `node_modules/axe-core/axe.js` v4.13.0 — read `targetSizeEvaluate`, `colorContrastEvaluate`, `colorContrastMatches`, `ariaProhibitedAttrEvaluate`, `getLabelledbyReviewKey`, `matchTags`, `ruleShouldRun`, and the `target-size` rule spec |
| Contrast | Resolved all 23 colour tokens from the single `:root` block, composited every `rgba()` / `color-mix()` text colour over its actual backdrop, computed WCAG relative-luminance ratios |
| WCAG 2.2 criteria | Every auth component (`login-form`, `pin-setup-form`, `two-factor-*`, `recovery-*`, `activation-form`, `account-security-workspace`, `authenticator-recovery-form`), plus the attendance, finance and directory surfaces |
| Responsiveness | All 20 breakpoint widths against `.21st/DESIGN.md`; the register scroll containers; sticky positioning; `scroll-padding`; the 24px target floor |

### How

Static analysis only: `rg` (respects `.gitignore`, so the stale `output/`, `snapshots/`, `tmp/`,
`test-results/` and `playwright-report/` copies were never read), scoped `find`, `sed -n`, and
`node -e` for contrast arithmetic and for AST-free JSX/CSS scanning. I did not start a dev server
and did not run Playwright.

Contrast numbers in this report are reproducible with:

```bash
node -e '
const hex=h=>{const s=h.replace("#","");const f=s.length===3?s.split("").map(c=>c+c).join(""):s;return [0,2,4].map(i=>parseInt(f.slice(i,i+2),16))};
const lum=c=>{const [r,g,b]=c.map(v=>{const s=v/255;return s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4});return 0.2126*r+0.7152*g+0.0722*b};
const ratio=(a,b)=>{const[x,y]=[lum(hex(a)),lum(hex(b))].sort((p,q)=>q-p);return (x+0.05)/(y+0.05)};
const over=(f,b,a)=>{const F=hex(f),B=hex(b);return "#"+F.map((v,i)=>Math.round(v*a+B[i]*(1-a)).toString(16).padStart(2,"0")).join("")};
console.log(ratio(over("#617083","#ffffff",0.72),"#ffffff").toFixed(2));   // 2.93
console.log(ratio(over("#596673","#f7f5f0",0.72),"#f7f5f0").toFixed(2));   // 3.06
'
```

I also ran the deterministic re-check the brief offered, correctly scoped:

```
$ 21st review app components lib --json
272 findings, all `design-hardcoded-color`; 4 files touched; 0 paths under output/
```

That is a token-hygiene rule outside this lens. Notably it reported **zero `focus-outline-none`
and zero `transition: all`** against real source, independently corroborating the retracted false
lead described in the brief. Direct grep agrees: `transition: all` does not appear anywhere in
`app`, `components` or `lib`.

The UX rules database (`~/.codex/skills/ui-ux-pro-max/scripts/search.py --domain ux`) returned
results for all four queries I ran (`touch target size minimum`, `focus visible indicator`,
`reflow 320px mobile table`, `error message form validation`). Its touch guidance is 44×44 with an
8px minimum gap — stricter than the WCAG 2.5.8 floor of 24×24, so I have judged against 2.5.8 and
noted 44px only where the codebase already targets it.

### What honestly needs a browser

I cannot see computed styles, real focus order, the accessibility tree, or rendered box sizes from
source. Specifically unresolved without a run:

- **Rendered target sizes.** A declared `min-height` is not a hit area; padding and line-height
  change it. Every 2.5.8 finding below is marked Medium at best and carries a repro command.
- **Whether `body { overflow-x: hidden }` clamps `document.documentElement.scrollWidth`.** The
  cascade is provable; the DOM measurement it produces is not (RESP-4).
- **Focus order and whether a focused element is actually obscured** after scrolling (RESP-2).
- **Whether specific axe rules return violation or incomplete on this DOM.** Where I make such a
  claim I have quoted the rule's evaluation source; where I have not read the source, I do not
  make the claim.

---

## 2. Focus-outline audit — all 17 sites

### The mechanism that decides most of these

Three rules govern the whole picture, and reading them in order is what makes the verdicts
determinate:

```1276:1279:app/globals.css
:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: 3px;
}
```

Specificity `(0,1,0)`. Any class-qualified `outline: 0` beats it.

```13691:13697:app/globals.css
/* Accessibility floor: component-specific reset rules must not suppress keyboard focus. */
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--red) !important;
  outline-offset: 2px;
}
```

This is at **top level** (the `@media (max-width: 600px)` opened at line 13587 closes at 13690) and
carries `!important`, so it defeats every non-important `outline` declaration in `globals.css`
*and* in every CSS Module, regardless of specificity or sheet order. I confirmed with
`rg -n "outline[^;]*!important" app components` that this is the **only** `!important` outline
declaration in the codebase, so nothing contests it.

Its scope is exactly `input`, `select`, `textarea`. It does **not** cover `button`, `a`, `summary`
or `[tabindex]` elements — which is why sites 2 and 7 below matter more than the rest.

The financials module documents its reliance on this explicitly:

```1768:1768:components/coach/financials/financials.module.css
   Keyboard focus is left to the global :focus-visible ring. */
```

### The table

| # | File | Line | Selector | Focus-visible replacement | Verdict |
|---|---|---|---|---|---|
| 1 | `app/globals.css` | 274 | `.coach-adjustment-field select, .coach-adjustment-reason input` | **Dedicated**, lines 280–283: `outline: 2px solid var(--red); outline-offset: 3px` | **PASS** — dedicated |
| 2 | `app/globals.css` | 3759 | `.coach-register-scroll` | **Dedicated**, lines 3764–3767: `outline: 2px solid var(--red); outline-offset: 4px` | **PASS** — dedicated; a `div`, so **outside the floor's scope**, protected only by this rule |
| 3 | `app/globals.css` | 4181 | `.coach-registration-approved p input` | **Dedicated**, lines 4189–4192: `outline: 2px solid var(--red); outline-offset: 3px` | **PASS** — dedicated |
| 4 | `app/globals.css` | 4240 | `.coach-member-search input` | No element rule. Wrapper `:focus-within` at 11488 (`inset 0 0 0 2px color-mix(in srgb, var(--navy) 18%, transparent)`) + global floor | **PASS** — via floor; wrapper cue is 1.45:1 (see RESP-3) |
| 5 | `app/globals.css` | 4275 | `.coach-member-filter select` | **None local.** Global floor `select:focus-visible !important` only | **PASS** — floor only |
| 6 | `app/globals.css` | 5412 | `.coach-report-field textarea:focus` (`outline: none` *inside* the `:focus` rule) | Mouse focus: `border-color: var(--navy)` + `background: var(--white)`. Keyboard: floor's `!important` overrides the `outline: none` | **PASS** — floor overrides |
| 7 | `app/globals.css` | 6988 | `.coach-assignment-guidance` | **Dedicated**, lines 6991–6994: `outline: 2px solid var(--red); outline-offset: 6px` | **PASS** — dedicated; a `div`, **outside the floor's scope** |
| 8 | `app/globals.css` | 8994 | `.coach-published-reports-search input` | Wrapper `:focus-within > div` at 9004: `border-color: var(--navy)` (17.33:1) + `box-shadow 0 0 0 2px rgba(8,28,66,0.08)` + floor | **PASS** — via floor; halo is 1.17:1, border is the real cue |
| 9 | `app/public-home.css` | 1346 | `.form-field input:focus, textarea:focus, select:focus` | **Dedicated**, lines 1349–1352: `outline: 2px solid var(--red); outline-offset: 2px` | **PASS** — dedicated |
| 10 | `components/coach/financials/financial-records.module.css` | 352 | `.searchInput input:not([type="checkbox"])` | Wrapper `.searchInput:focus-within` at 338: `outline: 2px solid var(--navy); outline-offset: 2px` + floor | **PASS** |
| 11 | `components/coach/announcements/announcements.module.css` | 886 | `.archiveSearch input` | Wrapper `.archiveSearch > div:focus-within` at 870: `outline: 2px solid var(--navy); outline-offset: 2px` + floor | **PASS** |
| 12 | `components/coach/financials/financials.module.css` | 421 | `.search input` | **None local.** Global floor only | **PASS** — floor only |
| 13 | `components/coach/financials/financials.module.css` | 996 | `.allocationInput input` | Wrapper `:focus-within` at 999: `border-color: var(--navy); box-shadow: var(--shadow-focus-ring)` + floor | **PASS** |
| 14 | `components/coach/financials/financials.module.css` | 1328 | `.field input, .field select, .field textarea` | `.field …:focus` at 1340–1343: `border-color: var(--navy)` + floor | **PASS** |
| 15 | `components/coach/financials/financials.module.css` | 2119 | `.balanceMoneyInput input` | Wrapper `:focus-within` at 2129: `border-color: var(--navy); box-shadow: 0 3px 0 -1px var(--navy)` + floor | **PASS** |
| 16 | `components/coach/financials/financials.module.css` | 2175 | `.balanceField input, select, textarea` | `:focus` at 2182–2184: `box-shadow: inset 0 -2px 0 var(--navy)` + floor | **PASS** |
| 17 | `components/coach/financials/financials.module.css` | 2332 | `.balanceAllocationInput input` | Wrapper `:focus-within` at 2340: `border-color: var(--navy); box-shadow: var(--shadow-focus-ring)` + floor | **PASS** |

### Verdict tally

**17 PASS, 0 FAIL.** By mechanism:

- **5** carry a dedicated element-level `:focus-visible` rule (#1, #2, #3, #7, #9)
- **7** are covered by a wrapper `:focus-within` cue (#4, #8, #10, #11, #13, #15, #17)
- **3** change `border-color` or `box-shadow` in a plain `:focus` rule (#6, #14, #16)
- **2** have no local indicator at all and depend entirely on the global `!important` floor
  (#5 `.coach-member-filter select`, #12 `.search input`)

This is a genuinely good result and I want to be precise about why: the floor at
`app/globals.css:13691` is a deliberate, commented, `!important` safety net, and it works. But its
scope is `input`/`select`/`textarea` only. Sites #2 and #7 are `div`s and fall outside it — they
are correct today purely because someone hand-wrote a matching rule. That is the resilience gap,
recorded as A11Y-9 rather than as a present defect.

---

## 3. Gate assessment

The gate is `tests/e2e/playwright.accessibility.config.ts` driving `accessibility-regression.spec.ts`
across three seeded profiles (`admin`, `clean`, `stress`).

### Scale, computed from the matrix

64 states; 32 flagged `compact: true`. Base viewports are 1440×900 (web), 820×1024 (tablet),
390×844 (mobile); `compact: true` adds 320×568. That is `64 × 3 + 32 = 224` matrix audits, plus
roughly 23 dynamic states (authenticator setup, TOTP verification, backup codes, PIN setup, six
activation states, password reset, recovery factors, head-coach setup) at 4 viewports each —
about 316 audits total, matching the brief.

### What genuinely blocks

`auditAccessibilityState` builds one `findings` array and the spec asserts it is empty
(`accessibility-regression.spec.ts:1026`). `findings` contains:

- axe **violations** under `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`
- DOM: missing title, missing `html[lang]`, `main` count ≠ 1, `h1` count ≠ 1, duplicate `id`s,
  broken ARIA `id` references across seven attributes, heading-level skips
- Layout: document horizontal overflow, interactive controls crossing the viewport edge,
  interactive controls whose centre is covered, touch targets under 24px (44px for primary and
  icon-only) at viewports ≤ 820, form-control font under 16px at ≤ 430, animations still running
  under reduced motion at ≤ 430
- Interaction: focus moved to the first invalid field, invalid field has `aria-describedby`,
  a visible `role="alert"` accompanies invalidity, dialog focus trap, Escape closes a dialog
- Keyboard: skip link is the first tab stop, activating it moves focus to its target, sampled
  focus stops have a visible indicator, some focusable content exists

This is well beyond a plain axe wrapper, and several of these checks reach criteria axe cannot.

### What it collects and then discards

```46:58:tests/e2e/support/accessibility-audit.ts
export type AccessibilityResult = {
  actor: AccessibilityActor
  // Reported and never asserted on. The gate fails on findings alone.
  advisories?: AccessibilityAdvisory[]
```

Three advisory categories are produced and never asserted:

- `needs-review` — axe **`incomplete`** under the WCAG tags (`accessibility-audit.ts:653`)
- `best-practice` — axe violations under the `best-practice` tag (`:613`)
- `best-practice-needs-review` — axe incomplete under `best-practice` (`:614`)

The harness is honest about this in its own summary text (`:723–725`) and its comment at line 23
correctly names `region`, `landmark-one-main`, `landmark-unique` and `aria-allowed-role` as
best-practice-only. It also compensates for part of that loss with its own DOM checks for `main`
count, `h1` count and heading order. The design is deliberate. It is still the largest hole, and
the sections below quantify what falls through it.

### Rule-tag filtering, verified against axe source

Two things I checked rather than assumed, because both are easy to get wrong:

**`target-size` is disabled by default but the harness does run it.** The rule spec carries
`enabled: false`:

```33491:33496:node_modules/axe-core/axe.js
      id: 'target-size',
      impact: 'serious',
      selector: '*',
      enabled: false,
      matches: 'widget-not-inline-matches',
      tags: [ 'cat.sensory-and-visual-cues', 'wcag22aa', 'wcag258' ],
```

but `matchTags` only consults `rule.enabled` when the include list is empty:

```20558:20563:node_modules/axe-core/axe.js
      var matching = include.some(function(tag) {
        return rule.tags.indexOf(tag) !== -1;
      });
      if (matching || include.length === 0 && rule.enabled !== false) {
        return exclude.every(function(tag) {
          return rule.tags.indexOf(tag) === -1;
        });
```

Naming `wcag22aa` explicitly makes `matching` true, so the rule runs. Anyone auditing this
codebase should not report "target-size is disabled" — it is not.

**`target-size` is the only `wcag22aa` rule that exists.** `axe.getRules(["wcag22aa"])` returns
exactly one rule. Of the six new WCAG 2.2 AA criteria, axe 4.13.0 automates one, partially.

**Five WCAG A/AA-tagged rules are silently excluded as experimental.** `tagExclude` defaults to
`[ 'experimental', 'deprecated' ]` (`axe.js:29654`), and `matchTags` subtracts it from any include
list. The excluded rules that carry WCAG A/AA tags are `css-orientation-lock` (1.3.4),
`label-content-name-mismatch` (2.5.3), `p-as-heading` (1.3.1), `table-fake-caption` (1.3.1) and
`td-has-header` (1.3.1). The last two apply directly to this app's wide attendance and finance
registers.

### The `incomplete` paths that matter here

I read the two rules most likely to matter and confirmed exactly when they return `undefined`
(incomplete) rather than `false` (violation).

**`target-size`** — an undersized target that is not in the tab order is *incomplete*, not a
violation:

```25691:25697:node_modules/axe-core/axe.js
      var negativeOutcome = _isInTabOrder(vNode) ? false : void 0;
      if (!hasMinimumSize(nodeRect)) {
        this.data(_extends({
          minSize: minSize
        }, toDecimalSize(nodeRect)));
        return negativeOutcome;
      }
```

Its `contentOverflow` and `tooManyRects` branches also return `void 0`. So any 2.5.8 problem on a
non-tabbable target, or on a target whose content overflows it, lands in advisories.

**`color-contrast`** — six distinct incomplete paths, ending in:

```27294:27299:node_modules/axe-core/axe.js
      if (fgColor === null || bgColor === null || equalRatio || shortTextContent && !ignoreLength && !isValid) {
        missing = null;
        incomplete_data_default.clear();
        this.relatedNodes(bgNodes);
        return void 0;
      }
```

An unresolvable background (gradient, image, an overlapping ancestor) and *single-character text*
both become incomplete. This app has a decorative orthographic court graphic behind both heroes and
uses single-character status marks in the attendance calendars — both are exactly these paths.

**`aria-prohibited-attr`** — this is the trap the brief named, and the source confirms it:

```27911:27917:node_modules/axe-core/axe.js
      var textContent = subtree_text_default(virtualNode, {
        subtreeDescendant: true
      });
      if (sanitize_default(textContent) !== '') {
        return void 0;
      }
      return true;
```

An `aria-label` on a role-less element **with** text content returns incomplete. Every one of the
13 real instances in this codebase (A11Y-5) has text content, so none of them can ever fail the
gate.

### Blind spots that follow

1. **Everything marked `incomplete` is invisible.** Including all of the above.
2. **`::placeholder` contrast is unreachable by any rule.** `colorContrastMatches` returns `true`
   for form elements, then `colorContrastEvaluate` reads the element's own computed `color`. There
   is no reference to `::placeholder` anywhere in axe's contrast logic — `findPseudoElement` checks
   only `:before` and `:after`. Two proved failures (A11Y-1) sit in this gap.
3. **32 of 64 states are never audited at 320 CSS pixels**, so 1.4.10 Reflow is unverified for
   them. The list includes every wide-table surface: `coach-player-attendance-register`,
   `coach-staff-attendance-register`, `coach-monthly-fees`, `coach-registration-fees`,
   `coach-collections`, `coach-financial-activity`, plus `coach-dashboard`, `coach-calendar`,
   `coach-schedules`, `coach-members-*`, `player-dashboard`, `player-financials`, `public-home`
   and the admin directory. (Partially mitigated by the separate `responsive-overflow.spec.ts` —
   see A11Y-3.)
4. **Focus order is never checked.** The keyboard pass verifies the skip link is first and that
   indicators exist; it never asserts that DOM order matches visual order. WCAG 2.4.3 is untested.
5. **Focus-indicator sampling stops after 6 controls** (`accessibility-audit.ts:562`,
   `index < 12 && inspected < 6`). On an authenticated page the first six stops are the skip link
   and header chrome, so no attendance, finance or directory control is ever sampled.
6. **The gate never exercises client-side navigation.** Every state is reached with
   `page.goto()` (`accessibility-regression.spec.ts:377`), a full document load. Next's App Router
   `<Link>` transitions are never driven, so route-change focus behaviour cannot be observed
   (A11Y-6).
7. **`dialog-focus-restoration` can never fire** — it is gated on
   `[data-accessibility-dialog-opener="true"]`, an attribute that does not exist in application
   source (A11Y-4).
8. **Layout checks run only at document scroll position 0.** `auditCurrentPage` calls
   `window.scrollTo(0, 0)` before auditing (`:302`), so 2.4.11 Focus Not Obscured — which is by
   definition about what happens after scrolling under a sticky header — cannot be detected.
9. **`target-size` runs only at 24px minimum and the harness's own touch check runs only at
   ≤ 820px viewports** (`accessibility-audit.ts:358`). 2.5.8 applies at every viewport (RESP-1).
10. **Reduced motion is emulated for every audit** (`reducedMotion: "reduce"`, `:254`), so the
    default-motion state is never audited; and the animation check itself only runs at ≤ 430px and
    only inspects `animationName`/`animationDuration`, never `transition`.

### WCAG 2.2 AA criteria the gate cannot reach

| Criterion | Gate coverage |
|---|---|
| 2.4.11 Focus Not Obscured (Min) | **None** — no axe rule; harness audits only at scroll 0 |
| 2.5.7 Dragging Movements | **None** — no axe rule (not applicable here; see A11Y-11) |
| 2.5.8 Target Size (Min) | Partial — `target-size` runs, but non-tabbable failures are incomplete; harness check is ≤ 820px only |
| 3.2.6 Consistent Help | **None** |
| 3.3.7 Redundant Entry | **None** |
| 3.3.8 Accessible Authentication (Min) | **None** |
| 1.4.10 Reflow | Partial — document overflow only, and only for the 32 compact states |
| 1.4.12 Text Spacing | **None** |
| 2.4.3 Focus Order | **None** |
| 4.1.3 Status Messages | Partial — only checks that an `[aria-invalid]` field is accompanied by a visible `role="alert"` |

---

## 4. Findings

### A11Y-1 — Two search placeholders fail 1.4.3 at 2.93:1 and 3.06:1

- **Classification:** WCAG 1.4.3 Contrast (Minimum), Level AA
- **Type:** Objective defect
- **Severity:** Medium
- **Location:**
  - `app/globals.css:9001` — `.coach-published-reports-search input::placeholder`
  - `components/coach/financials/financials.module.css:428` — `.search input::placeholder`
- **Evidence:**

```9000:9002:app/globals.css
.coach-published-reports-search input::placeholder {
  color: rgba(97, 112, 131, 0.72);
}
```

  Backdrop is `.coach-published-reports-search > div { background: var(--white) }`
  (`app/globals.css:8981`). Compositing `rgb(97,112,131)` at α 0.72 over `#ffffff` gives `#8d98a6`.
  Ratio against `#ffffff` = **2.93:1**. Input font-size is 16px normal weight
  (`app/globals.css:8998`), so AA requires 4.5:1.

```427:429:components/coach/financials/financials.module.css
.search input::placeholder {
  color: color-mix(in srgb, var(--steel) 72%, transparent);
}
```

  Backdrop is `.search { background: var(--ivory) }` (`financials.module.css:406`). `--steel` is
  `#596673`; at 72% over `#f7f5f0` that is `#858e96`. Ratio = **3.06:1**. Input font-size is 16px
  (`:422`). AA requires 4.5:1.

  For contrast, the other five placeholder rules all pass: `--text-placeholder` `#6b7480` on the
  login input's composited `#fcfcfa` background is 4.61:1 and on `--paper` is 4.54:1; `--steel` is
  5.88:1 on white and 5.39:1 on ivory; `#667387` on white is 4.81:1.
- **Why it matters:** The placeholder is the only place the *accepted input format* appears. The
  associated `.sr-only` labels say "Find a player by name or Academy ID" and "Search players"; the
  placeholders say "Name or Academy ID" and "Name, Academy ID or fee reference". A sighted user who
  cannot resolve 2.93:1 loses the format hint entirely.
- **User impact:** Head coach on the Published Reports archive and the Record Payment finder,
  in bright courtside light or with age-related contrast loss, cannot read what the search box
  accepts. Also affects any low-vision user without magnification.
- **Effort:** S
- **Confidence:** High (proved — arithmetic over literal values, both sides resolved)
- **How to prove:** Already proved. The `node -e` snippet in §1 reproduces both numbers.

---

### A11Y-2 — The gate discards every axe `incomplete`, and placeholder contrast is unreachable by any axe rule

- **Classification:** Gate coverage
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `tests/e2e/support/accessibility-audit.ts:48-49`, `:652-655`, `:609-615`
- **Evidence:**

```650:655:tests/e2e/support/accessibility-audit.ts
  // Both advisory sets are collected before the checks below move focus and
  // scroll the page, so they describe the same state the blocking pass saw.
  const advisories = [
    ...axeAdvisories("needs-review", axe.incomplete),
    ...await bestPracticeAdvisories(page),
  ]
```

  `advisories` is never asserted; the spec's only content assertion is
  `expect(failures, …).toEqual([])` at `accessibility-regression.spec.ts:1026`, over `findings`.

  Combined with the axe source quoted in §3, this means: undersized non-tabbable targets,
  unresolvable-background contrast, single-character-text contrast, all `aria-prohibited-attr`
  cases with text content, and every landmark rule (`region`, `landmark-one-main`,
  `landmark-unique`, `aria-allowed-role`, all `best-practice`-only) are collected and thrown away.

  Independently, `::placeholder` is invisible to axe at any severity. `colorContrastMatches`
  returns `true` for `input`/`select`/`textarea` (`axe.js:27141-27146`), then
  `colorContrastEvaluate` calls `_getForegroundColor(node, …)` on the element's computed `color`.
  `rg -n "placeholder" node_modules/axe-core/axe.js` returns only `aria-placeholder` and
  `non-empty-placeholder` matches — nothing in the contrast path. A11Y-1 is the demonstration.
- **Why it matters:** A green gate is being read as "WCAG 2.2 AA clean". It means "no blocking
  finding", which is a narrower claim than the CI job name "UI accessibility / WCAG 2.2 AA"
  suggests.
- **User impact:** Indirect but compounding — every defect in this class ships, and each passing
  run reinforces the belief that none exist.
- **Effort:** M
- **Confidence:** High (proved from harness and axe-core source)
- **How to prove:** Already proved. To quantify the live cost, run the gate once and read the
  advisory counts it already prints:
  `SMBA_ACCESSIBILITY_PROFILE=stress npm run regression:accessibility` then
  `sed -n '/Non-blocking advisories/,$p' output/accessibility/stress/summary.sanitized.txt`.

---

### A11Y-3 — Half the state matrix, including every wide-table surface, is never audited at 320 CSS pixels

- **Classification:** Gate coverage / WCAG 1.4.10 Reflow
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `tests/e2e/support/accessibility-matrix.ts` — `compact?: boolean` at `:59`,
  consumed at `:581-585`
- **Evidence:**

```581:585:tests/e2e/support/accessibility-matrix.ts
export function viewportsForState(state: AccessibilityState): readonly AccessibilityViewport[] {
  return state.compact
    ? [...accessibilityViewports, compactAccessibilityViewport]
    : accessibilityViewports
}
```

  Counting the matrix: 64 states, 32 with `compact: true`. The 32 without it, and therefore never
  seen at 320×568:

  `public-home`, `public-mobile-navigation`, `not-found`, `admin-dashboard`, `admin-search`,
  `public-announcement-detail`, `coach-dashboard`, `coach-profile-menu`, `coach-onboarding`,
  `coach-members-filters`, `coach-members-details`, `coach-calendar`, `coach-schedules`,
  `coach-player-attendance-register`, `coach-staff-attendance-register`, `coach-announcements`,
  `coach-announcement-detail`, `coach-reports`, `coach-report-publication`, `coach-monthly-fees`,
  `coach-registration-fees`, `coach-collections`, `coach-financial-activity`,
  `admin-populated-directory`, `admin-populated-search`, `junior-coach-dashboard`,
  `junior-coach-attendance-register`, `player-dashboard`, `player-report`, `player-financials`,
  `player-announcements`, `player-announcement-detail`.

  The selection looks inverted relative to risk: the compact flag is on short auth forms and off
  the dense operational registers.

  **Mitigating control, which I verified:** `tests/e2e/responsive-overflow.spec.ts` runs at 320,
  360, 390 and 430 plus two landscape sizes, and separately asserts that the finance table wrappers
  own their horizontal scrolling (`:141-162`) and that the player attendance calendar fits at 320
  (`:281-308`). So reflow is not unguarded — it is guarded by a different suite with narrower
  route coverage (two finance routes and the player calendar), and the a11y gate's own 320px checks
  (touch target, 16px font, reduced motion, covered controls, ARIA) still do not run on these 32
  states.
- **Why it matters:** 1.4.10 is specified at 320 CSS pixels. So are the harness's own
  `mobileFontControls` (≤ 430) and `reducedMotionAnimations` (≤ 430) checks, which therefore never
  run against the coach dashboard, calendar, schedules, member directory or any register.
- **User impact:** Coach on a small phone (or any phone at 200% browser zoom, which is
  equivalent to a 320px layout viewport at 640px physical) marking attendance courtside; a parent
  reading fee status on an older handset.
- **Effort:** S to add the flag; M to fix whatever it surfaces
- **Confidence:** High (proved by counting the matrix)
- **How to prove:** Already proved for coverage. For behaviour:
  `SMBA_ACCESSIBILITY_STATE=coach-monthly-fees SMBA_ACCESSIBILITY_PROFILE=stress npm run regression:accessibility`
  after adding `compact: true` to that state.

---

### A11Y-4 — The dialog focus-restoration assertion can never execute

- **Classification:** Gate coverage / focus management
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `tests/e2e/support/accessibility-audit.ts:475`, `:509-516`
- **Evidence:**

```509:516:tests/e2e/support/accessibility-audit.ts
    } else if (await opener.count() && !await opener.evaluate((element) => element === document.activeElement)) {
      findings.push(finding({
        id: "dialog-focus-restoration",
        impact: "serious",
        message: "Closing the dialog did not restore focus to its trigger.",
        source: "interaction",
      }))
    }
```

  `opener` is `page.locator('[data-accessibility-dialog-opener="true"]').first()` (`:475`).

```
$ rg -n "data-accessibility-dialog-opener|accessibilityDialogOpener" app components
(no matches)
```

  So `await opener.count()` is always 0 and the branch is dead. The app has three real dialogs:
  `components/coach/announcements/announcement-detail.tsx:84`,
  `components/coach/reports/report-workspace.tsx:152`,
  `components/coach/announcements/announcement-composer.tsx:126`. Three matrix states open them
  (`coach-announcement-review`, `coach-announcement-withdraw`, `coach-write-report`).

  The sibling focus-trap and Escape-closes checks do not depend on the attribute and do run.
- **Why it matters:** A written, named, `serious`-impact assertion reads as coverage in review but
  provides none. Focus restoration after dialog close is the single most common modal defect.
- **User impact:** Head coach using a screen reader or keyboard publishes an announcement, closes
  the review dialog, and lands at the top of the document instead of back on the trigger — with no
  test that would catch the regression.
- **Effort:** S
- **Confidence:** High (proved — grep for two plausible spellings, both absent)
- **How to prove:** Already proved.

---

### A11Y-5 — Thirteen role-less elements carry `aria-label`, which ARIA prohibits and axe cannot fail

- **Classification:** WCAG 4.1.2 Name, Role, Value / ARIA
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** all 13 sites —
  - `components/login-form.tsx:132` — `<div className="login-method-switch" aria-label="Login method">`
  - `components/coach/staff-attendance-register.tsx:147` — see A11Y-7, the most consequential
  - `components/dashboard/player-attendance-card.tsx:331` — `.player-attendance-calendar-schedules`, "Assigned sessions in the selected month"
  - `components/coach/reports/report-workspace.tsx:702` — `.coach-report-month-control`, "Choose report month"
  - `components/coach/reports/report-workspace.tsx:748` — `.coach-category-filter`, "Filter players by programme category"
  - `components/financials/player-fee-record.tsx:577` — `.monthCell`, `` `${formatBillingPeriod(period)}: …` ``
  - `components/coach/attendance-adjustments-workspace.tsx:600` — `.coach-adjustment-missed-calendar-grid`
  - `components/coach/attendance-adjustments-workspace.tsx:746` — `.coach-adjustment-transfer`, "Attendance adjustment summary"
  - `components/coach/staff-attendance-register.tsx:108` — `.coach-year-selector`, "Choose attendance year"
  - `components/coach/announcements/announcement-archive.tsx:95` — `.monthControl`, "Choose announcement month"
  - `components/coach/dashboard-card.tsx:98` — `.summary`, `aria-label={ariaLabel}`
  - `app/(public)/page.tsx:274` — `.next-steps`, `aria-labelledby="next-steps-title"`
  - `app/setup/head-coach/page.tsx:47` — `.login-brand`, "Sathiya Moorthy Badminton Academy"
- **Evidence:** A `<div>` with no `role` resolves to the ARIA `generic` role, which prohibits
  `aria-label` and `aria-labelledby`. Assistive technology drops the name; the label is inert.

  I scanned exhaustively (a JSX opening-tag scan over every `.tsx` in `app` and `components`, for
  `div|span|p|b|i|em|strong|small|pre|blockquote|q|cite|code|samp|kbd|sub|sup` carrying
  `aria-label`/`aria-labelledby` and no `role`) rather than eyeballing, because the codebase gets
  this right far more often than not: `role="group"`, `role="grid"`, `role="gridcell"`,
  `role="progressbar"`, `role="status"` and `role="region"` are all used correctly elsewhere, and
  `<ul>`/`<ol>` (implicit role `list`) legitimately accept `aria-label`.

  Per the `ariaProhibitedAttrEvaluate` source quoted in §3, each of these returns **incomplete**
  because every one has descendant text — for example `login-method-switch` contains the strings
  "Password" and "6-digit PIN". None can ever fail the gate.
- **Why it matters:** Each is a deliberate attempt to name a group that silently does nothing.
  `login-method-switch` is a two-option credential picker with no accessible group name;
  `coach-category-filter` and `coach-report-month-control` are toolbars of `aria-pressed` buttons
  with no context.
- **User impact:** Screen-reader users across all four roles hear a bare sequence of buttons with
  no indication that they form one control group — worst on the login page, where the choice
  between password and PIN determines which field appears next.
- **Effort:** S (add `role="group"`, or use `<fieldset><legend>` where a form grouping is meant)
- **Confidence:** High (proved — the prohibition is normative ARIA; the incomplete verdict is read
  from axe source)
- **How to prove:** Already proved statically. To see the AT behaviour: VoiceOver + Safari on
  `/login`, `VO + →` through the method switch and confirm "Login method" is never announced.

---

### A11Y-6 — No focus management or announcement on client-side route change, and the gate cannot see it

- **Classification:** WCAG 2.4.3 Focus Order (and 4.1.3 for the announcement)
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `components/app-shell.tsx:37`; absent across all layouts; gate at
  `tests/e2e/accessibility-regression.spec.ts:377`
- **Evidence:** `AppShell` renders the target but nothing moves focus to it on navigation:

```37:37:components/app-shell.tsx
      <main id="main-content" tabIndex={-1}>{children}</main>
```

  `usePathname` is imported in seven components
  (`components/reports/report-accordion.tsx`, `coach/player-attendance-register.tsx`,
  `coach/onboarding/player-onboarding-register.tsx`, `dashboard/player-attendance-card.tsx`,
  `coach/junior-coach-attendance-card.tsx`, `coach/calendar/session-calendar.tsx`,
  `coach/members/member-directory.tsx`) and in every case is used to rebuild a URL for
  `router.replace`, never to reset focus. There is no `usePathname` in any layout, in `app-shell`,
  or in `route-recovery.tsx`. There is no route-level live region.

  Within components, focus management is extensive — 94 `.focus()` call sites across 40 files. The
  gap is specifically at the router boundary.

  The gate cannot observe it because every state is reached by full page load:

```377:377:tests/e2e/accessibility-regression.spec.ts
      await page.goto(state.route, { waitUntil: "domcontentloaded" })
```

  The interaction helpers do click (`accessibility-interactions.ts`), but on disclosures and
  dialogs within a page, not on `<Link>` transitions between routes.
- **Why it matters:** In the App Router a `<Link>` swaps the DOM without a document load. Focus
  stays on the activated link — which is often removed — so it falls to `<body>`, and the screen
  reader announces nothing. With 46 routes and heavy inter-page linking (dashboard cards to
  attendance, reports, financials; "Back to dashboard" everywhere) this is the app's most-travelled
  interaction.
- **User impact:** Any keyboard or screen-reader user in the portal. A coach tabbing from the
  dashboard Attendance card into the register has to Tab back through the entire header to reach
  the content they just navigated to, with no announcement that the page changed.
- **Effort:** M
- **Confidence:** Medium (strong static inference — the absence is proved; the resulting focus
  position needs a browser)
- **How to prove:** With a dev server on a port other than 3000:
  `npx playwright open http://127.0.0.1:3001/coach`, sign in, then in the console
  `document.querySelector('a[href="/coach/attendance/players/register"]').click()` followed by
  `document.activeElement` — expect `<body>`.

---

### A11Y-7 — The staff attendance scroll region has no `role`, so its label is dropped; the player register next door has one

- **Classification:** WCAG 4.1.2 Name, Role, Value / WCAG 2.1.1 Keyboard
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `components/coach/staff-attendance-register.tsx:147-153`
- **Evidence:**

```147:153:components/coach/staff-attendance-register.tsx
            <div
              className="coach-register-scroll staff-register-scroll"
              ref={registerScrollRef}
              onScroll={handleRegisterScroll}
              tabIndex={0}
              aria-label={`Scrollable junior coach attendance register for ${activeYear}`}
            >
```

  The equivalent player register is correct:

```263:269:components/coach/player-attendance-register.tsx
                <div
                  className="coach-register-scroll"
                  ref={registerScrollRef}
                  onScroll={handleRegisterScroll}
                  tabIndex={0}
                  role="region"
                  aria-label="Scrollable annual player attendance register"
                >
```

  Both are `tabIndex={0}` focusable scroll containers, so axe's `scrollable-region-focusable`
  (wcag2a) passes for both. The difference is the missing `role="region"`: without it the div is
  `generic`, `aria-label` is prohibited, and the name is discarded. Because the div's subtree is
  the whole table, `aria-prohibited-attr` returns incomplete (per §3) and the gate stays green.
- **Why it matters:** This is the one case in the 13 where the missing role removes a name from
  something a keyboard user will definitely land on — a tab stop whose entire purpose is to be
  scrolled. The asymmetry with the player register shows the correct pattern was known and simply
  not applied here.
- **User impact:** Head coach using a screen reader Tabs into the staff roll-call register and
  hears nothing that identifies it — no name, no role — just an unlabelled focus stop before a
  large table.
- **Effort:** S — add `role="region"` to match line 268 of the player register
- **Confidence:** High (proved — both files read directly)
- **How to prove:** Already proved.

---

### A11Y-8 — Five WCAG A/AA axe rules are excluded as experimental, including two that target this app's registers

- **Classification:** Gate coverage
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `tests/e2e/support/accessibility-audit.ts:15-21` (tag list);
  `node_modules/axe-core/axe.js:29654` (`tagExclude`), `:20543` and `:20555` (subtraction)
- **Evidence:**

```29654:29654:node_modules/axe-core/axe.js
          this.tagExclude = [ 'experimental', 'deprecated' ];
```

  `matchTags` subtracts `tagExclude` from any include list that does not itself name those tags.
  Cross-referencing `axe.getRules(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"])` — 70 rules
  match the harness's tags — five carry `experimental` and are therefore dropped:

  | Rule | WCAG |
  |---|---|
  | `css-orientation-lock` | 1.3.4 |
  | `label-content-name-mismatch` | 2.5.3 |
  | `p-as-heading` | 1.3.1 |
  | `table-fake-caption` | 1.3.1 |
  | `td-has-header` | 1.3.1 |

- **Why it matters:** `td-has-header` and `table-fake-caption` are precisely the 1.3.1 rules for
  large data tables, and this app's core surfaces are large data tables — the annual attendance
  registers and the finance registers. `label-content-name-mismatch` (2.5.3) matters because the
  app uses `aria-label` on buttons whose visible text differs.
- **User impact:** Screen-reader users navigating the attendance registers cell-by-cell depend on
  header association to know which date and which player a cell belongs to; nothing currently
  checks it.
- **Effort:** S to enable (`.options({ rules: { 'td-has-header': { enabled: true } } })` or add
  `experimental` to the include list); unknown to fix what it finds
- **Confidence:** High (proved from axe source and rule metadata)
- **How to prove:** Already proved for exclusion.

---

### A11Y-9 — The `!important` focus floor covers only `input`/`select`/`textarea`, leaving buttons, links and `tabindex` divs on hand-written rules

- **Classification:** Focus management / WCAG 2.4.7 Focus Visible (regression resilience)
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:** `app/globals.css:13691-13697`; exposed sites `app/globals.css:3759` and
  `app/globals.css:6988`
- **Evidence:** The floor's selector list is `input:focus-visible, select:focus-visible,
  textarea:focus-visible`. The only other safety net is `:focus-visible` at `app/globals.css:1276`
  with specificity `(0,1,0)`, which loses to any class-qualified rule.

  Two of the 17 outline-removal sites are already outside the floor: `.coach-register-scroll`
  (a `tabIndex={0}` div) and `.coach-assignment-guidance` (a div). Both are correct today only
  because lines 3764 and 6991 exist. Delete either and the outline removal at 3759 / 6988 wins
  over `:focus-visible` at 1276, and the focus ring disappears with no test failure — the gate's
  keyboard pass samples only the first six tab stops (`accessibility-audit.ts:562`), and neither
  element is in the first six on its page.
- **Why it matters:** The floor is a good pattern that stops one class of regression. Widening its
  selector list to `:is(a, button, summary, [tabindex], [role="button"])` would close the rest for
  the same one-line cost.
- **User impact:** No user is affected today. This is about the next change to these files.
- **Effort:** S
- **Confidence:** High (proved by cascade analysis; the "no test failure" claim follows from the
  sampling cap read from source)
- **How to prove:** Already proved.

---

### A11Y-10 — `autocomplete="off"` on the PIN field removes password-manager assistance from that credential path

- **Classification:** WCAG 3.3.8 Accessible Authentication (Minimum), Level AA — new in 2.2
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `components/login-form.tsx:110`
- **Evidence:**

```105:117:components/login-form.tsx
        <input
          className="login-pin-input"
          id="pin"
          name="pin"
          type="password"
          autoComplete="off"
          inputMode="numeric"
          pattern="[0-9]{6}"
          minLength={6}
          maxLength={6}
          required
          aria-describedby="pin-help"
        />
```

  This is the only credential field in the app that opts out. Every other one declares a useful
  token: `current-password` (`login-form.tsx:71`, `two-factor-setup-form.tsx:29`,
  `two-factor-reconnect-form.tsx:32`, `account-security-workspace.tsx:134`), `new-password`
  (`pin-setup-form.tsx:40,61`, `activation-form.tsx:34,53`, `recovery-reset-forms.tsx:78,87`),
  `one-time-code` (`two-factor-verification-form.tsx:55,78`, `two-factor-setup-form.tsx:76`,
  `two-factor-reconnect-form.tsx:44`, `recovery-reset-forms.tsx:48`,
  `recovery-email-enrollment-form.tsx:62`), `username` and `email` on the recovery forms.

  `rg -n "onPaste" app components lib` returns nothing, so paste is never blocked anywhere — the
  other half of 3.3.8 is satisfied throughout.
- **Why it matters:** 3.3.8 requires that a cognitive function test either be avoidable or be
  supported by a mechanism that assists. The PIN is recall of a memorised six-digit number and the
  field blocks the standard assist. The flow as a whole is arguably still conformant, because the
  password method is a genuine alternative reachable from the same page and the helper text says so
  (`login-form.tsx:118`, "Forgot your PIN? Use your password instead."), and the password field
  does support autofill. I am reporting it as Low rather than as a clear failure for that reason —
  but the PIN path taken alone does not meet the criterion, and PIN setup is mandatory
  (`/auth/pin/setup` is forced after first login), so every user is asked to memorise one.
- **User impact:** Users with memory or executive-function impairment, and older parents, who rely
  on a password manager and are pushed onto the slower password path each time.
- **Effort:** S — `autoComplete="current-password"` (or a dedicated saved entry) makes the PIN
  path fillable
- **Confidence:** High (proved — the attribute is read directly; the conformance judgement is
  stated with its reasoning)
- **How to prove:** Already proved.

---

### A11Y-11 — 2.5.7 Dragging Movements is not applicable: no drag interaction exists

- **Classification:** WCAG 2.5.7 Dragging Movements, Level AA — new in 2.2
- **Type:** Objective defect *(reported as verified-conformant, no action)*
- **Severity:** Low
- **Location:** whole codebase
- **Evidence:** I searched `app` and `components` for
  `onDragStart`, `onDrag`, `draggable`, `onPointerDown`, `onTouchMove`, `onTouchStart`,
  `onMouseMove`, `type="range"`, `dnd`, `sortable` — **zero matches**. Every stateful control is a
  `<button>`, `<a>`, `<input>`, `<select>` or `<textarea>`. Horizontal scrolling in the registers
  is native container scroll, which is explicitly excluded from 2.5.7, and both registers are
  keyboard-reachable via `tabIndex={0}`.
- **Why it matters:** Recording it prevents the next audit from re-opening the question, and flags
  the constraint to preserve: if a drag-to-reorder or swipe-to-mark interaction is ever added to
  the attendance recorder, 2.5.7 requires a single-pointer alternative from day one.
- **User impact:** None today. Users with tremor or limited dexterity are currently well served.
- **Effort:** S (documentation only)
- **Confidence:** High (proved — search terms listed above)
- **How to prove:** Already proved.

---

### RESP-1 — The 24px target floor exists only below 820px, leaving the same controls under 24px at desktop widths where 2.5.8 still applies

- **Classification:** WCAG 2.5.8 Target Size (Minimum), Level AA — new in 2.2
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `app/globals.css:13699-13708` (the floor); `app/globals.css:6951-6958`
  (`.coach-slot-day`); `app/globals.css:4217-4244` (`.coach-member-search input`)
- **Evidence:**

```13699:13708:app/globals.css
@media (max-width: 820px) {
  .coach-member-search input,
  .coach-member-filter select {
    min-height: 24px;
  }

  .coach-slot-day {
    min-height: 24px;
  }
}
```

  Outside that query, `.coach-slot-day` has no height floor at all:

```6951:6958:app/globals.css
.coach-slot-day {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--navy);
  font-size: 13px;
  font-weight: 700;
}
```

  It is a `<label>` wrapping an 18×18 checkbox
  (`components/coach/calendar/session-create.tsx:277-278`; `app/globals.css:6960-6963`). With
  `body { line-height: 1.6 }` (`app/globals.css:1250`), 13px text renders about 20.8px tall, so the
  flex row is roughly 20.8px — under 24 — at every viewport above 820px.

  `.coach-member-filter select` does carry an unconditional floor at `app/globals.css:4271`, with a
  comment showing the author had already reasoned about exactly this:

```4271:4271:app/globals.css
  min-height: 24px;
```

  `.coach-member-search input` has no such base floor; its wrapper is 68px but the input's own box
  is intrinsic.

  The gate cannot catch it: its touch-target check is gated on viewport width.

```357:359:tests/e2e/support/accessibility-audit.ts
    const touchTargets: DomAudit["touchTargets"] = []
    if (viewportWidth <= 820) {
      for (const control of controls) {
```

  So the 24px floor exists exactly where the gate looks, and is absent exactly where it does not.
  axe's `target-size` does run at 1440, but `.coach-slot-day` is a `<label>`, not a widget, so
  `widget-not-inline-matches` selects the inner 18×18 checkbox — which *is* in the tab order and
  would return `false` (a violation) rather than incomplete. Whether the wrapping label's box is
  credited instead depends on axe's rect resolution, which I have not traced far enough to assert.
- **Why it matters:** 2.5.8 is viewport-independent — it applies to mouse and stylus on a desktop
  just as much as to touch. A 20.8px weekday checkbox in the Create Schedule form is below the
  floor for everyone.
- **User impact:** Head coach creating a recurring schedule on a laptop with a trackpad, or anyone
  with a hand tremor, mis-clicking between adjacent weekday checkboxes — which silently changes
  which sessions exist for the year.
- **Effort:** S — move the three declarations out of the media query
- **Confidence:** Medium (strong static inference — the CSS and the gate's viewport condition are
  proved; the 20.8px rendered height is computed, not measured)
- **How to prove:** With a dev server on a spare port, at 1440×900 on `/coach/schedules/new`:
  `document.querySelectorAll('.coach-slot-day').forEach(e => console.log(e.getBoundingClientRect().height))`
  — expect values below 24.

---

### RESP-2 — Horizontally scrolling registers have a 250px sticky first column and no `scroll-padding-inline-start`

- **Classification:** WCAG 2.4.11 Focus Not Obscured (Minimum), Level AA — new in 2.2
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `app/globals.css:3873-3881` (sticky column), `app/globals.css:3753-3761`
  (scroll container), `app/globals.css:1238-1240` (the only `scroll-padding` in the codebase)
- **Evidence:**

```3873:3881:app/globals.css
.coach-register-table .coach-register-name-column {
  position: sticky;
  left: 0;
  z-index: 1;
  width: 250px;
  padding-inline: 22px;
  box-shadow: 10px 0 20px rgba(7, 27, 50, 0.04);
  text-align: left;
}
```

  The container it sticks inside:

```3753:3761:app/globals.css
.coach-register-scroll {
  width: fit-content;
  max-width: 100%;
  margin-top: 38px;
  overflow-x: auto;
  border: 1px solid var(--line);
  outline: none;
  scrollbar-color: var(--steel) var(--ivory-deep);
  scrollbar-width: thin;
}
```

  The document has vertical scroll padding but nothing horizontal:

```1238:1240:app/globals.css
html {
  scroll-behavior: smooth;
  scroll-padding-top: var(--page-scroll-padding);
}
```

  `rg -n "scroll-padding" app components` returns exactly three lines: the `--page-scroll-padding`
  token at `:80`, its use at `:1239`, and nothing else. There is no `scroll-padding-left`,
  `scroll-padding-inline`, or `scroll-padding-inline-start` anywhere. On mobile the sticky column
  narrows to 148px (`app/globals.css:6250-6251`, inside `@media (max-width: 720px)`) but still
  overlays the container's left edge.

  The register cells are real `<button>` elements
  (`components/coach/player-attendance-register.tsx:190,206,219`), so they are tab stops. When
  focus moves to a cell left of the current scroll position, the browser scrolls it flush to the
  container's inline start — which the sticky name column occupies at `z-index: 1`.
- **Why it matters:** This is the exact shape 2.4.11 was written for, and the horizontal axis is
  the one the codebase's otherwise careful `scroll-padding-top` does not cover. It is also the
  interaction most central to the product: marking a year of attendance cell by cell.
- **User impact:** Head coach using keyboard-only navigation (including anyone using switch access
  or voice control) in the player or staff attendance register: Shift+Tab moves focus leftwards and
  the focused cell disappears behind the player-name column, so they cannot see which cell they are
  about to mark.
- **Effort:** S — `scroll-padding-inline-start: 250px` on `.coach-register-scroll`, and `148px`
  inside the 720px query
- **Confidence:** Medium (strong static inference — sticky geometry, focusable cells and the
  absence of horizontal scroll padding are all proved; the obscuring itself needs a browser)
- **How to prove:** With a dev server on a spare port, at
  `/coach/attendance/players/register?year=2026&batch=Weekday&level=Beginner`: click a cell in the
  middle of the table, then press Shift+Tab repeatedly and watch whether the focus ring passes
  under the name column. Programmatically:
  `const c=document.querySelector('.coach-register-scroll'); const b=[...c.querySelectorAll('td button')]; b[3].focus(); const r=b[3].getBoundingClientRect(), s=c.getBoundingClientRect(); console.log(r.left - s.left)`
  — a value below 250 means the cell is under the sticky column.

---

### RESP-3 — Two supplementary `:focus-within` cues are below the 3:1 non-text contrast floor

- **Classification:** WCAG 1.4.11 Non-text Contrast, Level AA
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:** `app/globals.css:11488-11490`, `app/globals.css:9004-9007`
- **Evidence:**

```11488:11490:app/globals.css
.coach-member-search:focus-within {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--navy) 18%, transparent);
}
```

  The wrapper sits on `.coach-member-register-tools { background: rgba(255,255,255,0.62) }`
  (`app/globals.css:11469`) over `--ivory`, which composites to `#fcfbf9`. Navy at 18% over that is
  `#d0d3d5`, giving **1.45:1** against its own backdrop.

```9004:9007:app/globals.css
.coach-published-reports-search:focus-within > div {
  border-color: var(--navy);
  box-shadow: 0 0 0 2px rgba(8, 28, 66, 0.08);
}
```

  `rgba(8,28,66,0.08)` over `--white` is `#ebedf0` — **1.17:1**.
- **Why it matters:** Neither is a conformance failure, because in both cases the actual keyboard
  focus indicator is the global floor's `2px solid var(--red)` (5.73:1 on white, 5.26:1 on ivory)
  and the second rule also swaps `border-color` to `var(--navy)` at 17.33:1. But both halos are
  effectively invisible, so they add nothing for the maintenance cost they carry — and if either is
  ever mistaken for the primary indicator, the real one may be removed.
- **User impact:** None today. Relevant to reviewers who might read these as sufficient.
- **Effort:** S
- **Confidence:** High (proved — arithmetic over literal values)
- **How to prove:** Already proved.

---

### RESP-4 — Document-overflow detection may be neutralised by `body { overflow-x: hidden }`, and its backstop covers only interactive elements

- **Classification:** Gate coverage / WCAG 1.4.10 Reflow
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `app/globals.css:1245`; `tests/e2e/support/accessibility-audit.ts:413-414`,
  `:341-343`; the same measurement in `tests/e2e/responsive-overflow.spec.ts:66-74`
- **Evidence:**

```1242:1246:app/globals.css
body {
  min-width: 320px;
  margin: 0;
  overflow-x: hidden;
  background: var(--ivory);
```

  The gate measures overflow at the document element:

```413:414:tests/e2e/support/accessibility-audit.ts
    const clientWidth = document.documentElement.clientWidth
    const scrollWidth = document.documentElement.scrollWidth
```

  Per CSS Overflow, `overflow` set on `<body>` propagates to the viewport when `<html>`'s own
  overflow is `visible`, which it is here (`html` declares only `scroll-behavior` and
  `scroll-padding-top`). The viewport therefore clips horizontally. **Whether that clamps
  `documentElement.scrollWidth` to `clientWidth` is a runtime question I cannot settle statically**,
  and it is the whole finding — so this is Low confidence on that half.

  What I *can* prove is the backstop's scope. The compensating check filters to interactive
  elements only:

```341:343:tests/e2e/support/accessibility-audit.ts
      if (!insideHorizontalScroller(control) && (rect.left < -1 || rect.right > viewportWidth + 1)) {
        clippedControls.push(selectorFor(control))
      }
```

  `controls` is built from `a[href], button, input, select, textarea, [role=button]`
  (`:326-333`). Overflowing *non-interactive* content — a long player name, a wide table cell, an
  unbreakable Academy ID, an image — is caught by neither check if `scrollWidth` is clamped.

  Mitigating: `responsive-overflow.spec.ts:141-162` separately measures the finance table
  *wrappers*' own `scrollWidth`, which is unaffected by the body clip. That is the right technique
  and it is already in the codebase — just applied to two routes.
- **Why it matters:** `overflow-x: hidden` on `body` hides the symptom of a reflow defect from
  users *and* potentially from the test that looks for it. If it does clamp, the single
  `document-horizontal-overflow` assertion in the a11y gate has never been able to fire.
- **User impact:** If content overflows at 320px it is silently clipped rather than scrollable —
  a 1.4.10 failure that is invisible to both the user (no scrollbar) and CI.
- **Effort:** S to verify; S to fix the assertion (measure a container, or set
  `document.body.style.overflowX = 'visible'` for the duration of the measurement)
- **Confidence:** Low (needs runtime proof)
- **How to prove:** With a dev server on a spare port, at 320×568 on any route:
  ```js
  const d = document.documentElement
  console.log("clamped?", d.scrollWidth, d.clientWidth)
  document.body.style.overflowX = "visible"
  console.log("unclamped:", d.scrollWidth, d.clientWidth)
  ```
  If the second pair differs from the first, the assertion is blind and every route needs
  re-measuring with the clip lifted.

---

### RESP-5 — Breakpoint set matches `.21st/DESIGN.md` exactly; nine singleton widths remain undocumented drift

- **Classification:** Responsiveness / breakpoint coherence
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:** `.21st/DESIGN.md:169-179`; the 20 widths across `app/globals.css`,
  `app/public-home.css` and the CSS modules
- **Evidence:** I counted every `@media` prelude in real source and compared to the recorded set.
  They match on all 20 widths and all 20 frequencies:

  `720px`×17, `980px`×13, `760px`×11, `900px`×10, `721px`×7, `761px`×5, `360px`×5, `340px`×4,
  `380px`×3, `1100px`×3, `820px`×2, `901px`×1, `780px`×1, `860px`×1, `700px`×1, `640px`×1,
  `600px`×1, `430px`×1, `320px`×1, `1000px`×1.

  The three intended pairs are complete: `720/721`, `760/761`, `900/901` — every width is covered by
  exactly one side of each pair, so there is no dead band at those steps.

  I checked the one construct that looked like a gap, `@media (min-width: 780px) and
  (max-width: 980px)` at `components/coach/financials/financial-records.module.css:1514`, on the
  suspicion that 761–779px would fall through. It does not: `.registrationFilters` at `:945`
  (`@media (max-width: 980px)`) sets `grid-template-columns: repeat(2, minmax(0, 1fr))`, whose zero
  minimums shrink safely, and the 780px rule only *increases* density above that width. The band is
  coherent. Reporting this because a reader would otherwise flag it.

  The genuine observation is that the nine singletons `1000, 860, 820, 780, 700, 640, 600, 430,
  380` are, as DESIGN.md itself says, "drift rather than system steps". `820px` is worth calling
  out specifically: it is both a drift width and the exact tablet viewport the gate audits, and
  `@media (max-width: 820px)` is inclusive of 820 — so the gate sits precisely on a boundary. Any
  future change from `max-width: 820px` to `max-width: 819px` would silently move the tablet audit
  to the other side of the target-size floor discussed in RESP-1.
- **Why it matters:** The design record is accurate and worth keeping accurate. The 820px
  coincidence is a fragility, not a defect.
- **User impact:** None today.
- **Effort:** S
- **Confidence:** High (proved by counting)
- **How to prove:** `rg -o "@media[^{]*" app components --glob '*.css' | rg -o "(min|max)-width:\s*[0-9]+px" | sort | uniq -c | sort -rn`

---

## 5. What's working well

This app has invested real, unusual effort in accessibility. Naming it precisely so it is not
undone:

1. **The `!important` focus floor** — `app/globals.css:13691-13697`, with the comment
   "Accessibility floor: component-specific reset rules must not suppress keyboard focus." It is
   the reason 12 of the 17 outline-removal sites are safe, and it is the only `!important` outline
   declaration in the codebase, so nothing fights it. Do not narrow it. (Widening it is A11Y-9.)

2. **All 17 outline removals have a replacement.** Zero failures. Several are paired with a
   dedicated rule immediately below the removal, which is the readable way to do it —
   `app/globals.css:280`, `:3764`, `:4189`, `:6991`, `app/public-home.css:1349`.

3. **The accessibility gate is far more than an axe wrapper.** `support/accessibility-audit.ts`
   adds original checks for clipped controls, covered controls, touch-target size, mobile font
   size, reduced-motion animations, focus-on-invalid-field, `aria-describedby` on invalid fields,
   dialog focus trapping, Escape-to-close, skip-link ordering and skip-link target. Its DOM checks
   for `main` count, `h1` count and heading order deliberately recover part of what discarding
   best-practice rules loses.

4. **`accessibility-sentinel.spec.ts` is a meta-test that verifies the scanner itself.** It feeds
   a known-bad fixture (an unnamed `<button>`) and asserts the scan fails. Very few codebases test
   that their accessibility tooling still works.

5. **The matrix refuses to under-report.** `accessibility-regression.spec.ts:986-991` throws if any
   profile/actor pair has no session provider, rather than silently skipping states — and
   `:1021-1023` asserts every selected state actually executed.

6. **`.sr-only` is a single, correct, well-reasoned utility** — `app/globals.css:66-77`, declared
   unlayered and `!important` with a comment explaining that a Tailwind utility-layer class could
   not outrank the unlayered rules below it. It carries both `clip` and `clip-path`.

7. **Authentication is close to exemplary for WCAG 3.3.8 and 3.3.7.** No `onPaste` handler exists
   anywhere. Every credential field except the PIN declares a real autocomplete token, including
   `one-time-code` on all six TOTP and email-code inputs. Redundant entry is genuinely avoided:
   `components/activation-form.tsx:26` and `app/activate/page.tsx:80` render the Academy ID
   `readOnly`; `components/recovery-email-enrollment-form.tsx:54-55` and
   `recovery-email-security-panel.tsx:70` carry email and name forward as hidden fields;
   `head-coach-setup-form.tsx:43` pre-fills the name.

8. **No zoom suppression.** `rg -n "user-scalable|maximum-scale|maximumScale"` across `app` and
   `components` returns nothing; the `viewport` export at `app/layout.tsx:81-83` sets only
   `themeColor`. 1.4.4 and the zoom half of 1.4.10 are safe by construction.

9. **`scroll-padding-top: var(--page-scroll-padding)` (88px) at `app/globals.css:1239`** exceeds the
   82px sticky `--portal-header-height`, so sequential keyboard focus does not land under the
   header. That is 2.4.11 handled on the vertical axis, deliberately. (RESP-2 is the horizontal
   axis, which this does not reach.)

10. **The player attendance register scroll container is exactly right** —
    `components/coach/player-attendance-register.tsx:263-269`: a `tabIndex={0}` focusable scroll
    region with `role="region"` and an `aria-label`. This is the pattern A11Y-7 asks the staff
    register to match.

11. **`reduced-motion` coverage is thorough and layered**: a global `*` reset in
    `app/globals.css:12922-12935` and `app/public-home.css:2334-2346` (both neutralising
    `scroll-behavior`, `transition-duration`, `animation-duration` and `animation-iteration-count`),
    per-module `transition: none` in six CSS modules, and JS guards at
    `components/public/home-interactions.tsx:24` and
    `components/coach/reports/report-workspace.tsx:616`.

12. **Live-region coverage is broad and mostly correct** — 33 `role="alert"`, 23 `role="status"`
    and 10 `aria-live="polite"` across 25 components.
    `components/coach/reports/published-reports-list.tsx:147-154` is a model example: `role="status"`
    plus `aria-live="polite"` plus `aria-atomic="true"`, with an `.sr-only` span completing the
    sentence for screen readers.

13. **`components/account-menu.tsx` is a correct disclosure**: a real `<button>` with
    `aria-expanded`, conditional `aria-controls`, a state-aware `aria-label`, Escape-to-close with
    explicit focus restoration to the trigger (`:26-31`), and outside-pointer dismissal.

14. **Checkbox and radio hit areas are handled via wrapping labels**, which is the right technique
    and matches how the harness measures them (`accessibility-audit.ts:360-365`). Every one of the
    18 sub-24px inputs my scan found is inside a `<label>` — for example `.callback-row` is a
    `<label>` with `min-height: 44px` around a 16×16 checkbox
    (`app/public-home.css:1356-1370`, `components/public/home-interactions.tsx:440-443`), and
    `.totp-trust-device` is the same at 44px (`app/globals.css:1895-1908`).

15. **A separate, dedicated responsive suite exists** — `tests/e2e/responsive-overflow.spec.ts`
    covering 320/360/390/430 plus two landscape sizes, asserting that finance table wrappers own
    their horizontal scrolling and that the player attendance calendar fits at 320 without
    overflow — and `accessibility-hardening.spec.ts` asserting focus-on-invalid-field, a 16px
    control font floor and a 44px "Jump to today" target at 320×568.

16. **The colour system is well tuned.** Every one of the ten translucent `rgba(247,245,240,α)` and
    `rgba(255,255,255,α)` text colours on navy surfaces that I composited and measured passes AA,
    the tightest being `.fee-note` at 4.81:1 (`app/public-home.css:1118`). Semantic pairs all pass:
    `--green` on `--green-soft` 4.81:1, `--red` on `--red-soft` 4.88:1, `--makeup-dark` on
    `--makeup-soft` 8.00:1. The two failures in A11Y-1 are genuinely the only ones I found.

---

## 6. Suggested PRs

Ordered by value per unit of risk. File overlaps between my own PRs are called out explicitly.

### PR-1 — Fix the two placeholder contrast failures
- **Scope:** Raise both placeholder colours to at least 4.5:1 against their resolved backgrounds.
  `rgba(97,112,131,0.72)` → `var(--text-placeholder)` (`#6b7480`, 4.74:1 on white);
  `color-mix(… var(--steel) 72% …)` → `var(--steel)` (5.39:1 on ivory).
- **Findings:** A11Y-1
- **Files:** `app/globals.css` (1 line), `components/coach/financials/financials.module.css` (1 line)
- **Effort:** S · **Risk:** Very low — two colour values, no layout change
- **Dependencies:** None
- **Overlap:** `app/globals.css` with PR-3, PR-4, PR-6. Land PR-1 first; it is one line.

### PR-2 — Give the staff register scroll region a role, and add roles to the other 12 role-less labelled elements
- **Scope:** `role="region"` on the staff register scroller to match the player register;
  `role="group"` (or `<fieldset>`/`<legend>` where a form grouping is meant) on the other 12.
- **Findings:** A11Y-7, A11Y-5
- **Files:** `components/coach/staff-attendance-register.tsx` (2 sites), `components/login-form.tsx`,
  `components/dashboard/player-attendance-card.tsx`, `components/coach/reports/report-workspace.tsx`
  (2), `components/financials/player-fee-record.tsx`,
  `components/coach/attendance-adjustments-workspace.tsx` (2),
  `components/coach/announcements/announcement-archive.tsx`, `components/coach/dashboard-card.tsx`,
  `app/(public)/page.tsx`, `app/setup/head-coach/page.tsx`
- **Effort:** S · **Risk:** Low — adding a role changes the accessibility tree, so re-run the gate;
  `role="group"` on a container of `aria-pressed` buttons is safe, but verify the announcement
  order on the login method switch
- **Dependencies:** None
- **Overlap:** None with my other PRs

### PR-3 — Close the 2.5.8 desktop target-size gap
- **Scope:** Move `min-height: 24px` for `.coach-slot-day` and `.coach-member-search input` out of
  `@media (max-width: 820px)` and into the base rules, matching what
  `.coach-member-filter select` already does at line 4271.
- **Findings:** RESP-1
- **Files:** `app/globals.css`
- **Effort:** S · **Risk:** Low, but it is a visual change on the Create Schedule form and the
  Member Directory rail — the design record freezes the member directory
  (`mobile-member-directory-freeze`), though it explicitly permits "accessibility regressions" as a
  reason to change, which this is
- **Dependencies:** None
- **Overlap:** `app/globals.css` with PR-1, PR-4, PR-6

### PR-4 — Add horizontal scroll padding to the attendance registers
- **Scope:** `scroll-padding-inline-start: 250px` on `.coach-register-scroll`, and `148px` inside
  `@media (max-width: 720px)` to match the narrowed sticky column.
- **Findings:** RESP-2
- **Files:** `app/globals.css`
- **Effort:** S · **Risk:** Low — affects only scroll-into-view positioning, no static layout
- **Dependencies:** Verify with the repro in RESP-2 before landing, since the finding is Medium
  confidence
- **Overlap:** `app/globals.css` with PR-1, PR-3, PR-6

### PR-5 — Make the gate see what it currently discards
- **Scope:** Three independent changes to the harness, landable together:
  (a) set `data-accessibility-dialog-opener="true"` on the three dialog triggers so the existing
  restoration assertion can fire; (b) promote a named allowlist of axe `incomplete` rule ids to
  blocking — start with `aria-prohibited-attr` and `color-contrast` — while leaving the rest
  advisory; (c) raise the focus-indicator sample cap from 6 to cover the full tab ring, or sample
  from the end of the document as well as the start.
- **Findings:** A11Y-4, A11Y-2, A11Y-9
- **Files:** `tests/e2e/support/accessibility-audit.ts`,
  `components/coach/announcements/announcement-detail.tsx`,
  `components/coach/reports/report-workspace.tsx`,
  `components/coach/announcements/announcement-composer.tsx`
- **Effort:** M · **Risk:** Medium — (b) will surface a backlog. Land it behind an env flag first
  and read the advisory counts the harness already prints before making it blocking
- **Dependencies:** Should land **after** PR-1 and PR-2, or it will fail on those known defects
- **Overlap:** `components/coach/reports/report-workspace.tsx` with PR-2 — PR-2 edits lines 702 and
  748, PR-5 edits the dialog trigger near line 152, so they will merge cleanly but should not be
  developed on the same branch

### PR-6 — Widen the focus floor and remove the two invisible halos
- **Scope:** Extend the floor's selector to
  `:is(a, button, input, select, summary, textarea, [tabindex]):focus-visible`; delete or
  strengthen the 1.45:1 and 1.17:1 `:focus-within` halos.
- **Findings:** A11Y-9, RESP-3
- **Files:** `app/globals.css`
- **Effort:** S · **Risk:** Medium — widening an `!important` outline to `a` and `button` will
  override intentional per-component focus styling. Audit the 26 `:focus*` selectors in
  `globals.css` and the 22 in the modules first, or use `:where()` on the floor and rely on source
  order instead of `!important` for the new element types
- **Dependencies:** None
- **Overlap:** `app/globals.css` with PR-1, PR-3, PR-4 — this PR touches lines 9004, 11488 and
  13691; PR-3 touches 4240/6951/13699 and PR-4 touches 3753. Adjacent but not identical; sequence
  PR-6 last

### PR-7 — Extend 320px coverage to the dense operational states
- **Scope:** Add `compact: true` to the six wide-table states first
  (`coach-player-attendance-register`, `coach-staff-attendance-register`, `coach-monthly-fees`,
  `coach-registration-fees`, `coach-collections`, `coach-financial-activity`), then to the rest.
- **Findings:** A11Y-3
- **Files:** `tests/e2e/support/accessibility-matrix.ts`
- **Effort:** S to add; unknown to fix what it surfaces · **Risk:** Low to the app, high to CI
  runtime — this adds 32 audits to an already twelve-minute suite, so measure the wall clock
  against the workflow's 25-minute limit before adding all of them
- **Dependencies:** Independent, but sequence after PR-1/PR-2/PR-3 so it reports fresh problems
  rather than known ones
- **Overlap:** None

### PR-8 — Settle the overflow-measurement question
- **Scope:** Run the RESP-4 repro. If `documentElement.scrollWidth` is clamped, change both the
  a11y gate and `responsive-overflow.spec.ts` to lift the clip for the duration of the measurement,
  or measure a wrapper as `responsive-overflow.spec.ts:141-162` already does for finance tables.
- **Findings:** RESP-4
- **Files:** `tests/e2e/support/accessibility-audit.ts`, `tests/e2e/responsive-overflow.spec.ts`
- **Effort:** S to verify, M if it needs re-measuring across routes · **Risk:** Low
- **Dependencies:** Investigation first — do not change the assertion before confirming the
  behaviour
- **Overlap:** `tests/e2e/support/accessibility-audit.ts` with PR-5

### PR-9 — Enable the excluded WCAG-tagged experimental rules
- **Scope:** Explicitly enable `td-has-header`, `table-fake-caption`, `p-as-heading`,
  `label-content-name-mismatch` and `css-orientation-lock` via `.options({ rules: … })`, starting
  advisory-only.
- **Findings:** A11Y-8
- **Files:** `tests/e2e/support/accessibility-audit.ts`
- **Effort:** S to enable; L if `td-has-header` finds real problems in the registers
- **Risk:** Low while advisory
- **Dependencies:** None
- **Overlap:** `tests/e2e/support/accessibility-audit.ts` with PR-5 and PR-8 — all three edit the
  same file, so land them as one sequence or one PR

### PR-10 — Route-change focus management
- **Scope:** A small client component in the authenticated layouts that watches `usePathname` and,
  on change, focuses `#main-content` (already `tabIndex={-1}`) and announces the new page title in
  a polite live region.
- **Findings:** A11Y-6
- **Files:** new `components/route-focus.tsx`; `components/app-shell.tsx`; the coach and admin
  shells
- **Effort:** M · **Risk:** Medium — moving focus on every navigation can fight the 94 existing
  `.focus()` call sites, several of which restore focus after a `router.replace` for URL state
  sync. Guard on pathname change only, never on `searchParams` change, or the attendance calendar
  and member directory will steal focus on every filter interaction
- **Dependencies:** Depends on PR-5(c) or PR-7 for a test that can observe it — no current test
  drives a client-side `<Link>` transition
- **Overlap:** None
