# SMBA Student Portal — Product, Design & Engineering Audit

**Date:** 2026-08-23 · **Commit:** `3cbd766` · **Branch:** `main`
**Scope:** Full application — public marketing site, Player Journal, Head-Coach Workspace, Junior-Coach Dashboard, Platform Admin, authentication flows.
**Reviewed:** 94 files in `app/`, 102 in `components/`, 80 in `lib/`, 16,364 lines of CSS, 137 unit tests + 13 Playwright suites.

**Method.** Six parallel domain audits (design system, accessibility, UX states, responsiveness, implementation quality, performance), then independent verification of every headline claim against source. Two subagent findings were materially wrong and have been corrected in place — see [Corrected claims](#corrected-claims). Deterministic tooling: `21st review` (285 findings, all `design-hardcoded-color`), `tsc --noEmit`, `eslint .`.

---

## 1. Verdict

This is a **mature, unusually well-disciplined codebase** — materially above average for a product of this size. It has a genuine automated accessibility gate (49 states × 3 profiles × 3 viewports, WCAG 2.2 AA, CI-blocking), zero `any`/`@ts-ignore` in production code, zero ESLint findings across 477 files, server-side idempotency on every money and publish path, and an exceptional written design decision record (`.21st/design.json`, 132 recorded decisions) that most teams never produce.

The defects that remain are **not architectural failures**. They cluster in four places:

1. **Resilience of client action handlers** — a courtside coach on a flaky connection can get a permanently stuck button.
2. **A design token layer that stopped halfway** — 36 tokens exist, but radius/shadow/motion/z-index/breakpoints have none, one token reference is dead, and the product's own 10px type floor is violated by its own CSS.
3. **Two server-side N+1 query patterns** in finance that scale with charge and player count.
4. **Delivery and build hygiene** — all portal CSS parsed on the marketing page, `typecheck` that passes or fails depending on stale build artifacts, and a validation library installed but used once.

Nothing here is an emergency. The highest-severity item (ST-1) is a ~2-hour fix.

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

#### ST-2 · OBJ · S2 · Effort M · Confidence High
**No offline strategy on a courtside-mobile product.**

Zero `navigator.onLine`, zero `online`/`offline` listeners, no service worker, no manifest, no retry affordance. Traced path for a coach saving attendance with no connectivity: `saveAttendance()` → `saveAttendanceRegister` → server action fetch rejects → `catch` → `InlineNotice` shows `error.message`, which for a failed fetch is the browser string **"Failed to fetch"**.

The mechanics are correct (drafts preserved, `isSaving` reset). The *message* is not: it is untranslated browser jargon at the exact moment a coach is standing on a court with 20 players.

**Why it matters.** This is the product's most repeated real-world task in its least reliable environment.
**User impact.** All coaches, daily, on mobile.
**Note.** Full offline queueing is out of scope for a first pass; mapping network failure to operational copy plus an explicit Retry is the 80% fix.

#### ST-3 · OBJ · S3 · Effort XS · Confidence High
**No `app/global-error.tsx`.** Confirmed absent. Root-layout render failures (font loading, metadata) bypass all five nested `error.tsx` boundaries and fall through to Next.js's unbranded default. Every other boundary is well-branded via `RouteErrorState`, so this is a one-file gap in an otherwise complete set.

#### ST-4 · OBJ · S3 · Effort S · Confidence High
**15 routes perform async data loads with no loading boundary and no `Suspense`.** `Suspense` appears zero times in application code. Navigation to these blocks with no visual feedback. `(student)/*` and `coach/*` are correctly covered.

Verified breakdown (revised 2026-08-23 during PR-4 — every candidate page was read rather than inferred):

| Group | Routes | Treatment |
|---|---|---|
| Named trees | `/admin`, `/account/security`, `/account/recovery-email/setup`, `/auth/two-factor`, `/auth/two-factor/setup`, `/auth/two-factor/reconnect`, `/auth/two-factor/recovery`, `/auth/pin/setup`, `/setup/head-coach` | **Covered by PR-4** with 4 `loading.tsx` files via segment inheritance |
| Root-level auth | `/login`, `/register`, `/recover`, `/recover/reset`, `/activate` | **Deliberately excluded.** Redirect-if-signed-in is the *common* outcome here, so a boundary would flash loading UI on the product's primary entry point. For the anonymous visitor who actually renders them, the session check is a cheap cookie miss. |
| Public detail | `/(public)/announcements/[announcementId]` | Async (`getActiveHomepageAnnouncement`) and **missing from the original finding**. Needs `app/(public)/announcements/loading.tsx` specifically — a `(public)` boundary would wrap the static marketing homepage. One-file follow-up. |

**Corrections to this finding.** The original "18 routes" was inflated: `/progress` and `/reports` are one-line synchronous `redirect()` stubs with no `await`, and must never receive a loading boundary. The original list also omitted `/auth/two-factor` and `/auth/two-factor/recovery` (both async) and the public announcement detail page. PR-4's estimate of "7 new `loading.tsx`" became **4**, because a boundary is inherited by all nested segments.

**Known trade-off accepted by PR-4.** A `loading.tsx` makes its segment stream, so Next can flush the fallback before a page's `redirect()` resolves — turning a clean 307 into a visible flash then a client-side redirect. For the nine covered routes the redirect is always the exception path (wrong role, unauthenticated, step already complete), so this trades a flash on the rare path for removing a blank block on the common one.

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

### 3.2 Accessibility

#### A11Y-1 · OBJ · S3 · Effort XS · Confidence High
**Placeholder text fails WCAG AA contrast.** `#8a939b` at `app/globals.css:1545` and `:5410` gives **3.12:1** on `#ffffff` and **2.99:1** on `--paper` `#fbfaf7`, against a 4.5:1 requirement. Mitigated — not eliminated — by the fact that every field has a visible `<label>`, so no information is placeholder-only.

#### A11Y-2 · OBJ · S3 · Effort XS · Confidence High
**Disabled month-navigation controls are effectively invisible.** `app/globals.css:8905` sets `color: var(--line)` = `#d7dbde` on white → **1.39:1**, against the 3:1 non-text/UI minimum. A coach cannot tell a disabled month arrow from a rendering artifact.

#### A11Y-3 · OBJ · S3 · Effort S · Confidence High
**Five forms omit the error-association pattern the login form implements correctly.** Missing `aria-invalid`, `aria-describedby` → error node, and/or first-invalid focus: `pin-setup-form.tsx` (error is a standalone `role="alert"`, not linked), `head-coach-setup-form.tsx:52`, `recovery-form.tsx:36`, `recovery-reset-forms.tsx:35` (2FA step), `two-factor-verification-form.tsx` (no post-error focus). The reference implementation is `components/login-form.tsx:36-41` and it is CI-tested — these five simply were not brought up to it.

#### A11Y-4 · OBJ · S3 · Effort XS · Confidence High
**`/admin` has no skip link.** `components/app-shell.tsx:17`, `coach-shell.tsx:17`, `app/(public)/page.tsx:438` and the public announcement page all have one; `app/admin/page.tsx:90` renders `<main className="admin-page page-shell">` directly with none.

#### A11Y-5 · OBJ · S3 · Effort XS · Confidence High
**A horizontal scroll container is not keyboard operable.** `.tableWrap` sets `overflow-x: auto` over a `min-width: 980px` table but has no `tabIndex` and no `aria-label` — unlike the attendance register, which does both (`player-attendance-register.tsx:267-268`). A keyboard user cannot scroll the region to reach clipped columns.

**Evidence corrected (2026-08-23, by runtime measurement).** The original finding named `financial-records-workspace.tsx:314` (the registration/monthly fee register) and claimed it scrolls from 721px up. It does not: `.registrationTableWrap` is reset to `overflow: visible` with a stacked block table inside `@media (max-width: 980px)`, and at 1000px the table fits exactly (`clientWidth 950` = `scrollWidth 980`→`950`). The container that genuinely traps content is the **collections day book** at `financial-records-workspace.tsx:566`, which keeps `overflow-x: auto` over a 980px table down to 720px. Measured at 800px: `scrollWidth 980` vs `clientWidth 750`, no `tabindex`, no `aria-label`, **79 Tab stops never reach it**, and `End`/`ArrowRight` while hovered leaves `scrollLeft` at 0.

The defect and the fix are unchanged — PR-3 added `tabIndex`, `role="region"` and labels to both containers. Only the reproduction viewport and the primary affected surface were wrong.

**Extended during PR-3.** The attendance register's own container — the pattern this finding pointed at as correct — carried `aria-label` on a role-less `<div>`, where ARIA prohibits naming and the accessible name may be discarded by some browser/AT pairings. All three containers now carry `role="region"`, which is already this repo's dominant convention for named non-semantic containers (`attendance-adjustments-workspace.tsx:523`, `player-onboarding-register.tsx:833`, `report-accordion.tsx:119` and `:182`); `role="group"` is reserved here for radio-like button clusters.

**Residual, not yet fixed:** `player-attendance-register.tsx:188` — `<div className="coach-year-selector" aria-label="Choose attendance year">` is the same shape, a named role-less div, while its three siblings at `:204`, `:217` and `:243` all carry `role="group"`. It looks like a straightforward oversight in the same family. One-word follow-up.

#### A11Y-6 · OBJ · S3 · Effort S · Confidence High
**Seven routes and two dialog states sit outside the otherwise-excellent axe matrix**: `/coach/announcements/[id]`, `/coach/reports/publications/[publicationId]`, `/announcements/[announcementId]`, `/coach/financials` (inactive/activation), `app/not-found.tsx`, and both financials `error.tsx` pages; plus the announcement **Review** and **Withdraw** dialogs, which are never opened during the run. Given W-1, these are the only places a11y regressions can enter unnoticed.

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

**Second, related blind spot (same root cause).** `withTags([...WCAG_TAGS])` also excludes every rule axe tags `best-practice`, which is where all the landmark and structural rules live. Verified in axe-core 4.13.0: `region` (`axe.js:33358`), `landmark-unique` (`:33128`), `landmark-one-main` (`:33114`), `landmark-no-duplicate-main` (`:33101`) and `aria-allowed-role` (`:32200`) are all `best-practice`-tagged and therefore never evaluated. So landmark structure — a primary screen-reader navigation mechanism — is currently unchecked. The custom `collectDomAudit` partially compensates by asserting exactly one `<main>` and one `<h1>`, but nothing verifies landmark naming, uniqueness, or that content sits within a landmark at all.

Together with the discarded `incomplete` results, this means a green run is narrower evidence than it appears: it certifies "no WCAG-tagged violations axe could decide automatically", not "no accessibility problems". Both are cheap to surface as non-blocking sections.

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

**Status (2026-08-23): closed for sub-8px, substantially closed for 8px.** `--type-operational-floor: 10px` now exists and **zero declarations below 8px remain anywhere in the repo**. Of the 34 8px declarations, 11 were raised, and 18 remain: 13 in CSS modules not yet in scope (7 of them on the coach Financials registers, whose own design decisions mandate the 10px floor by name — the obvious next PR), 4 that are dead code, and 1 declined on measured layout grounds.

Three corrections to this finding, all found by measurement during implementation:

1. **8px is not unsanctioned everywhere.** I asserted it had no explicit sanction. It does: `.21st/design.json`'s `coach-staff-roll-call-daily-ledger` decision specifies "the same 9px desktop/tablet and **8px mobile** uppercase typography". The finding's premise was too strong.
2. **A type floor mechanism already existed and I missed it.** `app/globals.css:13799-13855` contains an "Internal operations typography floor" block that overrides several selectors to `var(--type-utility-label)` (11px). Four of the 8px declarations are therefore **dead code** — they render at 11px today, and editing them would be a no-op. The vestigial 8px lines are the remains of the roll-call sanction above, already superseded in the stylesheet.
3. **One site was declined on evidence, not preference.** `app/globals.css:8017` (`.coach-month-grid button small`, the "N sessions" caption in the coach Session Calendar month grid) offers 25.7px of content width at 320px, while the word "sessions" alone needs 43.3px at 10px — it already overflows at its current 8px. It also sits on the surface `mobile-calendar-attendance-freeze` explicitly freezes. Raising it would deepen a pre-existing overflow on frozen work.

One knock-on: the step-rail label at `player-onboarding-register.module.css` could not reach 10px either — the longest label `ASSESSMENT` needs 70.5px in a 64.5px track at 320px, and the grid uses `minmax(0, 1fr)` so the track cannot grow. It was raised 7px → **9px**, the largest size that fits and the size this design system already sanctions for small uppercase labels.

#### RESP-2 · SUBJ · S4 · Effort S · Confidence High
**Several coach controls sit at 42px against the design record's 44px contract**: `.coach-year-selector button` (`globals.css:3635`), `.coach-occurrence-actions > button` (`:7377`), `.coach-series-end-action` (`:7701`), `.coach-assignment-days label > span` (`:7813`). These **pass** WCAG 2.2 SC 2.5.8 (24px minimum), so this is a consistency issue against the team's own stricter bar, not an accessibility failure.

#### RESP-3 · SUBJ · S4 · Effort XS · Confidence Med
**The onboarding register uses off-grid breakpoints** (`max-width: 1000px` / `700px`) instead of the app's 980/760/720 system, leaving 701–720px on a cramped five-column desktop row.

#### Verified NOT defects — do not "fix" these
The 1px media-query pairs **760/761, 720/721, 900/901, 340/341** are clean mutually-exclusive gaps, not destructive overlaps; each produces exactly one correct layout at the boundary pixel. **980/981** has no `min-width: 981px` counterpart *by design* — above 980px the unprefixed desktop rules apply. The 900px + 980px member-directory overlap at 851–980px resolves correctly by source order. Distinct breakpoint widths total 19, which is high but coherent.

### 3.4 Design system

#### DS-1 · OBJ · S3 · Effort XS · Confidence High
**A CSS variable is referenced that is never defined anywhere.**

```12981:12981:app/globals.css
  color: var(--color-navy, #071b32);
```

`--color-navy` does not exist in any stylesheet — the only occurrence in the repository is this consumption site. The hardcoded fallback therefore always wins. It renders correctly today and will keep rendering correctly, which is exactly why it is dangerous: it is an invisible dead reference that a future theming or dark-mode pass would silently skip.

#### DS-2 · OBJ · S3 · Effort XS · Confidence High
**Nine raw `#071b32` literals where `--navy` exists**, all inside the platform-admin block: `app/globals.css:13289, 13291, 13300, 13313, 13349, 13360, 13400, 13538, 13549`. The admin surface was evidently built without the token layer in view.

#### DS-3 · OBJ · S3 · Effort M · Confidence High
**Five token categories are completely empty.** 36 `:root` tokens cover colour (20), typography (4) and spacing (12). There are **zero** tokens for radius, shadow, motion/duration, z-index and breakpoints — confirmed by empty `radius: {}` and `shadows: {}` in `.21st/design.json`. Consequence: 41 raw `box-shadow` declarations, 8 distinct raw `z-index` values (1, 2, 3, 40, 50, 90, 100, 1000), ~30 mixed `.16s`/`160ms` durations, and raw `999px`/`50%`/`4px` radii.

#### DS-4 · SUBJ · S3 · Effort M · Confidence High
**Near-duplicate colour clusters have formed around tokenized values.** The strongest cluster is greys/borders around `--line` `#d7dbde`: `#d8dbdd` (8×), `#d6dadd` (4×), `#d9dddf` (3×), `#dde0e2` (3×), plus `#d5dadd`, `#d2d6d9`, `#ced4d7`, `#d8d5cf`, `#d7d2cb`. Also ivory (`#f3f2ef` 6×, `#ebe9e5` 4×), steel (`#667387` 6×), coral (`#f47c83` 5×). Token proposals in §4.

#### DS-5 · SUBJ · S3 · Effort M · Confidence Med
**An implicit spacing sub-scale exists but is untokenized.** `18px` (176×), `12px` (175×), `10px` (154×), `14px` (129×), `20px` (128×), `22px` (87×) — a coherent operational rhythm below the 8/16/24/32/40/48/56 token scale, used consistently but expressed as raw values.

#### DS-6 · SUBJ · S4 · Effort S · Confidence High
**Tailwind v4 is installed, imported, and used for exactly one utility.** `@import "tailwindcss"` at `globals.css:1`; the only utility appearing in any `className` is `sr-only` (25×). No `@theme` block, no config file, zero matches for `flex`/`p-4`/`text-sm`/`bg-`/`rounded-`. This is a decision to make explicitly — adopt it properly or drop it and define `.sr-only` directly.

#### DS-7 · SUBJ · S4 · Effort XS · Confidence High
**Two parallel visually-hidden implementations**: Tailwind `sr-only` (25×) and custom `.coach-published-visually-hidden` (`globals.css:8909`, 10×).

#### DS-8 · OBJ · S4 · Effort XS · Confidence High
**The generated design context is stale.** `.21st/DESIGN.md` documents 15 tokens and reports "Components: None detected"; the real `:root` set is 36. Anyone trusting the doc under-counts the system by more than half.

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

#### PERF-2 · OBJ · S3 · Effort M · Confidence High
**Every route parses the entire portal stylesheet.** `app/globals.css` (14,005 lines, 1,806 distinct selectors) is imported by the root layout and therefore ships to `/` and `/login`:

```4:4:app/layout.tsx
import "./globals.css"
```

Measured from the existing build: the globals chunk is **277,041 bytes raw → 42,521 gzip → 33,647 brotli**. An anonymous homepage visitor also gets the public chunk (31,847 raw / 6,304 brotli) for a CSS total of ~40 KB brotli, of which roughly 85% is coach/player/admin rules they can never see. `/login` downloads the globals chunk alone, using a small fraction of it.

**Honest framing:** ~28 KB of wasted brotli is a *modest* transfer cost, not a crisis. The real cost is **CSSOM construction and style recalculation over 277 KB of raw CSS and 1,806 selectors on every page**, which is felt on the low-end Android hardware this product's coaches actually use. Treat this as a parse/recalc optimisation, not a bandwidth one.

#### PERF-3 · OBJ · S3 · Effort XS · Confidence High
**Four presentational dashboard cards are needlessly client components.** `attendance-card.tsx`, `members-card.tsx`, `sessions-card.tsx` and `player-onboarding-card.tsx` each declare `"use client"` while containing **zero** hooks, handlers or browser APIs — and they are rendered from `app/coach/page.tsx`, which is a server component. Their sibling `financials-card.tsx` is correctly left server-side, proving the intended pattern.

The shared `components/coach/dashboard-card.tsx` primitive has **no** directive of its own and imports only `next/link`, one `lucide-react` icon and a CSS module — so today each card's `"use client"` is the only thing pulling the primitive and its import graph into the client bundle.

**Correction (2026-08-23):** this finding originally listed five cards. `reports-card.tsx:25` calls `useReportResume()`, and `components/coach/reports/report-resume.ts` is a `"use client"` module using `useState`/`useEffect` to read `localStorage` — so it legitimately requires the client boundary and is excluded. See [Corrected claims](#corrected-claims).

#### PERF-4 · OBJ · S3 · Effort S · Confidence High
**PDFs are fully buffered in memory.** `Buffer.concat(chunks)` at `lib/finance/pdf.ts:125` and `lib/reports/pdf.ts:371`, returned as a complete `Response` body. A player statement covering a long fee history buffers entirely before the first byte reaches the client — slow perceived export and a memory-spike risk against Vercel function limits. The CSV path already does this correctly with `ReadableStream` (W-11), so the streaming pattern is established in-repo.

#### PERF-5 · SUBJ · S3 · Effort M · Confidence High
**No code splitting anywhere.** Zero `next/dynamic` occurrences. The largest client surfaces load eagerly with their route bundles: `player-ledger.tsx` (1,593 lines), `member-directory.tsx` (1,072), `report-workspace.tsx` (805), `financials-rapid-desk.tsx` (679). `qrcode.react` is statically imported for a single 2FA route.

#### PERF-6 · SUBJ · S4 · Effort S · Confidence High
**`motion` ships for four hero/accordion components** where an equivalent CSS-native mechanism already exists in-repo (`components/reveal.module.css`, used on the public path). The design record itself asks for motion to be "CSS-native where it can preserve the same experience with less client payload" — done for the public homepage, not for the authenticated heroes.

#### PERF-7 · SUBJ · S4 · Effort S · Confidence Med
**`/login` is forced dynamic** by a `sessionProvider.getCurrentIdentity()` call in the page (`app/login/page.tsx:26` → `headers()`), preventing a static login shell. A middleware cookie check would restore static rendering for the overwhelmingly common anonymous case.

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

#### DEBT-7 · SUBJ · S4 · Effort S · Confidence High
**The two-digit "folio" register pattern is reimplemented at 8 sites** — `folio()` helper, inline `padStart(2,"0")` (×2), and five separate CSS class families across `globals.css` and three modules.

#### DEBT-8 · SUBJ · S4 · Effort XS · Confidence High
**Two CSS strategies with no documented rule.** ~60% of interactive UI uses global BEM-ish classes in `globals.css`; ~40% uses 10 CSS modules. Newer features (financials, announcements, onboarding) trend toward modules, suggesting an undocumented in-progress migration.

#### DEBT-9 · OBJ · S4 · Effort XS · Confidence High
**Stale repository artifacts.** `SMBA_UI_CARD_BY_CARD_PROMPT_PLAYBOOK.txt` (140 KB) references a dead path `/Users/nitishg/Documents/SMBA/student-portal`; `design-system/smba-player-journal/MASTER.md` is a generated doc with a generic palette wired to nothing. Neither is imported by runtime code.

#### DEBT-10 · SUBJ · S4 · Effort S · Confidence High
**CI has no bundle, dependency or coverage gate.** `quality.yml` gates lint, typecheck, `drizzle-kit check`, unit tests, build and five Playwright suites — genuinely strong. Absent: bundle/CSS size budget, `npm audit`, coverage thresholds.

### Corrected claims

Two findings from the parallel audits did not survive verification and are recorded here so they are not acted on:

| Claim | Reality |
|---|---|
| "~265 KB / 86% of CSS bytes wasted on the homepage" | Raw-byte framing. Actual transfer is **42.5 KB gzip / 33.6 KB brotli** for the globals chunk; wasted brotli ≈ 28 KB. The percentage stands, the magnitude does not. Reframed as a parse/recalc issue in PERF-2. |
| "532 duplicate selector groups in `globals.css`" | Not reproducible. Measured: **235 of 1,806 distinct selectors (13%) appear 2+ times, maximum 5 repetitions** — the normal base-rule-plus-responsive-override pattern. Not a defect; removed. |
| §4.4: "`--line-disabled: #9aa3ab` — 3.1:1" | **Wrong — it is 2.56:1 and fails.** Found during PR-2 implementation. The proposed remedy for a contrast defect was itself a contrast defect. Corrected to `#858d94` (3.37:1). Lesson: compute every proposed token value rather than eyeballing it, and composite translucent backgrounds first. |
| PERF-3: "five dashboard cards have zero hooks" | **Four, not five.** Found during PR-5 implementation. The verification grep matched React's built-in hooks (`useState`, `useEffect`, `useMemo`, …) but not *custom* hooks, so `reports-card.tsx`'s call to `useReportResume()` was invisible to it. That card reads `localStorage` and must stay a client component. Any future "could this be a server component?" check must match `use[A-Z]\w*\(`, not an enumerated list of React hooks. |

---

## 4. Design system audit & token proposals

**Current state.** 36 `:root` tokens: 20 colour, 4 typography, 12 spacing/layout. Coverage is good for colour, thin for type, absent for five categories. `var()` adoption inside CSS modules is genuinely strong (360 references in `financials.module.css` alone) — the modules consume tokens well; the problem is that the token set does not extend far enough for them to consume.

### 4.1 Close the empty categories

Highest value, lowest risk: these are all *new* tokens that replace raw values with identical computed output, so they are visually inert.

```css
/* Radius — replaces 7× 999px, 23× 50%, raw 4px */
--radius-sm: 4px;
--radius-pill: 999px;
--radius-circle: 50%;

/* Elevation — consolidates 41 raw box-shadow declarations */
--shadow-raised: 0 1px 2px rgba(7, 27, 50, 0.06);
--shadow-overlay: 0 12px 32px rgba(7, 27, 50, 0.12);
--shadow-modal: 0 32px 90px rgba(0, 0, 0, 0.18);   /* from globals.css:1428 */

/* Motion — normalises ~30 mixed .16s / 160ms values */
--duration-fast: 160ms;
--duration-base: 240ms;
--ease-standard: cubic-bezier(0.2, 0, 0.2, 1);

/* Z-index — replaces 8 ad-hoc values (1,2,3,40,50,90,100,1000) */
--z-base: 1;
--z-sticky: 40;
--z-header: 50;
--z-overlay: 90;
--z-dialog: 1000;

/* Breakpoints — documents the real 19-width system; reference values for review discipline */
--bp-xs: 340px;
--bp-sm: 430px;
--bp-md: 720px;
--bp-lg: 760px;
--bp-xl: 980px;
```

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

### Now — this week
Cheap, high-confidence, user-visible. No structural risk.

| Finding | Why now |
|---|---|
| ST-1 | Stuck onboarding button; ~2h fix; pattern already exists in-repo |
| RESP-1 | 5px text is unreadable and violates the team's own contract |
| A11Y-1, A11Y-2 | Two-line contrast corrections |
| A11Y-4, A11Y-5 | Two-line a11y parity fixes |
| ST-3 | One missing file |
| DS-1, DS-2, DS-8 | Dead token reference, 9 literals, stale doc |
| DEBT-1 | A quality gate that depends on stale artifacts is not a gate |
| PERF-3 | Five one-line deletions, smaller client bundle |

### Next — this month
Real design or engineering work, contained blast radius.

| Finding | Why next |
|---|---|
| ST-2 | Needs copy decisions and a retry affordance; highest real-world value after ST-1 |
| PERF-1 | Two N+1 rewrites; safe because finance test coverage is excellent |
| A11Y-3, DEBT-6 | Fix the five forms *by* extracting the field primitive — one change, two findings |
| A11Y-6 | Extend the matrix to 7 routes + 2 dialogs; protects everything else |
| DS-3, §4.1 | Fill the five empty token categories; visually inert |
| PERF-4 | Stream PDFs using the established CSV pattern |
| ST-4 | Loading boundaries for 18 routes |
| DEBT-5, DEBT-7 | Extract court SVG and folio primitives |

### Later — next quarter
Structural, needs planning and a design milestone.

| Finding | Why later |
|---|---|
| PERF-2 | CSS route-group split touches every stylesheet; must follow the token work |
| DEBT-2 | Zod schemas across ~76 actions; large and mechanical |
| DEBT-4 | God-file decomposition; do after DEBT-3 settles the result-type convention |
| DEBT-3 | Unify action result shapes |
| PERF-5, PERF-6 | Code splitting and motion removal |
| DS-4, DS-5, DS-6, DS-7 | Colour/spacing consolidation and the Tailwind adopt-or-drop decision |
| RESP-2, RESP-3, ST-5, ST-6, A11Y-7, DEBT-8, DEBT-9, DEBT-10 | Polish and hygiene |

---

## 6. Pull request decomposition

Ten PRs. Scoped for **parallel review** — the only serialised chain is the `globals.css` sequence (PR-2 → PR-6 → PR-9), because those three genuinely edit the same 14k-line file and would otherwise conflict continuously.

| PR | Title | Findings | Primary files | Effort | Risk | Depends on | Conflicts with |
|---|---|---|---|---|---|---|---|
| **PR-1** | Make async action handlers failure-safe | ST-1 | `components/coach/onboarding/player-onboarding-register.tsx` (5 handlers), `components/admin/admin-authenticator-recovery-queue.tsx` | S | **Low** — adds `try`/`catch`/`finally` around existing calls; mirrors `player-attendance-recorder.tsx:208` | — | none |
| **PR-2** | Contrast + operational type floor | A11Y-1, A11Y-2, RESP-1 | `app/globals.css` (~10 rules), `components/coach/dashboard-card.module.css:438` | S | **Medium** — visible change on frozen mobile calendar surfaces; needs design sign-off and screenshot diff | — | PR-6, PR-9 |
| **PR-3** | Keyboard + landmark parity | A11Y-4, A11Y-5 | `app/admin/page.tsx`, `components/coach/financials/financial-records-workspace.tsx` | XS | **Low** — additive `tabIndex`/`aria-label`/skip link | — | none |
| **PR-4** | Route error and loading boundaries | ST-3, ST-4 | new `app/global-error.tsx`, 7 new `loading.tsx` under `app/{admin,account,auth,setup}` | S | **Low** — new files only, reuses `RouteLoadingState`/`RouteErrorState` | — | none |
| **PR-5** | Server-render dashboard cards | PERF-3 | `attendance-card.tsx`, `members-card.tsx`, `sessions-card.tsx`, `player-onboarding-card.tsx` (`reports-card.tsx` excluded — needs the boundary) | XS | **Low** — remove `"use client"`; verified no hooks, no custom hooks, and a server parent | — | none |
| **PR-6** | Token layer: empty categories + dead reference | DS-1, DS-2, DS-3, DS-8, §4.1 | `app/globals.css` (`:root` + admin block), `.21st/DESIGN.md`, `tests/design-tokens.test.ts` | M | **Low-Medium** — value-preserving by construction; new lint assertions may surface further sites | PR-2 | PR-2, PR-9 |
| **PR-7** | Batch finance read models | PERF-1 | `lib/finance/repository.ts` (`chargeView`, receipt pairs), `lib/finance/service.ts` (`monthlyPreparationCandidates`) | M | **Medium** — money-path logic, but ~2,630 lines of existing finance tests must stay green | — | none |
| **PR-8** | Network-failure copy and retry | ST-2 | `components/coach/attendance/player-attendance-recorder.tsx`, `staff-roll-call.tsx`, shared network-error helper, `components/inline-notice.tsx` | M | **Medium** — needs copy decisions; scope to messaging + retry, not offline queueing | PR-1 | PR-1 (same files if merged late) |
| **PR-9** | Split CSS by route group | PERF-2 | `app/layout.tsx`, new `(coach)`/`(student)`/auth layout imports, `app/globals.css` decomposition | L | **High** — touches every surface; requires full responsive + a11y capture run before merge | PR-2, PR-6 | PR-2, PR-6 |
| **PR-10** | Restore deterministic typecheck | DEBT-1, DEBT-9 | `tsconfig.json`, `.gitignore`, delete stale playbook/MASTER.md | XS | **Low** — verify `next build` still type-checks routes after narrowing `include` | — | none |

### Suggested review order

**Wave 1 — merge in parallel, any order.** PR-1, PR-3, PR-4, PR-5, PR-10.
Five independent PRs, no shared files, all Low risk, mostly XS/S. Clears the cheap wins and the broken quality gate first so subsequent waves land on a trustworthy `typecheck`.

**Wave 2 — parallel, two tracks.** PR-2 and PR-7.
PR-2 opens the `globals.css` chain and needs a design decision, so start it early. PR-7 is fully independent and reviewed by whoever owns finance.

**Wave 3.** PR-6 (after PR-2 merges), PR-8 (after PR-1 merges).

**Wave 4.** PR-9 alone, on a quiet branch, with a full `regression:capture:responsive` + `regression:accessibility` run attached to the PR.

**Deferred to a planned milestone** (not in this set): DEBT-2 zod adoption, DEBT-3 result-type unification, DEBT-4 god-file splits, DS-4/5/6/7 colour and Tailwind decisions, PERF-5/6, and the remaining S4 polish items.

### Cross-cutting review guidance

- Every PR must keep `npm run lint`, `npm run typecheck`, `npm run test:ci` and `regression:accessibility` green. PR-2 and PR-9 additionally require `regression:capture:responsive`.
- PR-2 and PR-9 touch surfaces explicitly frozen in `.21st/design.json` (mobile auth, account menu, mobile calendar/attendance, mobile member directory). Both need a recorded design decision, not just a code review.
- PR-6's new token-enforcement assertions will likely fail on sites this audit did not enumerate. That is the point — treat new failures as scope, not as a broken test.
