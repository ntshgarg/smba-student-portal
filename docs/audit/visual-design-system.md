# SMBA Student Portal — Visual Design & Design-System Audit

**Lens:** visual design, design-system consistency, design tokens
**Repository:** `/Users/nitishg/smba-student-portal`, branch `audit/fresh-pass`, read-only
**Date:** 2026-08-24
**Scope note:** Accessibility (contrast ratios, focus outlines, `outline: 0`), performance, correctness and content are other agents' lenses and are excluded here even where I noticed them.

---

## 1. Method

### What I examined

The complete hand-written CSS surface and every `.ts`/`.tsx` file that consumes it:

```
$ find app components lib -name "*.css" -exec wc -l {} \;
    2359 app/public-home.css
   13985 app/globals.css
    1005 components/financials/player-financials.module.css
     673 components/announcements/announcements.module.css
     450 components/coach/dashboard-card.module.css
     307 components/coach/junior-coach-dashboard.module.css
    3683 components/coach/financials/financials.module.css
    1567 components/coach/financials/financial-records.module.css
    1641 components/coach/announcements/announcements.module.css
     101 components/coach/player-onboarding-card.module.css
    1253 components/coach/onboarding/player-onboarding-register.module.css
      29 components/reveal.module.css
```

**Correction to the brief:** the brief states "100 `*.module.css` CSS Modules". The real number is **10**. `.21st/DESIGN.md:26-28` states the correct figure ("12 hand-written files — app/globals.css … and 10 CSS modules"). Total CSS under real source paths is 12 files / 27,053 lines. I confirmed no CSS exists outside these paths with `rg --files -g '*.css'`, which respects `.gitignore` and therefore skips the stale `output/`, `snapshots/`, `tmp/`, `test-results/` and `playwright-report/` trees.

### Stack reality, verified not assumed

**Tailwind v4 contributes Preflight and nothing else — confirmed.**

```
$ rg -n '@apply|@theme|@tailwind|@utility|@variant|@source' app components
(none)

$ rg -o 'className="([^"]*)"' -r '$1' app components | tr ' ' '\n' \
    | rg -x 'grid|flex|hidden|block|border|rounded|shadow' | sort | uniq -c
(no output — zero standalone Tailwind utility class tokens)
```

`postcss.config.mjs` loads only `@tailwindcss/postcss`. `@import "tailwindcss"` is `app/globals.css:1`. `.sr-only` is redefined locally at `app/globals.css:110-121` with `!important` and a comment explaining that unlayered CSS outranks any cascade layer. `.21st/DESIGN.md:38-43` describes this accurately.

### Commands that produced the counts

Token extraction, cross-referencing, colour census, ΔE computation, type/spacing/radius/shadow/z-index histograms, cross-file duplicate-block hashing and dead-key detection were all done with `node --input-type=module -e '…'` reading files with `fs` and enumerating them via `rg --files`. The specific analyses:

| Analysis | Result |
|---|---|
| `:root` token block | `app/globals.css:47-102`, **54** declarations on lines 48–101 |
| Custom properties declared in CSS | **68** (54 in `:root` + 14 component-scoped) |
| Distinct custom properties read via `var()` | **80** |
| Declared but never read | **0** |
| Read but not declared in CSS | **12** — all resolved to TSX inline styles (10) and `next/font` (2) |
| Colour literals in source CSS | **275** (22 inside `:root`, 253 outside) |
| `font-size` declarations | **1107**, 204 distinct values, **45** of them token reads |
| Spacing px declarations (`padding`/`margin`/`gap` family) | **2420**, 58 distinct values, **65** spacing-token reads |
| `border-radius` declarations | 8 distinct forms |
| `z-index` declarations | 8 distinct values |
| `box-shadow` declarations | 23 distinct values |
| Uppercase micro-label rules | **160** rules, **103** distinct (size, weight, tracking, colour) combinations |
| Identical declaration bodies (≥3 decls) appearing in >1 file | **33** |
| Provably dead CSS | **307** lines (186 in modules, 121 in `globals.css`) |

**Perceptual distance.** Where I claim two colours are "visually identical" I computed CIE76 ΔE in Lab space (sRGB → linear → XYZ → Lab). ΔE < 2 is the standard threshold for "not distinguishable side by side by a normal observer"; ΔE < 5 is "distinguishable only on direct comparison".

### Reconciling my colour count with the 21st CLI's 272

`output/audit/21st-review.txt` reports 272 findings: `globals.css` 157, `public-home.css` 105, `financials.module.css` 9, `layout.tsx` 1. I count 275 literals in CSS plus 1 in `layout.tsx` = 276. The 4-site gap is entirely multi-literal lines that the tool reports once:

- `app/globals.css:2911` contains four literals (`#f3f2ef` ×2, `#d8d5cf` ×2); the tool reports one finding at `2911:49`.
- `app/public-home.css:396` contains two literals (`#041424`, `#0a2441`); the tool reports one finding at `396:29`.

276 − 4 = 272. Fully reconciled.

### What needs a browser and therefore is not asserted here

I did not start a dev server, run Playwright, or open a page. Consequently I make **no claim about any computed style, cascade winner, rendered pixel size, or contrast ratio.** Where a finding would be strengthened by runtime evidence I have set Confidence to Medium or Low and given the exact command under "How to prove". Specifically unproven without a browser: which `font-size` declaration wins on any given element after the 13,985-line unlayered cascade; whether `font-weight: 820` renders identically to `800` (I prove only that the declared value exceeds the family's declared axis); and whether the near-duplicate greys are ever adjacent on screen.

### Independence

I did not search for, read, or recover any prior audit. I did not read `docs/PORTAL-AUDIT-*` (it appears as deleted in `git status`) and ran no git command. Every conclusion below comes from the working tree as it stands.

---

## 2. Findings

### DS-1 — The five typography tokens are declared but effectively unused; the real type scale is 30 literal sizes across 1107 declarations

- **Classification:** typography / token gap
- **Type:** Objective defect
- **Severity:** High
- **Location:** Tokens at `app/globals.css:82-86`. Literal sites are too numerous to inline; the complete per-value counts and every site are reproducible with the command below. Distribution across all 12 CSS files.
- **Evidence:**

```
$ for t in type-operational-floor type-utility-label type-utility-meta \
           type-operational-action type-operational-body; do
    printf "%-28s %s\n" "--$t" "$(rg -o "var\(--$t\)" app components | wc -l | tr -d ' ')"
  done
--type-operational-floor     30
--type-utility-label         7
--type-utility-meta          2
--type-operational-action    3
--type-operational-body      3

$ rg -o 'var\(--type-[a-z-]*\)' app components | wc -l
      45
$ rg -c 'font-size\s*:' app components | awk -F: '{s+=$2} END {print s}'
1107
```

Literal `font-size` counts against the token that already holds that exact value:

| Token | Value | Token reads | Literal declarations of the same value | Adoption |
|---|---|---|---|---|
| `--type-operational-floor` | `10px` | 30 | 155 | 16.2% |
| `--type-utility-label` | `11px` | 7 | 197 | 3.4% |
| `--type-utility-meta` + `--type-operational-action` | `12px` | 5 | 131 | 3.7% |
| `--type-operational-body` | `13px` | 3 | 75 | 3.8% |
| *(no token)* | `9px` | — | **99** | n/a |
| *(no token)* | `8px` | — | 3 | n/a |
| *(no token)* | `14px` | — | 36 | n/a |

The token set is also incomplete in the direction the product actually went. `9px` is the **second most common size in the whole codebase** at 99 declarations, yet the token named `--type-operational-floor` claims the floor is `10px`. There are a further ~150 distinct `clamp()` expressions, almost all appearing exactly once.

- **Why it matters:** A token layer that 4% of call sites use is not a design system — it is documentation that has diverged from the artefact. The immediate practical consequence is that changing the operational type scale is not a token edit, it is a 560-site find-and-replace, which nobody will attempt, so the scale is frozen by accident rather than by decision. It also means the five token names carry no information: a reader cannot tell from `font-size: 11px` whether this is a "utility label" or an arbitrary choice.
- **User impact:** Head coach and coach, working in the financial registers, attendance registers and onboarding register — the densest surfaces — read a type hierarchy assembled from 30 literal steps rather than 5 named roles. The consequence is not a visible bug today; it is that the next legibility improvement (see DS-2's sibling, VD-1) cannot be made safely or cheaply, so it will not be made.
- **Effort:** L (1–2d) to adopt tokens mechanically across the four exact-match sizes; XL if the `clamp()` population is also normalised.
- **Confidence:** High (proved) — the counts are exact and reproducible.
- **How to prove:** Already proved by the commands above.

---

### DS-2 — The spacing scale is a clean 8px grid in `:root` and a 58-value continuum in the code; 2.6% adoption

- **Classification:** spacing / token gap
- **Type:** Objective defect
- **Severity:** High
- **Location:** Tokens at `app/globals.css:71-79`. 2420 literal declarations across all 12 CSS files.
- **Evidence:**

```
$ rg -o 'var\(--(space-tight|space-copy|space-group|space-block|space-editorial|space-content|space-section-sm|section-space-md|section-space-lg)\)' app components | wc -l
      65
```

Against 2420 px-valued `padding` / `margin` / `gap` / `row-gap` / `column-gap` / logical-property declarations, in 58 distinct values. The declared scale versus what is actually used:

| Declared token | Value | Literal uses of that value | Literal uses of the neighbouring values |
|---|---|---|---|
| `--space-tight` | `8px` | 157 | 6px 58, 7px 77, 9px 85, 10px 178 |
| `--space-copy` | `16px` | 179 | 14px 182, 15px 29, 17px 25, **18px 203** |
| `--space-group` | `24px` | 127 | 20px 150, 22px 126, 26px 39, 28px 82 |
| `--space-block` | `32px` | **17** | 28px 82, 30px 48, 34px 26 |
| `--space-editorial` | `40px` | **3** | 36px 10, 38px 11, 42px 9 |
| `--space-content` | `48px` | **6** | 44px 2, 52px 8 |
| `--space-section-sm` | `56px` | **1** | 54px 2, 58px 2 |

Two observations sharpen this. First, `18px` (203 uses) is more common than `16px` (179), and `20px` (150) is more common than `24px` (127) — the de-facto scale is a 2px grid, not the declared 8px grid. Second, the odd-numbered values, which are the least likely to be intentional system steps, total **380 declarations**: 5px (64), 7px (77), 9px (85), 11px (41), 13px (55), 15px (29), 17px (25), 19px (2), 21px (1), 25px (1).

Grounding, from the project-independent rules database:

```
$ python3 "/Users/nitishg/.codex/skills/ui-ux-pro-max/scripts/search.py" \
    "spacing scale consistency 8px grid design tokens" --domain ux
… Category: Touch | Issue: Touch Spacing | Do: Minimum 8px gap between touch targets …
```

The database returned only touch-spacing and responsive guidance, not a general spacing-scale rule; I am not going to invent a citation. The argument here rests on the internal contradiction — the project declared a 7-step 8px grid and then did not use it — not on an external standard.

- **Why it matters:** Identical to DS-1 in mechanism and worse in volume. A spacing token read 1, 3 or 6 times is a token in name only. The 380 odd-value declarations are the strongest signal that spacing is being nudged per-site by eye rather than selected from a scale, which is exactly the process that produces the rhythm inconsistencies in VD-1.
- **User impact:** All four roles. Vertical rhythm across the coach registers, the player tickets and the public homepage is set independently in each place, so surfaces that the recorded design decisions describe as siblings (see VD-4, VD-5) do not share a spacing cadence.
- **Effort:** XL (>2d) — 2420 sites, and any collapse to the declared scale changes rendered output.
- **Confidence:** High (proved).
- **How to prove:** Already proved.

---

### VD-1 — One design idea, the SMBA uppercase micro-label, exists in 103 distinct variants across 160 rules

- **Classification:** duplication / typography
- **Type:** Objective defect
- **Severity:** High
- **Location:** 160 rules across 9 of the 12 CSS files. The 8 largest variant groups, with every site:

**`10px | 800 | 0.1em | var(--red)` — 12 sites**
`app/globals.css:218`, `app/globals.css:2785`, `app/globals.css:3150`, `app/globals.css:4662`, `app/globals.css:5105`, `app/globals.css:7074`, `components/announcements/announcements.module.css:180`, `components/coach/announcements/announcements.module.css:3`, `components/coach/financials/financial-records.module.css:60`, `components/coach/financials/financials.module.css:54`, `components/coach/financials/financials.module.css:177`, `components/financials/player-financials.module.css:55`

**`9px | 800 | 0.08em | var(--steel)` — 7 sites**
`app/globals.css:996`, `app/globals.css:7465`, `app/globals.css:9036`, `components/coach/financials/financials.module.css:631`, `components/coach/financials/financials.module.css:692`, `components/coach/financials/financials.module.css:1124`, `components/coach/financials/financials.module.css:1555`

**`9px | 800 | 0.09em | var(--steel)` — 7 sites**
`app/globals.css:4583`, `app/globals.css:4704`, `app/globals.css:4861`, `app/globals.css:5348`, `app/globals.css:5603`, `app/globals.css:9386`, `components/coach/financials/financials.module.css:2054`

**`9px | 800 | 0.1em | var(--steel)` — 4 sites**
`app/globals.css:4258`, `app/globals.css:5059`, `components/coach/dashboard-card.module.css:284`, `components/coach/junior-coach-dashboard.module.css:126`

**`9px | 800 | 0.1em | var(--red)` — 4 sites**
`app/globals.css:4506`, `app/globals.css:8928`, `app/globals.css:13464`, `components/coach/financials/financials.module.css:1947`

**`10px | 790 | 0.075em | var(--steel)` — 4 sites**
`components/coach/financials/financial-records.module.css:214`, `:308`, `:442`, `:505`

**`11px | 800 | 0.1em | var(--red)` — 3 sites**
`app/globals.css:3613`, `app/globals.css:5576`, `app/globals.css:6719`

**`10px | 800 | 0.08em | var(--steel)` — 3 sites**
`app/globals.css:5311`, `app/globals.css:6891`, `components/coach/announcements/announcements.module.css:1160`

The remaining 95 variants account for 116 further rules; 78 of the 103 variants occur exactly once. The full list is reproducible with the script referenced in Method.

- **Evidence:** Two representative pairs, verbatim, showing differences that cannot be seen:

```css
/* app/globals.css:996 */
.coach-adjustment-history-details dt {
  color: var(--steel);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
```
```css
/* app/globals.css:4583 */
.coach-member-detail-domains dt {
  color: var(--steel);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
```

At 9px, `0.08em` and `0.09em` are 0.72px and 0.81px of tracking per character — a difference of **0.09px per character**. Both are the "field label" role, one in the attendance-adjustment history and one in the member detail panel.

- **Why it matters:** This is the single most repeated visual atom in the product — the eyebrow/field-label that DESIGN.md's decisions name over and over ("Attendance register eyebrow", "one quiet New adjustment eyebrow", "restrained red state stamps"). It is the element most responsible for the product's editorial-register identity, and it has no single definition. Every new surface re-derives it by eye, which is why there are 103 versions. Three sizes × two weights × eleven tracking values × six colours is not a system; it is 160 independent decisions.
- **User impact:** Head coach and coach, moving between Financials, Attendance, Members, Reports and Announcements in a single session, see the same category of label rendered at 9, 10 or 11px with different weight and tracking on each destination. The individual differences are below the threshold of conscious notice, which is precisely the problem: the surfaces feel subtly unrelated without the user being able to say why.
- **Effort:** M (half day) to introduce one `.eyebrow` utility plus two modifiers and migrate the top 8 variants (44 rules); L to migrate all 160.
- **Confidence:** High (proved) — the variant census is exact.
- **How to prove:** Already proved.

**Correction (verified during implementation):** one of the seven sites listed for `9px | 800 | 0.09em | var(--steel)` is dead. `app/globals.css:4704` is `.coach-member-batch-field > span`, the dead half of a selector list kept alive by `.coach-member-form-grid label > span` at `:4703`, and `.coach-member-batch-field` is one of the two key families DS-7 proves unreferenced. The declaration does render, through the live selector, so the variant group is real and the argument above is unaffected — but it is not reached through the selector cited here. That group therefore has six live sites and one dead one, not seven, and the dead one disappears once the DS-7 fragment trim lands. The census of 103 variants across 160 rules was not re-derived and does not turn on a single site moving from live to dead. See `docs/audit/verification-log.md`.

---

### DS-3 — Seven near-identical hairline greys duplicate `--line` across 22 sites, all within ΔE 2.74

- **Classification:** colour / hardcoded value
- **Type:** Objective defect
- **Severity:** High
- **Location:** every site:

| Value | ΔE from `--line` `#d7dbde` | max per-channel Δ | Sites |
|---|---|---|---|
| `#d6dadd` | 0.36 | 1 | `app/public-home.css:1140`, `:1141`, `:1544`, `:1545` |
| `#d5dadd` | 0.56 | 2 | `app/public-home.css:1567` |
| `#d8dbdd` | 0.63 | 1 | `app/public-home.css:595`, `:687`, `:709`, `:793`, `:794`, `:801`, `:802`, `:2085` |
| `#d9dddf` | 0.86 | 2 | `app/globals.css:2717`, `app/public-home.css:1253`, `:1379` |
| `#d2d6d9` | 1.78 | 5 | `app/public-home.css:1727`, `:1747` |
| `#dde0e2` | 1.93 | 6 | `app/public-home.css:180`, `:206`, `:1775` |
| `#ced4d7` | 2.74 | 9 | `app/public-home.css:1306` |

- **Evidence:** every one of these is in the hairline-border or thin-track role that `--line` exists for:

```
app/public-home.css:595    { .about }               border-top: 1px solid #d8dbdd;
app/public-home.css:687    { .about-principles }    border-top: 1px solid #d8dbdd;
app/public-home.css:709    { .about-principles > li } border-bottom: 1px solid #d8dbdd;
app/public-home.css:793    { .path-grid }           border-top: 1px solid #d8dbdd;
app/public-home.css:794    { .path-grid }           border-left: 1px solid #d8dbdd;
app/public-home.css:801    { .path-card }           border-right: 1px solid #d8dbdd;
app/public-home.css:802    { .path-card }           border-bottom: 1px solid #d8dbdd;
app/public-home.css:2085   { .path-card }           border: 1px solid #d8dbdd;
app/public-home.css:1140   { .proof-grid }          background: #d6dadd;
app/public-home.css:1141   { .proof-grid }          border: 1px solid #d6dadd;
app/public-home.css:1544   { .contact-stack }       background: #d6dadd;
app/public-home.css:1545   { .contact-stack }       border: 1px solid #d6dadd;
app/public-home.css:1567   { .contact-icon }        border: 1px solid #d5dadd;
app/public-home.css:180    { .header-account-menu p } border-bottom: 1px solid #dde0e2;
app/public-home.css:206    { .header-account-menu a, .header-account-menu button } border-bottom: 1px solid #dde0e2;
app/public-home.css:1775   { .mobile-nav a }        border-bottom: 1px solid #dde0e2;
app/public-home.css:1253   { .form-heading }        border-bottom: 1px solid #d9dddf;
app/public-home.css:1379   { .form-reassurance }    border-top: 1px solid #d9dddf;
app/public-home.css:1306   { .form-field input, .form-field textarea, .form-field select } border: 1px solid #ced4d7;
app/public-home.css:1727   { .menu-button }         border: 1px solid #d2d6d9;
app/public-home.css:1747   { .mobile-nav }          border-bottom: 1px solid #d2d6d9;
app/globals.css:2717       { .attendance-track, .development-track } background: #d9dddf;
```

- **Why it matters:** This directly answers the brief's question about `public-home.css`. That file is **not outside the token system** — it reads `var()` 202 times across 28 distinct tokens (`--red` ×34, `--space-copy` ×20, `--ease-standard` ×19, `--navy` ×17, `--ivory` ×17, `--duration-base` ×16, `--steel` ×12, `--space-content` ×11, `--white` ×10, `--space-group` ×10, plus 18 more). It is inside the system **and has drifted in exactly one role**: the hairline. It reads `--border` (which aliases `--line`) three times and reads `--line` **zero** times, while writing seven raw greys 21 times. That is a targeted, fixable drift, not an architectural exclusion — which makes it much cheaper to correct than the file's raw 106-literal count suggests.
- **User impact:** Prospective students and parents on the public homepage, and every signed-in user via the shared account menu. No one perceives the individual differences; the cost is that a future decision to change the SMBA hairline (to raise its contrast, for instance) will silently miss 22 sites and produce a visibly inconsistent page.
- **Effort:** S (<2h) for the 21 `public-home.css` sites plus 1 in `globals.css`.
- **Confidence:** High (proved) — values, sites and ΔE are computed, not inferred. The *rendered* difference at 1px width is below perception, which is the point; that claim is a colorimetric one, not a runtime one.
- **How to prove:** Already proved.

---

### VD-2 — Three different on-dark greens and two on-dark reds express the same semantic on the same navy field

- **Classification:** colour / duplication
- **Type:** Objective defect
- **Severity:** High
- **Location:** `app/globals.css:8164`, `:8168`, `:8172`, `:8575`, `:8579`, `:8583`, `components/coach/financials/financials.module.css:607`, `:611`
- **Evidence:** two inline-notice implementations on dark surfaces, verbatim:

```css
/* app/globals.css:8163-8173 */
.coach-roster-inline-notice .inline-notice.is-info {
  color: rgba(255, 255, 255, 0.7);
}

.coach-roster-inline-notice .inline-notice.is-success {
  color: #b9e4cc;
}

.coach-roster-inline-notice .inline-notice.is-error {
  color: #ffb4ba;
}
```
```css
/* app/globals.css:8574-8584 */
.attendance-roster-recorder .inline-notice {
  color: rgba(255, 255, 255, 0.7);
}

.attendance-roster-recorder .inline-notice.is-success {
  color: #8dd9b6;
}

.attendance-roster-recorder .inline-notice.is-error {
  color: #f7a1a7;
}
```

and a third on-navy success colour in the financials ledger:

```css
/* components/coach/financials/financials.module.css:552-560, 606-612 */
.ledgerHeader {
  …
  background: var(--navy);
  color: var(--white);
}
…
.ledgerBalance em {
  color: #f4d493;
}

.ledgerBalance .status_paid {
  color: #9bd3aa;
}
```

Both notice variants agree on the `info` colour (`rgba(255,255,255,0.7)`) and disagree on both `success` and `error`. Three on-navy greens: `#b9e4cc`, `#8dd9b6`, `#9bd3aa`. Two on-navy roses: `#ffb4ba`, `#f7a1a7`. None is a token; `--green-soft` (`#e8f3ec`) is ΔE 16.6, 30.6 and 28.9 away from them respectively, because it is a *fill* for light surfaces, not a *text* colour for dark ones.

The same gap produces a second contradiction in the ochre "make-up / rescheduled" state:

```css
/* app/globals.css:142-145 — the register cell, using the token */
.coach-register-table td a.coach-register-cell-control.is-makeup {
  background: var(--makeup);          /* #e5b851 */
  color: var(--makeup-dark);
}
```
```css
/* app/globals.css:8485-8488 — the recorder, using a different ochre */
.attendance-record-roster-list > a.is-rescheduled {
  border-color: rgba(217, 167, 53, 0.72);   /* #d9a735 — ΔE 8.23 from --makeup */
  background: rgba(217, 167, 53, 0.16);
}
```

- **Why it matters:** The root cause is a real token-set gap, not carelessness: the palette has semantic colours for light surfaces (`--green`, `--red`, `--makeup-dark`) and **no on-dark tier at all**. Every navy surface therefore invents its own success/error/attention colour, and three authors invented three. Unlike DS-3 these differences are above the perception threshold (ΔE 16–31 between the greens), so two coach surfaces genuinely do not match.
- **User impact:** Head coach. Recording player attendance (`.attendance-roster-recorder`) and managing a session roster (`.coach-roster-inline-notice`) are adjacent tasks in the same workflow, both on navy, and a success message is a different green in each. In the Financials ledger the "paid" state is a third green. The colour that means "this worked" is not stable across the coach's own workspace.
- **Effort:** S (<2h) to add three on-dark tokens; M to migrate the 8 sites and confirm nothing else depended on the exact values.
- **Confidence:** High (proved) — the declarations, their dark backgrounds and the ΔE distances are all read from source.
- **How to prove:** Already proved for the source facts. The *perceptual* claim that a coach would notice is a design judgement; a screenshot comparison of `/coach/attendance` and the session-roster panel would settle it: `npx playwright screenshot …` (not run — the brief forbids Playwright and a dev server).

---

### DS-4 — 157 raw `rgba()` literals re-type a token's colour purely to obtain alpha, because the system has no alpha mechanism at its call sites

- **Classification:** hardcoded value / token gap
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** 157 sites. Grouped by the token whose RGB triple they duplicate:

| Token | Value | Sites | Distinct alpha values used |
|---|---|---|---|
| `--white` | `#ffffff` | 62 | 29 — 0.035, 0.045, 0.06, 0.08, 0.1, 0.12, 0.14, 0.15, 0.16, 0.17, 0.18, 0.2, 0.22, 0.32, 0.35, 0.46, 0.48, 0.5, 0.55, 0.58, 0.6, 0.62, 0.64, 0.65, 0.66, 0.68, 0.7, 0.72, 0.74 |
| `--ivory` | `#f7f5f0` | 59 | 36 — 0.035 … 0.98 |
| `--navy` | `#071b32` | 30 | 17 — 0.04 … 0.7 |
| `--red` | `#c81d2a` | 4 | 0.045, 0.18, 0.2, 0.62 |
| `--green` | `#2d7656` | 2 | 0.08, 0.24 |

Full site lists are reproducible; a representative slice:

```
app/globals.css:176   border: 1px solid rgba(255, 255, 255, 0.48);
app/globals.css:186   background: rgba(255, 255, 255, 0.12);
app/globals.css:190   background: rgba(255, 255, 255, 0.12);
app/globals.css:1347  rgba(247, 245, 240, 0.94)
app/globals.css:1346  rgba(7, 27, 50, 0.11)
app/public-home.css:409  rgba(247, 245, 240, 0.24)
components/coach/financials/financials.module.css:51   background: rgba(255, 255, 255, 0.58);
```

- **Evidence:** the project does not merely know the modern answer — it uses `color-mix()` **95 times**, and the two idioms coexist for the same job:

```
$ node -e '<balanced-paren scan of every color-mix() expression>'
color-mix total: 95
  mixing to transparent (alpha use, direct substitute for rgba): 30
  mixing to another colour (tint use): 65

per file:
  41  app/globals.css
  18  components/coach/announcements/announcements.module.css
  14  components/coach/financials/financials.module.css
   8  components/coach/financials/financial-records.module.css
   7  components/financials/player-financials.module.css
   3  components/coach/junior-coach-dashboard.module.css
   2  components/coach/dashboard-card.module.css
   2  components/coach/onboarding/player-onboarding-register.module.css
   0  app/public-home.css
```

Representative pairs doing the identical job two ways, in the same file:

```css
/* app/globals.css:11489 — the modern form */
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--navy) 18%, transparent);

/* app/globals.css:13006 — the raw form, same colour, same kind of surface */
  rgba(7, 27, 50, 0.2)
```
```css
/* app/globals.css:7143 and :7497 */
  background: color-mix(in srgb, var(--navy) 8%, transparent);

/* app/globals.css:9006 — 8% navy again, but written out, and not even --navy: */
  box-shadow: 0 0 0 2px rgba(8, 28, 66, 0.08);   /* #081c42 is ΔE 8.36 from --navy */
```

So the alpha job is done the maintainable way **30** times and the raw way **157** times — a 16% / 84% split, with both forms appearing within a few hundred lines of each other in `globals.css`.

- **Why it matters:** This is the actual content of the "272 hardcoded colours" signal, and it is a different problem from the one the rule name suggests. These are not rogue colours — every one is a *token colour*. But because the hex triple is written out, a change to `--navy` or `--ivory` silently fails to propagate to 89 translucent surfaces, and the codebase gives no way to grep for "everything tinted with navy". Two further facts sharpen it. First, this is not a knowledge gap — the same authors, in the same files, use `color-mix` correctly 95 times; there is simply no convention saying which to use, so both persist. Second, `app/public-home.css` has **zero** `color-mix` sites against **64** lines containing `rgba()`, which is the same file-level split DS-3 found for the hairline: every other stylesheet has moved on and this one has not. The 65 distinct alpha values are their own sub-problem: there is no opacity scale either.
- **User impact:** No current visual defect. The impact is latent: any future palette adjustment (a darker navy for contrast, a warmer ivory) produces a half-updated interface where opaque surfaces move and translucent ones do not.
- **Effort:** L (1–2d). Mechanical but 157 sites, and `color-mix` output is not bit-identical to a hand-written `rgba()` in every case, so it needs visual regression review.
- **Confidence:** High (proved) for the inventory. Medium for the claim that `color-mix` substitution is visually lossless at every site — that needs rendering.
- **How to prove:** For the equivalence claim: `node -e` computing the sRGB composite of each `rgba()` over its actual backdrop versus the `color-mix` result, or a screenshot diff.

---

### VD-3 — The "unavailable" diagonal hatch has three implementations, and the legend that explains it matches none of them

- **Classification:** duplication / colour
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `app/globals.css:2911`, `app/globals.css:3991-3997`, `app/globals.css:4003-4009`, `app/globals.css:10775-10781`
- **Evidence:**

```css
/* app/globals.css:2910-2912 — the LEGEND swatch */
.player-attendance-legend i.is-unavailable {
  background: repeating-linear-gradient(-45deg, #f3f2ef 0, #f3f2ef 4px, #d8d5cf 4px, #d8d5cf 5px);
}
```
```css
/* app/globals.css:3989-3998 — the coach register cell */
.coach-register-table td.is-unavailable button:disabled {
  background:
    repeating-linear-gradient(
      -45deg,
      #f3f2ef 0,
      #f3f2ef 7px,
      #ebe9e5 7px,
      #ebe9e5 8px
    );
  color: #a1a7ac;
}
```
```css
/* app/globals.css:10774-10781 — the personal month calendar */
.personal-attendance-calendar .player-attendance-calendar-day.is-not-scheduled {
  background: repeating-linear-gradient(
    -45deg,
    var(--white) 0,
    var(--white) 7px,
    var(--ivory-deep) 7px,
    var(--ivory-deep) 8px
  );
}
```

Three renderings of one semantic:

| Site | Base | Stripe | Period | Tokenised? |
|---|---|---|---|---|
| legend `:2911` | `#f3f2ef` | `#d8d5cf` | **5px** | no |
| coach cell `:3991`, `:4003` | `#f3f2ef` | `#ebe9e5` | 8px | no |
| month calendar `:10775` | `var(--white)` | `var(--ivory-deep)` | 8px | **yes** |

`#f3f2ef` is ΔE 1.52 from `--ivory`; `#ebe9e5` is ΔE 2.30 from `--ivory-deep`; `#d8d5cf` is ΔE 5.63 from `--line` and is a visibly warmer, darker stripe than either alternative. The calendar version already proves the pattern is expressible entirely in tokens.

- **Why it matters:** The legend is the one element whose entire job is to be a faithful sample of the thing it labels, and it uses a different stripe colour *and* a 5px period against the cell's 8px. `.21st/DESIGN.md:274` records the decision *player-attendance-record*: "Keep the player-facing annual attendance register read-only and visually aligned with the coach register." Three implementations of one hatch is the mechanism by which that alignment silently fails.
- **User impact:** Player, and junior coach, reading their own attendance record and consulting the legend to interpret a striped cell. The swatch they compare against is a denser, warmer stripe than the cell itself. Low severity in isolation; it is the clearest single instance of the general problem.
- **Effort:** S (<2h) — collapse to one tokenised gradient, ideally a custom property so the legend and the cell are guaranteed identical.
- **Confidence:** High (proved) for the source divergence. Medium that a user notices — that is a judgement about a small swatch.
- **How to prove:** Source is conclusive. For the perceptual question, screenshot `/player` attendance register at the legend and a striped cell.

---

### DS-6 — Weight, line-height and letter-spacing are continuous dials, not scales: 37, 39 and 42 distinct values

- **Classification:** typography
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** all 12 CSS files.
- **Evidence:**

```
font-weight   : 37 distinct values, 577 declarations
  400(16) 420(1) 430(2) 440(1) 450(3) 460(1) 470(12) 500(13) 520(6) 545(6)
  560(14) 570(18) 580(6) 590(8) 600(6) 610(9) 620(13) 640(2) 650(26) 660(2)
  670(1) 680(15) 690(2) 700(27) 720(30) 730(8) 740(12) 750(30) 760(75) 780(28)
  790(11) 800(148) 820(12) 830(3) 850(5)   [+ 3 @font-face descriptors, 2 inherit]

line-height   : 39 distinct values, 317 declarations
  0.8 0.82 0.84 0.86 0.88 0.9 0.92 0.94 0.95 0.96 0.98 1 1.02 1.03 1.04 1.05
  1.08 1.1 1.12 1.15 1.2 1.25 1.3 1.35 1.36 1.4 1.42 1.45 1.5 1.52 1.54 1.55
  1.6 1.65 1.68 1.7 1.75 1.9

letter-spacing: 42 distinct values, 293 declarations
  -0.075 -0.07 -0.067 -0.065 -0.062 -0.06 -0.055 -0.05 -0.045 -0.04 -0.035
  -0.03 -0.025 -0.02 -0.015 -0.012 -0.01 0 0.02 0.025 0.03 0.035 0.04 0.045
  0.05 0.06 0.065 0.07 0.075 0.08 0.085 0.09 0.1 0.11 0.12 0.13 0.14 0.15 0.16 0.5  (em)
```

The tell in each case is the singletons that sit one imperceptible step from a common value: `font-weight` 420/430/440/460/670/690 (one or two uses each) against 400/450/650/700; `line-height` 1.02/1.03/1.04 against 1.05, and 1.52/1.54 against 1.55; `letter-spacing` -0.062em and -0.067em against -0.065em, and -0.012em/-0.015em against -0.01em.

- **Why it matters:** Manrope's variable axis makes every integer weight addressable, and the codebase has treated that as an invitation to pick a number rather than a step. Thirty-seven weights cannot encode a hierarchy a reader can learn; four or five can. The same applies to 39 line-heights, where differences of 0.01 are arithmetic noise.
- **User impact:** All roles. The product's emphasis hierarchy is not learnable, because "important" is variously 720, 730, 740, 750, 760, 780 or 790. This underlies VD-1.
- **Effort:** L (1–2d) — 1187 declarations across three properties; each collapse is a visual change requiring review.
- **Confidence:** High (proved) for the census. The claim that specific pairs are imperceptible is typographic judgement, argued from the magnitude of the difference.
- **How to prove:** Already proved for the counts.

---

### DS-7 — 307 lines of provably dead CSS, all residue of card compositions that recorded decisions replaced

- **Classification:** dead CSS
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** 31 wholly-dead rules in three CSS modules (186 lines) and 21 wholly-dead rules in `globals.css` (121 lines):

**`components/financials/player-financials.module.css` — 62 lines, the superseded Fee Record dashboard card**
`:6-14` `.dashboardLink` · `:17-23` `.dashboardIcon, .dashboardArrow` · `:25-27` `.dashboardIcon` · `:30-34` `.dashboardIcon svg, .dashboardArrow svg` · `:36-40` `.dashboardArrow` · `:42-47` `.dashboardLink:hover .dashboardArrow` · `:49-53` `.dashboardCopy` · `:55-62` `.dashboardEyebrow` · `:64-71` `.dashboardCopy h3` · `:73-78` `.dashboardCopy > span:last-child`

**`components/announcements/announcements.module.css` — 41 lines, the superseded announcements dashboard card**
`:158-162` `.dashboardHeader` · `:164-172` `.dashboardIcon` · `:174-178` `.dashboardIcon svg` · `:180-186` `.dashboardHeader p` · `:188-195` `.dashboardHeader h3` · `:197-203` `.dashboardHeader .dashboardUnavailableTitle`

**`components/coach/announcements/announcements.module.css` — 83 lines, the superseded announcement composer**
`:386-389` `.workspaceHeader` · `:421-424` `.panelHeading` · `:436-440` `.composerFields` · `:506-513` `.locationFieldset` · `:515-519` `.locationFieldset > div` · `:522-532` `.locationFieldset > div > label, .checkOption` · `:534-536` · `:539-544` · `:547-550` · `:553-557` · `:560-564` · `:566-571` `.optionsGrid` · `:573-575` `.checkOption` · `:577-585` `.composerActions` · `:587-591` `.composerActions p`

**`app/globals.css` — 121 lines**
`.coach-registration-approved`: `:4106-4113`, `:4115-4126`, `:4128-4131`, `:4133-4136`, `:4138-4141`, `:4143-4148`, `:4150-4157`, `:4159-4163`, `:4165-4169`, `:4177-4187`, `:4189-4192`, `:11452-11455`, `:11457-11460`
`.coach-member-batch-field`: `:4740-4742`, `:4744-4748`, `:4750-4752`, `:4754-4757`, `:4759-4770`, `:4772-4776`, `:4778-4783`, `:4785-4788`

Additionally **9 selector lists contain a dead fragment while the rule stays live** (e.g. `components/coach/announcements/announcements.module.css:393` `.workspaceHeader h1, .archiveHeader h1, .detailHeader h1` — the first selector never matches).

- **Evidence:** here is how I searched and what I ruled out. I enumerated every dynamic `className` construction in the repository:

```
$ rg -n 'styles\[' app components lib
components/coach/financials/financials-rapid-desk.tsx:586:  ? styles[`status_${player.status}`]
components/coach/financials/financials-rapid-desk.tsx:587:  : styles[player.hasActiveFeePlan
components/coach/financials/financials-rapid-desk.tsx:588:      ? `status_${player.status}`
components/coach/financials/financials-rapid-desk.tsx:589:      : "status_setup_required"]
components/coach/financials/player-ledger.tsx:1480:  <em className={styles[`status_${ledger.status}`]}>
components/coach/financials/player-ledger.tsx:1532:  <em className={styles[`status_${charge.status}`]}>
```

`status_*` is the **only** dynamically-constructed CSS-module key in the codebase. My first pass flagged `status_paid`, `status_pending` and `status_void` as dead; they are alive through exactly this construction, and I removed them. For `globals.css` I flagged 12 candidates and eliminated 10 of them the same way:

| Flagged | Verdict | Constructor |
|---|---|---|
| `.is-info` `.is-success` `.is-error` | **alive** | `` `inline-notice is-${tone}` `` `components/inline-notice.tsx:53`, `InlineNoticeTone = "success" \| "error" \| "info"` at `:3` |
| `.is-paused` `.is-unassigned` | **alive** | `` `coach-member-status is-${player.training.status}` `` `components/coach/members/member-directory.tsx:697`, enum `["unassigned","active","paused"]` at `lib/db/schema.ts:476` |
| `.status-published` `.status-revision` | **alive** | `` `status-${getCoachReportState(report)}` `` `components/coach/reports/report-workspace.tsx:386`, returns `"not-started"\|"draft"\|"revision"\|"published"` at `lib/coach/report-utils.ts:35-43` |
| `.is-month` | **alive** | `` `coach-calendar-workspace is-${mobileView}` `` `components/coach/calendar/session-calendar.tsx:221` |
| `.is-future` `.is-rescheduled` | **alive** | `"is-" + singleState` `components/dashboard/player-attendance-card.tsx:418` |
| `.coach-registration-approved` | **dead** | see below |
| `.coach-member-batch-field` | **dead** | see below |

For the two survivors I searched every plausible fragment and casing:

```
$ for frag in registration-approved registrationApproved coach-registration \
              member-batch-field memberBatchField batch-field batchField; do
    rg -n "$frag" app components lib --glob '!*.css' || echo "   (no non-CSS match)"
  done
   (no non-CSS match)   × 7
```

- **Why it matters:** All three module clusters are the same event: a recorded design decision replaced a card composition, the TSX was rewritten against new class names, and the old CSS was never deleted. `player-announcements.tsx:44` now renders `` `${styles.dashboardCard} dashboard-card player-ticket-card player-ticket-announcements` `` — the global Match Ticket classes from decision *player-dashboard-companion-cards* — while keeping only `.dashboardCard` (two declarations) from the module. `.21st/DESIGN.md:196-200` records a dead-selector pass and marks it **"Resolved"**; 307 lines survive it. That matters less as bytes than as a false signal: a maintainer reading `.dashboardEyebrow` in `player-financials.module.css:55` will reasonably believe it styles something.
- **User impact:** None directly. The cost is maintainer time and the risk of "fixing" a style that has no effect.
- **Effort:** S (<2h) to delete, given the evidence above.
- **Confidence:** High (proved) — every dynamic construction in the repository is enumerated above, and none can produce these keys.
- **How to prove:** Already proved. A CI guard would be the durable fix; see PR-6.

**Correction (verified during implementation):** the finding stands — every rule enumerated above is dead — but three things about it are wrong or missing, and all three matter to whoever deletes them. Full evidence in `docs/audit/verification-log.md`.

*The summary ranges are unsafe; this per-rule list is authoritative.* PR-2 below gives `app/globals.css` (`:4106-4192`, …). That range spans a live rule: `.coach-registration-approved p span, .coach-directory-notice{ … }` at `:4171-4175`, where `.coach-directory-notice` is used at `components/coach/members/member-directory.tsx:617`. The enumerated list above is correct and skips it, leaving the gap at `:4170-4176` deliberately. Delete from the list, never from the range. The dead half of that rule is also a **tenth** fragment of the kind counted as nine above — the other nine are all in `components/coach/announcements/announcements.module.css`.

*The search above never covered `tests/`.* Both keys are still dead in product code, but `tests/accessibility-hardening.test.ts:48` asserts that `app/globals.css` contains the string `".coach-registration-approved p input:not("`, and `:59` asserts that it does not contain `".coach-member-batch-field input"`. Both hold today, because the anti-zoom block at `app/globals.css:12909` was not touched. Deleting the remaining `.coach-registration-approved` rules will fail that test. This is the cost DEBT-2 describes, arriving in practice: a CSS refactor blocked by an assertion on file contents rather than on behaviour.

*307 is a lower bound.* The count is sound to within a 16-line bookkeeping artifact — seven of the multi-line selector lists were counted from the brace line rather than the first selector line, and the nine fragments were never given a line count, which is exactly the 7 + 9 by which an implementation removing only these rules overshot 307. No extra CSS was deleted. But roughly 30 further dead rules were missed, nearly all inside media queries: in `app/globals.css`, the `.coach-member-batch-field` fragments at `:4693`, `:4704` and `:4735` that are mixed with live `.coach-member-form-grid` selectors, the media-query rules at `:6525`, `:6553`, `:6559`, `:6563`, `:6681`, `:11931` and `:11936`, and the anti-zoom selector at `:12909`; eight rules within `components/coach/announcements/announcements.module.css:1314-1381`; and in `components/financials/player-financials.module.css`, `.dashboardCard` at `:1`, `.dashboardLink` at `:724`, `.dashboardCopy h3` at `:731` and the `.dashboardArrow` fragment at `:1001`. The finding is incomplete, not wrong.

That last file also contradicts the narrative in *Why it matters* above. The module whose `.dashboardCard` is live is `components/announcements/announcements.module.css:152`; the identically-named `.dashboardCard` at `components/financials/player-financials.module.css:1` has no consumer at all, since all three `styles.dashboardCard` references in the repository are in `components/announcements/player-announcements.tsx` and import the announcements module. Two modules share the class name and the finding reasoned about the wrong one.

---

### DS-8 — `.21st/DESIGN.md` has drifted from the code in five specific, checkable ways

- **Classification:** architecture
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `.21st/DESIGN.md:26`, `:58-60`, `:108`, `:133-134`, `:196-200`
- **Evidence:** in each case I believe **the document is stale and the code is correct**, because every discrepancy is in the direction of the document describing a slightly larger/older tree:

| # | DESIGN.md claim | Reality | Which is right |
|---|---|---|---|
| 1 | `:26` "app/globals.css (14,013 lines), app/public-home.css (2,360 lines)" | 13,985 and 2,359 | Document stale by 28 and 1 lines |
| 2 | `:59-60` "`--portal-header-height` becomes `70px` … at app/globals.css:**5763**" | The override is at `app/globals.css:5738` | Document stale — consistent with #1's 28-line drift |
| 3 | `:108` lists `--player-dashboard-header-gap: 16px` under **Spacing** as one of the `:root` tokens | It is declared at `app/globals.css:2594`, inside a component-scoped block, not in `:root`. The Tokens section header says "All 54 tokens are declared in the single `:root` block" but the sections list **55** entries | Document wrong: `:root` has exactly 54 and this is not one of them |
| 4 | `:133-134` "`--shadow-keyline-bottom` … (**6 uses**, 4 files)" | 5 uses in 4 files: `globals.css:3892`, `public-home.css:975`, `player-onboarding-register.module.css:238` and `:644`, `player-financials.module.css:280` | Document stale by one |
| 5 | `:196-200` "**Resolved:** … removed in the dead-selector pass" | 307 lines of wholly-dead CSS remain (DS-7) | Document overstates; the pass was real but partial |

Verification for #3 and #4:

```
$ rg -n 'player-dashboard-header-gap' app components
app/globals.css:2594:  --player-dashboard-header-gap: 16px;
app/globals.css:2693:  gap: var(--player-dashboard-header-gap);
components/announcements/announcements.module.css:161:  gap: var(--player-dashboard-header-gap, 16px);

$ rg -n 'shadow-keyline-bottom' app components
app/globals.css:92:  --shadow-keyline-bottom: inset 0 -3px 0 var(--red);
app/globals.css:3892:  box-shadow: var(--shadow-keyline-bottom);
components/coach/onboarding/player-onboarding-register.module.css:238:  box-shadow: var(--shadow-keyline-bottom);
components/coach/onboarding/player-onboarding-register.module.css:644:  box-shadow: var(--shadow-keyline-bottom);
components/financials/player-financials.module.css:280:  box-shadow: var(--shadow-keyline-bottom);
app/public-home.css:975:  box-shadow: var(--shadow-keyline-bottom);
```

Note that of the three reads of `--player-dashboard-header-gap`, the one at `components/announcements/announcements.module.css:161` is inside `.dashboardHeader`, which DS-7 proves dead. The token therefore has **one** live read.

There is also a **documentation gap rather than an error**: DESIGN.md's Tokens section states the 54 `:root` tokens are "the single source of truth" and does not mention that the codebase has two further tiers of custom property — **14 component-scoped declarations** in 4 CSS files (`--player-dashboard-card-padding`, `--player-dashboard-icon-size`, `--player-dashboard-icon-glyph`, `--player-dashboard-header-gap`, `--register-date-width`, `--register-name-width`, `--player-ticket-paper`, `--player-ticket-pad-x`, `--player-ticket-pad-y`, `--fee-paper`, `--fee-paid`, `--fee-due`, `--coach-ticket-paper`, `--public-mobile-header-height`) and **10 supplied at runtime from TSX inline styles** (see DS-9).

- **Why it matters:** The header at `.21st/DESIGN.md:2-9` explicitly warns that a `21st init --refresh` discards hand corrections and must be re-applied — which tells me this file is maintained deliberately and is meant to be trusted. Five checkable errors is few for a 294-line document, but items #3 and #5 are the kind that mislead: #3 invites a developer to write `var(--player-dashboard-header-gap)` in an unrelated file expecting a global token, and get nothing.
- **User impact:** None. Maintainer-facing.
- **Effort:** S (<2h).
- **Confidence:** High (proved).
- **How to prove:** Already proved.

---

### DS-9 — Register column widths are duplicated between CSS custom properties and TypeScript arithmetic, with nothing keeping them in sync

- **Classification:** duplication / token gap
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `app/globals.css:3769-3783`, `app/globals.css:6249-6253`, `components/coach/player-attendance-register.tsx:141-142`, `components/coach/staff-attendance-register.tsx:71-72`
- **Evidence:**

```css
/* app/globals.css:3769-3783 */
.coach-register-table {
  --register-date-width: 58px;
  --register-name-width: 250px;
  width: var(--register-width);
  min-width: var(--register-width);
  …
}

.staff-register-table {
  --register-date-width: 54px;
  --register-name-width: 240px;
  width: var(--staff-register-width);
  min-width: var(--staff-register-width);
}
```
```css
/* app/globals.css:6249-6253, inside a mobile media query */
  .coach-register-table {
    --register-date-width: 54px;
    --register-name-width: 148px;
    width: var(--register-mobile-width);
    min-width: var(--register-mobile-width);
  }
```
```tsx
/* components/coach/player-attendance-register.tsx:141-142 */
    "--register-width": `${250 + dates.length * 58}px`,
    "--register-mobile-width": `${148 + dates.length * 54}px`,
```
```tsx
/* components/coach/staff-attendance-register.tsx:71-72 */
    "--staff-register-width": `${240 + dates.length * 54}px`,
    "--register-mobile-width": `${148 + dates.length * 54}px`,
```

The six magic numbers `250`, `58`, `240`, `54`, `148`, `54` each appear in two places — once as a CSS custom property that sizes the `<col>` elements, once as a TypeScript literal that computes the table's total width. `--register-name-width` is read at exactly one place (`app/globals.css:3787`) and `--register-date-width` at exactly one (`app/globals.css:3791`).

Note further that `.staff-register-table` declares `--register-date-width: 54px` and `--register-name-width: 240px` at `:3780-3781`, but the only readers of those properties are `.coach-register-table col.coach-register-name-col` and `.coach-register-table col.coach-register-date-col`. Whether the staff table's overrides reach a reader depends on whether the staff markup also carries `.coach-register-table` — which I did not verify.

- **Why it matters:** The CSS and the JS must agree or the table's declared total width will not equal the sum of its columns, producing either a horizontal scrollbar that should not exist or a sticky-column misalignment. Nothing — no test, no shared constant, no type — enforces the agreement. This is the one finding in this report where a future edit produces a *visible* layout break rather than a subtle inconsistency.
- **User impact:** Head coach on `/coach/attendance` (player register) and the staff register, on mobile in particular, where `148 + dates.length * 54` drives horizontal scroll of a wide annual table. A change to either side alone misaligns the sticky name column against the date columns.
- **Effort:** S (<2h) — export the six numbers from one TS module and emit the CSS values as inline custom properties from the same source, or compute the total width in CSS with `calc()` from the existing custom properties and delete the TS arithmetic.
- **Confidence:** High (proved) that the values are duplicated. Medium on the consequence, which is a layout assertion I did not render.
- **How to prove:** For the consequence: in the browser on `/coach/attendance`, compare `document.querySelector('.coach-register-table').getBoundingClientRect().width` against the sum of `[...document.querySelectorAll('.coach-register-table col')].map(c=>getComputedStyle(c).width)`.

---

### DS-10 — 27 `!important` declarations in `financial-records.module.css` override that module's own rules

- **Classification:** architecture
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `components/coach/financials/financial-records.module.css` — `:402`, `:416`, `:417`, `:418`, `:419`, `:605`, `:607`, `:662`, `:1001`, `:1002`, `:1004`, `:1005`, `:1010`, `:1019`, `:1028`, `:1033`, `:1034`, `:1336`, `:1339`, `:1340`, `:1351`, `:1353`, `:1354`, `:1360`, `:1366`, `:1384`, `:1385`
- **Evidence:**

```
$ rg -c '!important' app components
app/globals.css:28
components/coach/financials/financial-records.module.css:27
app/public-home.css:4
components/coach/financials/financials.module.css:2
```

`globals.css`'s 28 and `public-home.css`'s 4 are almost entirely legitimate: the `.sr-only` utility (`:110-121`, 10 declarations, with a comment at `:108-109` explaining that unlayered CSS is required to outrank a Tailwind cascade layer), the two `prefers-reduced-motion` blocks, an iOS zoom-prevention `font-size: 16px !important`, and a focus-outline rule. `financial-records.module.css` has no such justification — it is a scoped module fighting itself:

```css
/* components/coach/financials/financial-records.module.css:307-313 */
.filters label > span:first-child {
  color: var(--steel);
  font-size: 10px;
  font-weight: 790;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}
```
```css
/* components/coach/financials/financial-records.module.css:415-420 */
.checkboxField > span {
  color: var(--navy) !important;
  font-size: 12px !important;
  letter-spacing: 0 !important;
  text-transform: none !important;
}
```

`.filters label > span:first-child` has specificity (0,3,0); `.checkboxField > span` has (0,2,0). The later rule loses on specificity, so four `!important`s were added instead of tightening the selector to `.filters .checkboxField > span` (0,3,0) or reordering.

- **Why it matters:** Inside a CSS Module, class names are hashed and the whole point is that specificity stays flat and local. Reaching for `!important` 27 times means the file has grown a de-facto inheritance hierarchy (`.filters` styling all its descendants' labels) that its authors then have to escape. The `:1001-1034` and `:1336-1385` clusters do the same thing inside media queries, which is where cascade bugs are hardest to reason about.
- **User impact:** None visible today. It is a change-safety problem: the next person editing the Fee Register's responsive table has to reason about 27 escape hatches.
- **Effort:** M (half day) — restructure so descendant rules are scoped to their own key rather than to `.filters`, then remove the `!important`s and verify.
- **Confidence:** High (proved) for the inventory and the specificity arithmetic. Medium for the claim that removing them is safe, which needs rendering.
- **How to prove:** For safety: remove and compare screenshots of `/coach/financials/records` at desktop, 900px and 380px.

---

### VD-4 — Two ticket-paper tokens hold byte-identical values under different names; a third sibling surface uses a different tint

- **Classification:** duplication / token gap
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `app/globals.css:10205`, `components/coach/dashboard-card.module.css:2`, `components/financials/player-financials.module.css:81`
- **Evidence:**

```
$ rg -n 'ticket-paper|fee-paper' app components
app/globals.css:10205:  --player-ticket-paper: color-mix(in srgb, var(--white) 88%, var(--ivory));
app/globals.css:10228:  background: var(--player-ticket-paper);
components/coach/dashboard-card.module.css:2:  --coach-ticket-paper: color-mix(in srgb, var(--white) 88%, var(--ivory));
components/coach/dashboard-card.module.css:58:  background: var(--coach-ticket-paper);
components/financials/player-financials.module.css:81:  --fee-paper: color-mix(in srgb, var(--white) 78%, var(--ivory));
components/financials/player-financials.module.css:219:  background: var(--fee-paper);
components/financials/player-financials.module.css:297:  background: var(--fee-paper);
components/financials/player-financials.module.css:432:  background: var(--fee-paper);
components/financials/player-financials.module.css:451:  background: var(--fee-paper);
```

The two 88% values are character-for-character identical. The related ticket-notch geometry is also duplicated verbatim:

```css
/* app/globals.css:10231-10242 */
.player-ticket-dashboard .player-ticket-card::before,
.player-ticket-dashboard .player-ticket-card::after {
  position: absolute;
  top: calc(50% - 9px);
  z-index: 2;
  width: 10px;
  height: 18px;
  border: 1px solid var(--line);
  background: var(--ivory);
  content: "";
  pointer-events: none;
}
```
```css
/* components/coach/dashboard-card.module.css:61-72 */
.card::before,
.card::after {
  position: absolute;
  top: calc(50% - 9px);
  z-index: 2;
  width: 10px;
  height: 18px;
  border: 1px solid var(--line);
  background: var(--ivory);
  content: "";
  pointer-events: none;
}
```

Nine declarations, no differences.

- **Why it matters:** `.21st/DESIGN.md:239` records decision *shared-scoreboard-hero-rhythm*: "Keep the player and head-coach scoreboard heroes visually paired." `:240` (*coach-dashboard-card-system*) and `:277` (*player-dashboard-companion-cards*) both specify "fine borders, clipped circular ticket notches, dashed mastheads". The pairing is an explicit product decision, and it is currently maintained by two people keeping two copies identical by hand. The `--fee-paper` divergence at 78% shows what happens when they do not: the player Fee Record's ticket paper is a measurably warmer, more ivory surface than the player Dashboard ticket that links to it.
- **User impact:** Player, navigating from the Dashboard fee ticket to the Fee Record page. Both are "ticket paper" in the same visual language and they are different tints. Head coach and player see byte-identical tickets today, but only by coincidence of maintenance.
- **Effort:** S (<2h) to promote one `--ticket-paper` token to `:root` and share the notch as one class; the 78% → 88% reconciliation is a deliberate visual change and should be a separate decision.
- **Confidence:** High (proved) for the duplication. The claim that 78% and 88% are noticeably different is a judgement — the difference is a 10% shift in ivory content over white.
- **How to prove:** Compare `/player` and `/player/financials` side by side.

---

### DS-11 — Two typography tokens hold the same value under different names, which is likely why neither is used

- **Classification:** token gap
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `app/globals.css:83`, `app/globals.css:85`
- **Evidence:**

```css
/* app/globals.css:82-86 */
  --type-utility-label: 11px;
  --type-utility-meta: 12px;
  --type-operational-body: 13px;
  --type-operational-action: 12px;
  --type-operational-floor: 10px;
```

`--type-utility-meta` and `--type-operational-action` are both `12px`. Their combined read count is **5** (`2` and `3`), against **131** literal `font-size: 12px` declarations — the joint-lowest adoption of any token in the set.

- **Why it matters:** When two tokens have the same value, a developer writing a 12px label has to decide whether their label is "utility meta" or "operational action", cannot tell from the names, and writes `12px`. Two tokens that are indistinguishable at the point of use are worse than one, because they impose a decision with no observable consequence. This is a plausible mechanism for the specific adoption collapse in DS-1 and worth stating separately, because fixing DS-1 without fixing this reproduces the ambiguity.
- **User impact:** None directly; contributes to DS-1.
- **Effort:** S (<2h).
- **Confidence:** High (proved) for the duplicate value and the read counts. Medium for the causal claim about why adoption is low — that is inference from the pattern, not from a developer's testimony.
- **How to prove:** The values and counts are proved above.

---

### DS-5 — Twenty declarations request a font weight above the family's declared 200–800 axis

- **Classification:** typography
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** every site:

```
app/globals.css:151    font-weight: 820;
app/globals.css:181    font-weight: 820;
app/globals.css:880    font-weight: 850;
app/globals.css:2348   font-weight: 820;
app/globals.css:13053  font-weight: 850;
app/globals.css:13104  font-weight: 850;
app/globals.css:13151  font-weight: 850;
app/globals.css:13194  font-weight: 820;
app/globals.css:13384  font-weight: 850;
components/coach/onboarding/player-onboarding-register.module.css:82    font-weight: 820;
components/coach/onboarding/player-onboarding-register.module.css:171   font-weight: 820;
components/coach/onboarding/player-onboarding-register.module.css:196   font-weight: 830;
components/coach/onboarding/player-onboarding-register.module.css:284   font-weight: 830;
components/coach/onboarding/player-onboarding-register.module.css:384   font-weight: 820;
components/coach/onboarding/player-onboarding-register.module.css:411   font-weight: 830;
components/coach/onboarding/player-onboarding-register.module.css:472   font-weight: 820;
components/coach/onboarding/player-onboarding-register.module.css:503   font-weight: 820;
components/coach/onboarding/player-onboarding-register.module.css:599   font-weight: 820;
components/financials/player-financials.module.css:261  font-weight: 820;
components/financials/player-financials.module.css:481  font-weight: 820;
```

- **Evidence:** the axis maximum is declared in this same repository:

```css
/* app/globals.css:21-28 */
@font-face {
  font-family: Manrope;
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url("/fonts/manrope-normal-rupee.woff2") format("woff2");
  unicode-range: U+20B9;
}
```

`app/layout.tsx:6-10` loads Manrope through `next/font/google` with no `weight` restriction, i.e. the full variable axis, which for Manrope is 200–800. Per CSS Fonts Level 4, a requested weight outside a variable font's `wght` range is clamped to the nearest end of the range, so `820`, `830` and `850` all resolve to `800`.

- **Why it matters:** Twenty declarations express an intent — "heavier than the heaviest bold" — that cannot be honoured. They are indistinguishable from `800` in output, so they add three phantom steps to an already 37-value weight ladder while changing nothing. `player-onboarding-register.module.css` is the clearest case: it uses `820` six times, `830` three times and `800` once, i.e. three intended tiers of maximum emphasis that all render as one.

```
$ rg -o 'font-weight:\s*[0-9]+' components/coach/onboarding/player-onboarding-register.module.css | sort | uniq -c | sort -rn
   6 font-weight: 820
   4 font-weight: 650
   4 font-weight: 620
   4 font-weight: 560
   3 font-weight: 830
   3 font-weight: 780
   …
   1 font-weight: 800
```
- **User impact:** Head coach on the Player Onboarding register (9 of the 20 sites) and player on the Fee Record. A hierarchy the designer intended between two label levels does not render. No functional impact.
- **Effort:** S (<2h) — normalise to `800`, then decide separately whether the intended contrast needs size or colour instead.
- **Confidence:** Medium (strong static inference). I proved the declared axis and the declared values from source; I did not observe the rendered glyphs. Clamping is specified behaviour, but I did not verify it in this browser/font combination.
- **How to prove:** In the browser console on `/coach/onboarding`:
  `[...document.querySelectorAll('*')].filter(e=>['820','830','850'].includes(getComputedStyle(e).fontWeight)).map(e=>[e.className, e.getBoundingClientRect().width])`
  then compare the measured width of the same text node with `font-weight: 800` forced. Equal widths confirm clamping.

---

### VD-5 — The signed-in account menu is two independent implementations that disagree on eleven properties

- **Classification:** duplication / architecture
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:** `app/globals.css:1423-1470` (`.account-menu`, portal) and `app/public-home.css:164-215` (`.header-account-menu`, public)
- **Evidence:**

| Property | portal `.account-menu` | public `.header-account-menu` |
|---|---|---|
| offset from trigger | `calc(100% + 12px)` | `calc(100% + 10px)` |
| width | `min(260px, calc(100vw - 32px))` | `240px` — no viewport clamp |
| padding | `10px` | `8px 16px 12px` |
| border | `1px solid rgba(7, 27, 50, 0.12)` | `1px solid rgba(7, 27, 50, 0.12)` — identical |
| background | `var(--white)` | `var(--ivory)` |
| drop shadow | `0 24px 60px rgba(7, 27, 50, 0.14)` | `0 24px 50px rgba(7, 27, 50, 0.13)` |
| label colour | `var(--steel)` | `var(--red)` |
| label size | `10px` | `11px` |
| label tracking | `0.1em` | `0.13em` |
| row divider | `1px solid var(--line)` | `1px solid #dde0e2` |
| name overflow | `text-overflow: ellipsis; white-space: nowrap` | `overflow-wrap: anywhere` |

- **Why it matters:** and why this is a suggestion rather than a defect — `.21st/DESIGN.md:263` records decision *mobile-account-menu-freeze*, which explicitly says "Preserve **both** portal and public account-menu width, positioning, spacing, controls, wording and interaction behavior." The divergence is therefore **deliberate and frozen**, and I am not going to call a recorded decision a defect. Two things are still worth raising. First, the freeze covers width, positioning, spacing, controls and wording — it does not say anything about whether the row divider is `var(--line)` or `#dde0e2`, and those two differ by ΔE 1.93, i.e. the tokenisation is available at essentially zero visual cost. Second, the two menus handle a long name in opposite ways (`ellipsis` versus `overflow-wrap: anywhere`), which is a behaviour difference the freeze arguably did intend to cover, since `:263` speaks specifically about clamping long signed-in names.
- **User impact:** Any signed-in user who visits the public homepage and then the portal — the two menus open from the same header and look like the same component with slightly different weight, colour and warmth. Since this is frozen, the impact is accepted; the divider tokenisation is the only part I would actually change now.
- **Effort:** S (<2h) for the divider tokenisation alone. L, and a separate design milestone, to unify the two.
- **Confidence:** High (proved) for the property-by-property divergence.
- **How to prove:** Already proved from source.

---

### DS-12 — `app/layout.tsx:82` hardcodes the exact value of `--navy` where a token cannot reach

- **Classification:** hardcoded value
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `app/layout.tsx:81-83`
- **Evidence:**

```tsx
export const viewport: Viewport = {
  themeColor: "#071b32",
}
```

`#071b32` is exactly `--navy` (`app/globals.css:50`). This is the single finding in the 21st report at `app/layout.tsx:82:16`, and the **only** site anywhere in the project where an opaque literal exactly duplicates a token's value:

```
opaque literals OUTSIDE :root that EXACTLY equal a token value (CSS): count = 0
```

- **Why it matters:** A Next.js `Viewport` metadata object is evaluated on the server and cannot read a CSS custom property, so the duplication is genuinely unavoidable in this form. But it is unguarded: if `--navy` changes, the browser chrome colour on Android and iOS PWA silently keeps the old brand navy, and nothing fails.
- **User impact:** Player or coach who installs the portal to a home screen, or uses Chrome on Android: the browser UI tint would diverge from the app's own navy after a palette change.
- **Effort:** S (<2h) — export the value from one TS constant and either generate the `:root` declaration from it or add a test asserting the two match.
- **Confidence:** High (proved).
- **How to prove:** Already proved.

---

### DS-13 — Two colour tokens have a single read each and no semantic role the palette explains

- **Classification:** token gap
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:** `app/globals.css:61` (`--mist`), `app/globals.css:51` (`--navy-soft`); reads at `app/globals.css:889` and `app/globals.css:1756`
- **Evidence:**

```
$ rg -n 'var\(--mist' app components
app/globals.css:889:  background: var(--mist);

$ rg -n 'var\(--navy-soft' app components
app/globals.css:1756:  background: var(--navy-soft);
```

Against the read counts of the tokens that carry the system: `--navy` 495, `--line` 492, `--steel` 323, `--red` 273, `--white` 257, `--ivory` 97.

Note also that no token is entirely unread — the "declared but never read" set is empty (see §3). These two are the closest thing to dead tokens.

- **Why it matters:** A colour that appears once is a one-off, and naming it as a token implies to the next reader that it is a role in the system. `--mist` (`#e7eaed`) in particular sits between `--line` (`#d7dbde`) and `--ivory-deep` (`#efebe3`) with no documented job, which invites someone to reach for it for a hairline and produce a fourth grey.
- **User impact:** None. Maintainer-facing.
- **Effort:** S (<2h) — either inline them at their single call site, or give each a documented role in DESIGN.md.
- **Confidence:** High (proved) for the counts; the recommendation is a judgement.
- **How to prove:** Already proved.

---

### VD-6 — Two H1 clamps differ only in their `vw` coefficient, on surfaces that are otherwise identical

- **Classification:** typography / duplication
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `app/globals.css:4960` versus `app/globals.css:4087`, `:5012`, `:8872`, `components/coach/announcements/announcements.module.css:396`, `components/coach/financials/financials.module.css:28`
- **Evidence:**

```
$ rg -n 'clamp\(58px, (7\.5|8)vw, 102px\)' app components
app/globals.css:4087:  font-size: clamp(58px, 7.5vw, 102px);
app/globals.css:4960:  font-size: clamp(58px, 8vw, 102px);
app/globals.css:5012:  font-size: clamp(58px, 7.5vw, 102px);
app/globals.css:8872:  font-size: clamp(58px, 7.5vw, 102px);
components/coach/announcements/announcements.module.css:396:  font-size: clamp(58px, 7.5vw, 102px);
components/coach/financials/financials.module.css:28:  font-size: clamp(58px, 7.5vw, 102px);
```

Five sites use `7.5vw`; one uses `8vw`. Because the min and max are the same, the two expressions agree at every viewport except the band where the `vw` term is the winning value — roughly 773px to 1360px for `7.5vw` and 725px to 1275px for `8vw` — so on a 1024px-wide tablet the outlier renders at 81.9px against 76.8px everywhere else.

The five matching sites also share five further declarations exactly, in four different files:

```
{ color: var(--navy); font-size: clamp(58px, 7.5vw, 102px); font-weight: 545;
  letter-spacing: -0.075em; line-height: 0.9; margin-top: 16px }
```
`app/globals.css:4084` `.coach-members-directory-header h1` · `app/globals.css:5009` `.coach-reports-workspace-header h1` · `components/coach/announcements/announcements.module.css:393` `.workspaceHeader h1, .archiveHeader h1, .detailHeader h1` · `components/coach/financials/financials.module.css:25` `.activationHeader h1`

- **Why it matters:** This is the canonical coach-workspace page title, copy-pasted into four files, and one copy has drifted. It is a small, sharp example of DS-1's general problem: because there is no `--type-page-title` token or shared class, "the page title" is six independent declarations and only five agree.
- **User impact:** Head coach on a tablet, moving between workspace pages: one page title is about 7% larger than the others. Below the threshold of complaint, above the threshold of "something feels off".
- **Effort:** S (<2h).
- **Confidence:** High (proved) for the source divergence. Medium for the specific pixel figures, which are arithmetic from the clamp, not observed.
- **How to prove:** For the rendered sizes, at a 1024px viewport: `getComputedStyle(document.querySelector('h1')).fontSize` on each of the six surfaces.

---

### DS-14 — The 1px hairline is used 583 times and has no token, unlike every other primitive in the system

- **Classification:** token gap
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:** distributed across all 12 CSS files. Border-width census:

```
 583  1px
   8  2px
   4  1.5px
   3  3px
   2  4px
   2  25px
```

- **Evidence:** the four `1.5px` sites, which are the anomaly worth naming:

```
$ rg -n 'border[a-z-]*:\s*1\.5px' app components
app/globals.css:421:  border: 1.5px solid var(--red);
app/globals.css:491:  border: 1.5px solid var(--red);
components/financials/player-financials.module.css:358:  border-top: 1.5px solid var(--steel);
components/financials/player-financials.module.css:359:  border-right: 1.5px solid var(--steel);
```

and the `25px` pair, which is not a border at all but the classic triangle trick:

```css
/* components/coach/announcements/announcements.module.css:86-90 */
  right: 0;
  width: 0;
  height: 0;
  border-top: 25px solid var(--red);
  border-left: 25px solid transparent;
```

- **Why it matters:** 583 of 602 border widths being `1px` is *excellent* consistency — this is close to the healthiest axis in the system and I want to say so. The observation is only that this exceptionally stable primitive is the one the token layer does not name, while `--radius-xs: 2px` (2 reads) and `--type-utility-meta: 12px` (2 reads) do have names. The four `1.5px` sites are the drift a token would have prevented: two red 1.5px borders in `globals.css` against 8 sites of `2px` and 583 of `1px`, and 1.5px is the only width in the system that lands on a half-pixel at 1× device pixel ratio.
- **User impact:** Player on the Fee Record (`player-financials.module.css:358-359`), where a 1.5px rule sits among 1px rules. On a non-Retina display a 1.5px border renders as an antialiased grey rather than a crisp line.
- **Effort:** S (<2h).
- **Confidence:** High (proved) for the census. The half-pixel rendering claim is Medium — it is standard behaviour but I did not observe it.
- **How to prove:** For the rendering: view `/player/financials` at `devicePixelRatio === 1`.

---

### DS-15 — The palette has quietly grown from 23 declared colours to 72, with 49 undeclared values in 96 sites

- **Classification:** colour
- **Type:** Objective defect
- **Severity:** Low (as a standalone finding; its two sharpest sub-populations are DS-3 and VD-2, both High)
- **Location:** 96 sites, 49 distinct values. Grouped by the nearest declared token and sorted by perceptual distance:

| Cluster | Nearest token | Undeclared values (ΔE) | Sites |
|---|---|---|---|
| hairline greys | `--line` `#d7dbde` | `#d6dadd` (0.36), `#d5dadd` (0.56), `#d8dbdd` (0.63), `#d9dddf` (0.86), `#d2d6d9` (1.78), `#dde0e2` (1.93), `#ced4d7` (2.74), `#d8d5cf` (5.63), `#d7d2cb` (6.75) | 24 — **see DS-3** |
| dark greys / text | `--steel` `#596673`, `--text-placeholder` `#6b7480` | `#66727c` (2.00), `#53606c` (2.55), `#667387` (4.88), `#617083` (4.94), `#4a5661` (6.70), `#48535e` (7.89), `#48535d` (8.02), `#45515b` (8.91), `#39434d` (14.75), `#36404a` (16.06) | 20 |
| warm papers | `--ivory` `#f7f5f0`, `--ivory-deep` `#efebe3`, `--paper` `#fbfaf7` | `#fffdf8` (1.51), `#f3f2ef` (1.52), `#f3f3f1` (1.85), `#ebe9e5` (2.30), `#f0efec` (2.37), `#eee8dc` (2.41), `#f2eadc` (3.43) | 18 |
| reds / roses | `--red` `#c81d2a`, `--rose` `#f2a0a5`, `--rose-strong` `#f18b92` | `#f7a1a7` (1.78), `#ba1622` (4.36), `#cb2334` (4.49), `#ffb4ba` (7.40), `#f47c83` (8.85), `#f7b7bb` (10.13), `#ff7e8b` (11.18), `#ef555f` (19.02) | 15 |
| navies | `--navy` `#071b32`, `--navy-soft` `#0c2746`, `--ink` `#0c1117` | `#0a2441` (1.88), `#0b2d52` (4.68), `#030f1c` (5.32), `#041424` (6.22), `#000000` (6.50), `#081c42` (8.36) | 8 |
| greens | `--green` `#2d7656`, `--green-soft` `#e8f3ec` | `#207552` (3.41), `#17673c` (9.81), `#b9e4cc` (16.57), `#9bd3aa` (28.94), `#8dd9b6` (30.58) | 5 |
| ochres | `--makeup` `#e5b851`, `--makeup-dark` `#694500` | `#d9a735` (8.23), `#98641b` (15.96), `#f4d493` (22.82) | 4 |
| disabled | `--line-disabled` `#858d94` | `#a1a7ac` (10.06) | 2 |

- **Evidence:** 33 of the 96 sites are within ΔE 2 of an existing token — visually identical — and 59 within ΔE 5. Two representative pairs:

```
app/globals.css:2717   .attendance-track, .development-track { background: #d9dddf; }
                       -> --line #d7dbde, ΔE 0.86

app/globals.css:13318  .admin-directory-search-field svg { color: #667387; }
app/globals.css:13336  .admin-directory-search-field input::placeholder { color: #667387; }
app/globals.css:13347  (platform-admin meta text)   color: #667387;
app/globals.css:13358  (platform-admin meta text)   color: #667387;
app/globals.css:13392  (platform-admin meta text)   color: #667387;
app/globals.css:13459  (platform-admin meta text)   color: #667387;
                       -> --text-placeholder #6b7480, ΔE 4.88
```

The `#667387` cluster is notable because all six sites are in the platform-admin surfaces (`globals.css:13281-13520`), which is the newest area of the file — a whole role, "muted admin text", was implemented without touching the token that exists for it.

- **Why it matters:** Taken together the palette is now roughly three times its declared size. The high-ΔE members of each cluster (`#8dd9b6`, `#9bd3aa`, `#f4d493`, `#98641b`, `#ef555f`) are not accidents — they are the on-dark tier the token set lacks (VD-2). The low-ΔE members are pure drift. Separating the two is the whole value of this finding: about 33 sites should simply become `var()`, about 20 need new tokens for a role that genuinely does not exist yet, and the remainder are judgement calls.
- **User impact:** Diffuse. The concentrated impacts are itemised in DS-3 (public homepage hairlines) and VD-2 (coach on-dark states).
- **Effort:** L (1–2d) across all 96, but see PR-1 and PR-2 for the cheap high-value subsets.
- **Confidence:** High (proved) — every value, site and ΔE is computed.
- **How to prove:** Already proved.

---

## 3. What's working well

These are specific, load-bearing and worth protecting from casual change.

**The token layer has zero dead tokens.** All 68 custom properties declared anywhere in CSS are read at least once, and all 80 distinct `var()` reads resolve. The 12 that are not declared in CSS all resolve at runtime, and I traced every one:

```
--detail-row-wide, --detail-row-mobile, --month-column-wide, --month-row-wide,
--month-column-mobile, --month-row-mobile   -> components/financials/player-fee-record.tsx:315,316,539-542
--staff-register-width, --register-mobile-width  -> components/coach/staff-attendance-register.tsx:71,72
--register-width, --register-mobile-width        -> components/coach/player-attendance-register.tsx:141,142
--attendance-roster-rows                          -> components/coach/attendance/player-attendance-recorder.tsx:306
--font-manrope, --font-newsreader                 -> app/layout.tsx:7,19 (next/font)
```

For a 27,000-line hand-written CSS surface with no build-time token checker, a zero/zero result on both directions is genuinely rare.

**`--font-newsreader-upright` is deliberately unread, and says so.** `app/layout.tsx:25-35` declares a variable that nothing reads, purely so a second `next/font` instance emits its `@font-face` rules with `preload: false`. The comment explains exactly this. A dead-code sweep would delete it and silently re-add ~58KB of font preload per route; the comment is what prevents that. This is the kind of thing that is almost always undocumented and almost always broken later.

**The rupee-subset block is exemplary documentation of a non-obvious decision.** `app/globals.css:3-20` explains why three `@font-face` rules re-declare `U+20B9`, quantifies the bytes saved per route (15KB on `/`, 40KB on `/player` and `/coach`, 52KB on `/coach/financials/records`), states the cascade rule it depends on ("for overlapping unicode-ranges within a family the last rule declared wins"), and gives the regeneration command. Someone reading this in a year will not break it.

**`.sr-only` states why it must be unlayered.** `app/globals.css:108-121`, with the comment "Declared unlayered so it outranks the thousands of unlayered rules below it, which a utility-layer class cannot." That is the correct and non-obvious reason Tailwind's own `sr-only` was replaced.

**Radius is the healthiest axis in the system.** Eight distinct forms across the whole codebase, seven of which are tokens or an explicit `0`:

```
  23  var(--radius-circle)
  19  0
   7  var(--radius-pill)
   3  0 var(--radius-pill) var(--radius-pill) 0
   3  var(--radius-pill) 0 0 var(--radius-pill)
   2  var(--radius-sm)
   2  var(--radius-xs)
   1  3px            <- app/public-home.css:1405, .submit-button
```

`.21st/DESIGN.md:114-124` explains the deliberate squareness and even flags the single `3px` outlier as known drift. The document and the code agree, and the code is disciplined.

**z-index is a real, small, named stack.** Five app-level tokens (`--z-overlay` 40, `--z-header` 50, `--z-dialog` 90, `--z-skip-link` 100, `--z-admin-banner` 1000) plus exactly 15 local `1`/`2`/`3` declarations for sibling ordering inside their own stacking contexts. `.21st/DESIGN.md:156-158` claims 15; I counted 15 (8 × `1`, 6 × `2`, 1 × `3`). The rationale given — that sharing a token would couple 15 unrelated sites — is correct.

**Eight of the twelve CSS files contain zero colour literals.**

```
 3683 lines   309 var()      9 literals   components/coach/financials/financials.module.css
 1567 lines   136 var()      0 literals   components/coach/financials/financial-records.module.css
 1641 lines   157 var()      0 literals   components/coach/announcements/announcements.module.css
 1253 lines   144 var()      0 literals   components/coach/onboarding/player-onboarding-register.module.css
 1005 lines   141 var()      0 literals   components/financials/player-financials.module.css
  673 lines    53 var()      0 literals   components/announcements/announcements.module.css
  450 lines    47 var()      0 literals   components/coach/dashboard-card.module.css
  307 lines    32 var()      0 literals   components/coach/junior-coach-dashboard.module.css
  101 lines     8 var()      0 literals   components/coach/player-onboarding-card.module.css
   29 lines     0 var()      0 literals   components/reveal.module.css
```

Every colour drift in this report is concentrated in `globals.css`, `public-home.css` and nine lines of `financials.module.css`. The CSS Modules are clean. Whatever practice produced them should be the practice everywhere.

**Breakpoints are correctly *not* tokens, for the right reason.** `.21st/DESIGN.md:160-167` explains that a custom property cannot be used in a media-query prelude because media features are evaluated before custom-property substitution, and that the project has no `@custom-media` plugin. That is precisely right, and resisting the tempting-but-broken `--bp-md` token is a better outcome than adding one.

**`color-mix()` is a genuinely established house idiom — 95 sites across 8 of the 12 files.** Sixty-five of them express a tint as a percentage of one token over another (`color-mix(in srgb, var(--ivory) 72%, var(--white))`) and thirty express an alpha (`color-mix(in srgb, var(--navy) 8%, transparent)`). Every one of these survives a palette change, which is exactly what the 157 raw `rgba()` sites in DS-4 do not. The mechanism DS-4 recommends is not new to this codebase and does not need to be introduced — it needs to be made the only option.

**`--border` is a genuine alias, not a duplicate.** `app/globals.css:65` is `--border: var(--line)` — a reference, not a copy. If `--line` changes, `--border` follows. That is the right way to give one value two names.

**No `transition: all` anywhere**, and `prefers-reduced-motion` blocks in `globals.css:12929-12934`, `public-home.css:2341-2346` and `financials.module.css:3640-3643`. (Confirmed as given in the brief; I re-ran the `rg` to check it still holds.)

---

## 4. Token proposals

Ordered by value per unit of risk. "Call-site count" is the number of declarations the token would replace, measured, not estimated.

| Name | Value | What it replaces | Call sites | Risk of the change |
|---|---|---|---|---|
| *(use existing)* `--line` | `#d7dbde` | `#d6dadd`, `#d5dadd`, `#d8dbdd`, `#d9dddf`, `#d2d6d9`, `#dde0e2`, `#ced4d7` | **22** | **Very low.** Max ΔE 2.74; all in the hairline role. Output changes by an imperceptible amount at 1px. See DS-3. |
| *(use existing)* `--text-placeholder` | `#6b7480` | `#667387` ×6, `#617083` ×2 | **8** | **Low.** ΔE 4.88 and 4.94. All in muted-text or placeholder roles in the platform-admin surfaces. Visible only on direct comparison. |
| `--on-dark-success` | `color-mix(in srgb, var(--green) 45%, var(--white))` — exact value to be chosen by eye | `#b9e4cc`, `#8dd9b6`, `#9bd3aa` | **3** | **Medium.** Fixes a real inconsistency (VD-2) but necessarily changes two of the three surfaces. Needs a designer to pick the value. |
| `--on-dark-error` | on-navy rose, value TBD | `#ffb4ba`, `#f7a1a7` | **2** | **Medium.** Same as above. |
| `--on-dark-muted` | `rgba(255, 255, 255, 0.7)` | the existing two agreeing sites, plus a home for the 0.55–0.74 white-alpha cluster | 2 → up to 20 | **Low** for the two agreeing sites; **Medium** if the alpha cluster is normalised with it. |
| `--border-hairline` | `1px` | 583 literal `1px` border widths; would also give `1.5px` (4 sites) a value to snap to | 583 (adopt gradually) | **Very low** if adopted opportunistically; **not worth a mass rewrite** — the consistency is already 97%. Chiefly a naming/intent fix. See DS-14. |
| `--ticket-paper` (promote to `:root`) | `color-mix(in srgb, var(--white) 88%, var(--ivory))` | `--player-ticket-paper`, `--coach-ticket-paper` (identical), and a decision about `--fee-paper` at 78% | 2 identical + 1 divergent | **Very low** for the two identical ones (zero visual change). Reconciling `--fee-paper` is a visual change and a separate decision. See VD-4. |
| `--type-page-title` | `clamp(58px, 7.5vw, 102px)` | 6 H1 declarations, one of which has drifted to `8vw` | **6** | **Very low.** Five sites unchanged; one tablet-width size corrected. See VD-6. |
| `--eyebrow-*` set (one class, not tokens) | `font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase` + colour modifiers | the 103 micro-label variants | **160 rules** (44 in the top 8 variants) | **Medium.** Every collapse changes rendered tracking or size by a small amount at many sites. Highest design value in the report; do it in stages, biggest variant first. See VD-1. |
| *(merge)* `--type-utility-meta` / `--type-operational-action` | pick one name for `12px` | removes a duplicate-valued token pair | 5 reads to redirect | **Very low.** No visual change. See DS-11. |
| `--alpha-*` scale or `color-mix` convention | e.g. 4 / 8 / 12 / 20 / 35 / 55 / 70 % | the 157 raw `rgba()` alpha variants (65 distinct alphas) | **157** | **Medium–High.** Collapsing 65 alphas to ~7 steps is a visual change at most sites. Recommend converting to `color-mix` at the *current* alpha first (visually near-lossless, DS-4), and normalising the steps as a separate later pass. |

**Deliberately not proposed:** a `--radius-none` token (the 19 explicit `0`s say it better, per DESIGN.md), `--bp-*` breakpoint tokens (unusable in a media prelude, per DESIGN.md), and a token for the 15 local `z-index: 1/2/3` values (would couple unrelated stacking contexts).

---

## 5. Suggested PRs

Independent and parallelisable unless a dependency is stated. **File overlaps between my own PRs are flagged explicitly** — PR-1, PR-3 and PR-7 all touch `app/globals.css`, and PR-2 and PR-5 both touch `app/public-home.css`.

### PR-1 — Tokenise the hairline greys
- **Scope:** replace 7 near-identical greys with `var(--line)` at 22 sites.
- **Findings:** DS-3, part of DS-15.
- **Files:** `app/public-home.css` (21 sites), `app/globals.css` (1 site, `:2717`).
- **Effort:** S · **Risk:** Very low — max ΔE 2.74 at 1px widths.
- **Dependencies:** none.
- **Overlap:** `app/globals.css` with PR-3 and PR-7 (different line ranges); `app/public-home.css` with PR-5.

### PR-2 — Delete the 307 lines of dead CSS
- **Scope:** remove 31 wholly-dead module rules and 21 wholly-dead `globals.css` rules; trim the 9 dead selector fragments from live selector lists.
- **Findings:** DS-7.
- **Files:** `components/financials/player-financials.module.css:6-78`, `components/announcements/announcements.module.css:158-203`, `components/coach/announcements/announcements.module.css` (15 rules in `:386-591`, plus fragments at `:3`, `:393`, `:403`, `:415`, `:427`, `:449`, `:595`, `:611`, `:739`), `app/globals.css` (`:4106-4192`, `:4740-4788`, `:11452-11460`).
- **Effort:** S · **Risk:** Low — every key is proved unreferenced and every dynamic constructor in the repo is enumerated. Still worth one screenshot pass over `/player/financials`, `/player/announcements` and `/coach/announcements/new`.
- **Dependencies:** none.
- **Overlap:** `app/globals.css` with PR-1, PR-3, PR-7. Do PR-2 **first** among the `globals.css` PRs so the others rebase onto smaller line numbers rather than the reverse.

**Correction (verified during implementation):** the `app/globals.css` ranges on the Files line above are a summary and **`:4106-4192` is not safe to delete** — it spans the live rule at `:4171-4175`, whose `.coach-directory-notice` selector is used at `components/coach/members/member-directory.tsx:617`. Work from the enumerated per-rule list in DS-7 instead; the other two ranges, `:4740-4788` and `:11452-11460`, do check out. Three further amendments to this PR: it must also delete `components/development-meter.tsx` and the styles at `app/globals.css:3024-3058`, because DEBT-3's component deletion and this one are coupled and cannot land separately; deleting the remaining `.coach-registration-approved` rules will fail `tests/accessibility-hardening.test.ts:48`, which asserts on the text of `globals.css`, so that test must be updated in the same PR; and the scope is larger than 307 lines, with roughly 30 further dead rules listed in the DS-7 correction note. Risk is **Medium**, not Low. See `docs/audit/verification-log.md`.

### PR-3 — Add the on-dark colour tier and unify the coach status colours
- **Scope:** introduce `--on-dark-success`, `--on-dark-error`, `--on-dark-muted`; migrate the 8 divergent sites; unify the two ochres for the make-up / rescheduled state.
- **Findings:** VD-2, part of DS-15.
- **Files:** `app/globals.css:47-102` (token block), `:8164`, `:8168`, `:8172`, `:8485-8488`, `:8575`, `:8579`, `:8583`; `components/coach/financials/financials.module.css:607`, `:611`.
- **Effort:** M · **Risk:** Medium — changes two of three surfaces by design. Needs a designer to choose the three values.
- **Dependencies:** none, but should land after PR-2 to avoid line-number churn.
- **Overlap:** `app/globals.css` with PR-1, PR-2, PR-7.

### PR-4 — Collapse the top 8 uppercase micro-label variants into one class
- **Scope:** define one `.eyebrow` with `--red` / `--steel` and small/default size modifiers; migrate the 44 rules in the 8 largest variant groups. Leave the 95-variant tail for a follow-up.
- **Findings:** VD-1, contributes to DS-1 and DS-6.
- **Files:** `app/globals.css` (24 rules), `components/coach/financials/financials.module.css` (8), `components/coach/financials/financial-records.module.css` (5), `components/coach/announcements/announcements.module.css` (2), `components/announcements/announcements.module.css` (1), `components/financials/player-financials.module.css` (1), `components/coach/dashboard-card.module.css` (1), `components/coach/junior-coach-dashboard.module.css` (1); plus the TSX that must gain the class.
- **Effort:** M–L · **Risk:** Medium — every site shifts tracking or size slightly. Highest design payoff in this report.
- **Dependencies:** none. Conflicts with PR-2 in `components/coach/announcements/announcements.module.css:3` (a dead fragment inside a live rule) — land PR-2 first.
- **Overlap:** `app/globals.css` with PR-1/2/3/7; the two announcements modules with PR-2.

### PR-5 — Fix the small, provable typography defects
- **Scope:** normalise the 20 out-of-axis font weights to `800`; align `clamp(58px, 8vw, 102px)` to `7.5vw`; merge the two 12px type tokens; tokenise `themeColor`.
- **Findings:** DS-5, VD-6, DS-11, DS-12.
- **Files:** `app/globals.css` (9 weight sites + `:4960` + `:83`/`:85`), `components/coach/onboarding/player-onboarding-register.module.css` (9 weight sites), `components/financials/player-financials.module.css` (2 weight sites), `app/layout.tsx:82`, plus one new shared constant module.
- **Effort:** S · **Risk:** Low — the weight change is a no-op if clamping behaves as specified (verify per DS-5's proof command before merging); the `vw` change affects one surface at tablet widths.
- **Dependencies:** none.
- **Overlap:** `app/globals.css` with PR-1/2/3/4/7.

### PR-6 — Add CI guards so these classes of drift cannot recur
- **Scope:** three checks, no product code touched. (a) a colour-literal check that fails on any hex or `rgb()`/`rgba()` outside the `:root` block that is within ΔE 2 of a declared token; (b) an unreferenced-CSS-module-key check that understands the `styles[\`status_${…}\`]` construction; (c) an assertion that `viewport.themeColor` equals `--navy`.
- **Findings:** guards DS-3, DS-7, DS-12, DS-15.
- **Files:** `.github/workflows/*`, a new `scripts/` entry. No CSS or component changes.
- **Effort:** M · **Risk:** Very low — additive only.
- **Dependencies:** should land **after** PR-1 and PR-2, or check (a) and (b) fail on day one.
- **Overlap:** none with any other PR.

### PR-7 — Unify the attendance "unavailable" hatch and the ticket-paper tokens
- **Scope:** one tokenised `repeating-linear-gradient` shared by the legend, the coach register cell and the month calendar; promote `--ticket-paper` to `:root` and share the notch pseudo-elements.
- **Findings:** VD-3, VD-4.
- **Files:** `app/globals.css:2911`, `:3991-3997`, `:4003-4009`, `:10205`, `:10231-10242`, `:10775-10781`; `components/coach/dashboard-card.module.css:2`, `:61-72`.
- **Effort:** S–M · **Risk:** Low for the notch and the two identical paper tokens (zero visual change); Medium for the hatch, which changes the legend swatch and the coach cell.
- **Dependencies:** none.
- **Overlap:** `app/globals.css` with PR-1/2/3/4/5.

### PR-8 — Decouple the register widths from the TypeScript arithmetic
- **Scope:** single source for `250`/`58`/`240`/`54`/`148`, or replace the TS arithmetic with `calc()` over the existing custom properties. Verify whether `.staff-register-table`'s overrides at `:3780-3781` reach a reader.
- **Findings:** DS-9.
- **Files:** `app/globals.css:3769-3791`, `:6249-6253`; `components/coach/player-attendance-register.tsx:141-142`; `components/coach/staff-attendance-register.tsx:71-72`.
- **Effort:** S · **Risk:** Medium — this is the one change here that can visibly break a layout, so it needs the width assertion from DS-9's proof command at desktop and 380px before and after.
- **Dependencies:** none.
- **Overlap:** `app/globals.css` with PR-1/2/3/4/5/7 (an isolated line range).

### PR-9 — Remove the `!important` cluster from the Fee Register module
- **Scope:** rescope the descendant rules under `.filters` so `.checkboxField`, `.registrationFolio` and the responsive table overrides win on specificity; delete all 27 `!important`s.
- **Findings:** DS-10.
- **Files:** `components/coach/financials/financial-records.module.css` only.
- **Effort:** M · **Risk:** Medium — cascade surgery inside media queries. Needs screenshot comparison of `/coach/financials/records` at desktop, 900px and 380px.
- **Dependencies:** none.
- **Overlap:** none.

### PR-10 — Correct `.21st/DESIGN.md`
- **Scope:** fix the five drift items; add the two undocumented custom-property tiers; downgrade the "Resolved" dead-selector claim; re-check after PR-2 lands.
- **Findings:** DS-8, DS-13.
- **Files:** `.21st/DESIGN.md` only.
- **Effort:** S · **Risk:** None.
- **Dependencies:** land **last**, after PR-1 through PR-9, so the line counts and token inventory it records are the post-change ones.
- **Overlap:** none.

---

## Appendix — hardcoded-colour triage, reconciled against the 21st CLI

The 272 findings in `output/audit/21st-review.txt`, all of rule `design-hardcoded-color`, resolve as follows.

| Population | Count | Verdict |
|---|---|---|
| Inside the `:root` declaration block, `app/globals.css:48-70` | **22** | **False positive.** A literal colour value is correct by definition in a token declaration. The tool has no concept of a token-definition site. |
| Outside `:root` | **250** | Genuine, but not what the rule name suggests — see below. |

Counting literals rather than tool findings (276 literal sites; the tool collapses 4 that share a line with another literal — 3 at `app/globals.css:2911`, 1 at `app/public-home.css:396`), the 250 genuine findings break down as:

| Sub-population | Literals | Note |
|---|---|---|
| `rgba()` whose RGB triple is exactly a token's value | **157** | `--white` 62, `--ivory` 59, `--navy` 30, `--red` 4, `--green` 2, across 65 distinct alpha values. **DS-4.** |
| Values the token set does not contain at all | **96** | 49 distinct colours. 33 sites within ΔE 2 of a token; 59 within ΔE 5. **DS-3, VD-2, DS-15.** |
| `app/layout.tsx:82` `themeColor: "#071b32"` | **1** | Exactly `--navy`; a TS metadata object cannot read a CSS custom property. **DS-12.** |
| **Opaque CSS literals that exactly equal a token's hex** | **0** | The classic "you wrote `#c81d2a` instead of `var(--red)`" defect **does not occur anywhere in this codebase's CSS.** |

That last row is the most important thing the triage found, and it changes the recommended remedy entirely. The problem is not developers ignoring tokens they know about. It is two genuine gaps in what the token layer can express — **there is no way to say "this token at 12% alpha", and there is no on-dark tier at all** — plus one file (`public-home.css`) that drifted in a single role (the hairline) while otherwise reading 202 `var()`s across 28 tokens.
