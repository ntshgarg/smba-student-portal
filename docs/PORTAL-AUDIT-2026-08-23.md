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

**Partially resolved (2026-08-23).** Network failures in both attendance savers now produce operational copy naming the cause, stating the marks are still on screen, and saying what to do — and the existing Save control relabels to "Save attendance again" as the retry, since no secondary-button class exists in the stylesheet. Classification keys on the error's **constructor** (`TypeError`, plus a `name` check for realm-crossed errors) rather than its message, because the message differs per engine: "Failed to fetch" in Chrome, "NetworkError when attempting to fetch resource." in Firefox, "Load failed" in Safari. `navigator.onLine` only selects between two messages; it never decides whether a failure was network-related, since `onLine === true` means an interface exists, not that the server is reachable.

**Gap 1 — resolved (`75d3c88`).** The indefinite hang is bounded by a 20s/15s deadline. Two findings came out of implementing it:

- **Abort cannot propagate through a Next.js server action.** `callServer(actionId, actionArgs)` accepts exactly two parameters with no options object, and `server-action-reducer.js:72-78` builds its own `fetch` with no `signal` — zero matches for `signal`/`AbortController`/`AbortSignal` in that file. The plumbing beneath it *would* forward an `init`, but the only caller is Next-internal and never populates it. So the deadline is a UI-level escape, not a cancellation: the request keeps running, and the copy says the outcome is unknown rather than failed.
- **Retry after a timeout is provably safe**, which is why the copy can say so. Both attendance services skip a change when the stored choice already equals the target (`lib/sessions/service.ts:652`, before the conflict check is even reached), write via `onConflictDoUpdate` keyed on `(accountId, occurrenceId)` rather than appending, and run in `{ behavior: "immediate" }` transactions that serialise a retry against the in-flight original. So a landed-but-timed-out write makes the retry a no-op reporting success. This also means a *premature* deadline destroys nothing, which is what makes a generous duration low-risk.

**Latent trap discovered in Next.js config (not our code).** `server-action-reducer.js:81-98` contains an offline auto-replay path — on a fetch rejection it waits for connectivity and replays the action — gated on `process.env.__NEXT_USE_OFFLINE`. It is currently disabled (`next.config.ts` has no `experimental` block), which is the only reason the `TypeError` reaches our `catch` at all. **If anyone enables that flag, Next will swallow the rejection and hang, and the offline messaging shipped in `f543d10` will silently stop appearing.** Worth a comment near the classification helper.

**Gap 2 is now the highest-value remaining item, and the deadline slightly enlarged it.** A coach can now sit on a "may or may not have been recorded" state while holding unsaved drafts with no durable copy — so the ambiguity and the volatility compound. Combined with ST-8 (where unsaved-work protection can be silently absent), this is the product's worst realistic failure path.

2. **Drafts are React state only, so a tab close loses everything.** `unsaved-work-guard.tsx:189` fires the browser's generic "leave site?" dialog, but if the coach confirms it, the OS kills the tab, or mobile Safari discards the page under memory pressure (routine on iOS), every mark is gone silently. Note the new copy promises the marks are safe *on screen*, which is true and deliberately scoped — but a coach may read more into it. Persisting drafts to `localStorage` keyed by occurrence would close this without the correctness hazards of a write queue, because the replay still passes through the same optimistic-concurrency check on the next save.
3. **Nothing auto-recovers.** There is no `online` listener, so the coach must notice connectivity returning and press the button themselves. A captive portal also reports `onLine === true`, producing the vaguer "the request did not complete" message rather than naming the real problem.

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

**Resolved (2026-08-23).** Fixed in the guard rather than at the call sites, so all four are corrected without being touched. The deciding evidence came from the same file: `RequestStep` already calls the identical `onSuccess` — `router.replace` and `router.refresh` included — with no guard involvement at all, which proves no caller can depend on boundary-release ordering. One subtlety worth preserving: the callback is scheduled through a microtask rather than invoked synchronously, because a synchronous call would execute *inside* the `try`/`catch` added by the ST-1 fix, and a throw from `onSuccess` would then be reported as "could not be saved" against a save that succeeded — trading one misleading-success bug for another. A regression test drives the real provider with two dirty surfaces; 2 of its 3 cases fail before the fix.

#### ST-8 · OBJ · S3 · Effort M · Confidence Med
**Two further latent traps in the unsaved-work guard.** *Found while fixing ST-7, 2026-08-23. Not fixed — reported.*

1. **Back-button protection can be permanently absent for a surface.** `ensureHistoryBoundary` returns early while `allowNavigation.current` is true (the 1-second window after a confirmed navigation), and `setSurface` only calls it when the dirty map *was* empty. A surface first dirtied inside that window therefore never gets a history boundary, and nothing establishes one later — so unsaved-work protection is silently missing for the rest of that surface's life.
2. **`committedRef` never re-arms on a still-mounted form.** `navigateAfterCommit` sets it true, and the clearing effect only fires when `isDirty` transitions to false. A long-lived form edited again after a commit, without passing through a clean state, stays suppressed and unguarded. The onboarding steps are masked from this only incidentally, because `OnboardingEditor` remounts on its `key`.

Also minor: `ignoreNextPopState` is a boolean rather than a counter, so it assumes at most one in-flight `history.back()`. Safe today because the release path clears the pending timer, but any new code path calling `history.back()` would consume the wrong `popstate`.

**Why it matters.** Both failures are silent and state-dependent — the guard appears to work in every manual test, and only stops protecting under a specific interaction order. That is the hardest class of bug to catch by hand and the easiest to regress.

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

**Addressed (2026-08-23).** Seven states and three interactions added, verified live across all three profiles — 316 audits (stress 177, admin 87, clean 52). Both dialog states are covered, and the `data-accessibility-dialog-opener` hook — previously set inline by the single dialog interaction that had it — is now a shared `openDialogFrom(trigger)` helper, so every future dialog state inherits the focus-trap, Escape and focus-return checks automatically.

The six `error.tsx` boundaries remain unreachable: an `error.tsx` renders only when its segment throws during render, and the harness has no fault injection. A concrete route exists — `readFinanceActivation` throws when the `finance_activated` audit metadata lacks `trackingMonth`, so corrupting that one row would render the boundary — and the spec already mutates fixture databases directly for recovery-challenge setup, so the precedent is there. It is a new harness capability and belongs in its own change.

**The new coverage immediately found two real defects, which is the entire point:**
- `app/not-found.tsx` renders a bare `<section>` with **no `main` landmark** — `main-landmark-count`, serious, all three viewports. Every other route group supplies its own; the 404 was the only page with none.
- The finance-activation consent checkbox `input[name="confirmPermanentLedger"]` is an **18px tap target** at tablet width against a 24px minimum. It passes at 390px only because the consent sentence wraps and props the grid row open — accidental compliance rather than a sized control.

#### A11Y-9 · OBJ · S3 · Effort S · Confidence High
**The accessibility matrix silently drops states it cannot route.** *Found while extending coverage, 2026-08-23. Not fixed.*

`accessibility-regression.spec.ts` wires up specific profile-and-actor pairs. A matrix state whose pair is not wired up is **not an error** — it never executes, never appears in results, and reports nothing. Two of the seven states added in this pass fell into exactly that gap: the `stress` branch never opened a guest context, and the `clean` branch only scanned guest states, never head-coach ones. Both would have been dead entries that looked live.

**Why it matters.** This is A11Y-8's failure class one level up: the gate's *coverage* is as invisible as its discarded results. Someone adding a state with a mistyped profile gets a green run and believes the surface is protected. Taken together, a green result today means "no WCAG-tagged violations, among the states that happened to be routable, excluding everything axe could not decide automatically."

**Fix shape.** Assert every selected state produced at least one result. That is a new blocking check, so it warrants a deliberate decision rather than a quiet addition.

#### A11Y-10 · OBJ · S4 · Effort S · Confidence High
**`aria-label` on role-less containers is a recurring pattern, not isolated incidents.** Five instances across three separate passes: both fee-register scroll wrappers, the attendance register scroll container, the attendance year selector, and the announcement Review dialog's `channelPills`. Every one was found by accident, and all are invisible to the gate because `aria-prohibited-attr` returns *incomplete* rather than a violation when the element has subtree text (A11Y-8).

Fixing them one at a time is not converging. An assertion — no `aria-label`/`aria-labelledby` on an element lacking an explicit `role`, outside an allowlist of elements whose implicit role permits naming — would catch the whole family for the cost of one file. Same shape as the `var()`-undeclared assertion added in `5204109`, which has already proved its worth.

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

**Status (2026-08-23): closed for sub-8px; 8px reduced to three documented exceptions.** `--type-operational-floor: 10px` now exists, **zero declarations below 8px remain anywhere in the repo**, and the 9px tier is untouched at exactly 99 declarations. Of the original 34 8px declarations, 23 were raised across two passes. **Three remain, each with a stated reason rather than an assumption:**

| Site | Why it stays at 8px |
|---|---|
| `financials.module.css:2764` | Declined on measurement. The allocation-row caption is `nowrap` + `ellipsis`; at 8px `SMBA-ABCD2345 · Available ₹12,500` needs 133.6px in a 135px track and fits. At 10px it needs 167px and the ellipsis lands mid-word around "Availa…", removing the amount. The design record's prohibition on hiding ledger facts outranks the type floor here, and the adjacent 104px amount-input track is fixed, so widening is unavailable. |
| `globals.css:8016` | `.coach-month-grid button small` — "sessions" needs 43.3px in a 25.7px cell at 320px, so it already overflows at 8px. On a surface `mobile-calendar-attendance-freeze` covers. |
| `globals.css:12898` | Design-sanctioned roll-call mobile 8px, and demonstrably still live — see RESP-4, which also shows it is currently applied to only one of the control's two halves. |

Two side findings from the final pass. `financials.module.css:3721` (`.summary dt`) is **unreachable**: the only `styles.summary` consumer is `dashboard-card.tsx`, which imports a different CSS module, and CSS Modules hash class names — so the rule cannot match. It was raised for sheet consistency but is a zero-render change and is a candidate for deletion. And `.balancePlayerRail > button` ("Change player") now wraps to two lines at 320px; nothing clips, and no defensible padding trim buys a single line — even at 5px padding the box is still 0.9px short.

Measurement note: both passes computed real Manrope glyph advances from the font files Next.js cached in `.next/static/media`, applying HVAR weight deltas manually — `fontkit`'s `getVariation()` loses its cmap in this build and silently returns ExtraLight metrics, roughly 9% narrow. The second pass calibrated against the first by reproducing its published 43.3px figure for "sessions" exactly.

Three corrections to this finding, all found by measurement during implementation:

1. **8px is not unsanctioned everywhere.** I asserted it had no explicit sanction. It does: `.21st/design.json`'s `coach-staff-roll-call-daily-ledger` decision specifies "the same 9px desktop/tablet and **8px mobile** uppercase typography". The finding's premise was too strong.
2. **A type floor mechanism already existed and I missed it.** `app/globals.css:13799-13855` contains an "Internal operations typography floor" block that overrides several selectors to `var(--type-utility-label)` (11px). Four of the 8px declarations are therefore **dead code** — they render at 11px today, and editing them would be a no-op. The vestigial 8px lines are the remains of the roll-call sanction above, already superseded in the stylesheet.
3. **One site was declined on evidence, not preference.** `app/globals.css:8017` (`.coach-month-grid button small`, the "N sessions" caption in the coach Session Calendar month grid) offers 25.7px of content width at 320px, while the word "sessions" alone needs 43.3px at 10px — it already overflows at its current 8px. It also sits on the surface `mobile-calendar-attendance-freeze` explicitly freezes. Raising it would deepen a pre-existing overflow on frozen work.

One knock-on: the step-rail label at `player-onboarding-register.module.css` could not reach 10px either — the longest label `ASSESSMENT` needs 70.5px in a 64.5px track at 320px, and the grid uses `minmax(0, 1fr)` so the track cannot grow. It was raised 7px → **9px**, the largest size that fits and the size this design system already sanctions for small uppercase labels.

#### RESP-4 · OBJ · S3 · Effort XS · Confidence High
**The two halves of the staff roll-call Present/Absent control render at different font sizes.** *Found while completing RESP-1, 2026-08-23. Not fixed — needs the design decision below.*

`app/globals.css:12898` styles the roll-call choice controls at 8px via a two-selector rule. The "Internal operations typography floor" block later in the file (`:13799-13855`) repeats those selectors at 11px and would normally win by source order — and for the first selector it does. But the second selector ends `> .staff-roll-call-choice-box button + button`, whose extra type selector gives it specificity **(0,4,3)** against the floor block's **(0,4,2)**. So it wins.

The consequence: inside a single joined control, **the first button renders at 11px and the second at 8px** on screens up to 760px.

This contradicts the product's own spec. `.21st/design.json`'s `coach-staff-roll-call-daily-ledger` requires "one joined Present and Absent pressed-state control inside a shared neutral outline… using the same 9px desktop/tablet and 8px mobile uppercase typography." Neither button is at 9px or 8px-consistently, and the two do not match each other.

**Why it matters.** A joined two-option control with mismatched type reads as a rendering bug to a coach, and it is the kind of defect that survives indefinitely because each half looks plausible in isolation. It also resolves the ambiguity flagged under RESP-1: the 11px floor override was almost certainly accidental drift rather than a deliberate supersession of the 8px sanction, since a deliberate change would have moved both halves.

**Blocked on:** whether the recorded 8px mobile roll-call sanction still stands. Both halves should end up the same size; which size is the design call.

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

#### DS-3 · OBJ · S3 · Effort M · Confidence High
**Five token categories are completely empty.** 36 `:root` tokens cover colour (20), typography (4) and spacing (12). There are **zero** tokens for radius, shadow, motion/duration, z-index and breakpoints — confirmed by empty `radius: {}` and `shadows: {}` in `.21st/design.json`. Consequence: 41 raw `box-shadow` declarations, 8 distinct raw `z-index` values (1, 2, 3, 40, 50, 90, 100, 1000), ~30 mixed `.16s`/`160ms` durations, and raw `999px`/`50%`/`4px` radii.

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

**Revised recommendation:** decline PERF-2 as written (L effort, three-way split, parse-cost rationale). Do the font fix in PERF-8 first, then a **binary** globals split at M effort. **Decline splitting portal CSS entirely** — `/coach` and `/player` are warm-cache surfaces behind a login whose real cost is 660–671 KB of JS and 460–534 ms of scripting at 6×, not their stylesheet.

Two measurement gaps stated for the record: `openssl` is policy-blocked so no local HTTP/2 origin could be stood up, which is why the win is decomposed rather than assumed; and `UpdateLayerTree` no longer exists as a trace event in Chromium 151, that work having folded into `PrePaint`.

#### PERF-8 · OBJ · S2 · Effort S · Confidence High
**Font preloading is the largest render-blocking cost on the public routes, and it outweighs the CSS problem.** *Found while measuring PERF-2, 2026-08-23.*

`app/layout.tsx` loads Manrope and Newsreader, the latter in both normal and italic, and the root layout preloads them across four files — **147–187 KB per route**. That is as much wire weight as all the JavaScript, and unlike CSS it is already compressed, so brotli cannot help.

Removing just the three font preloads on `/` moves FCP from **1,472 ms to 1,148 ms** with zero CSS work — the best win per unit of risk anywhere in this audit, confined to a single file.

**This is not simply "delete the preloads", and the trade-off needs deciding rather than assuming.** Both fonts already use `display: swap`, so text paints in the fallback and swaps when the font arrives; dropping a preload makes that swap land later and the flash of fallback text more visible. The real work is deciding *which* faces genuinely need preloading on *which* routes — Newsreader italic almost certainly does not need it anywhere, and the authenticated portal has different needs from the editorial public homepage. The audit's original estimate of "~85–130 KB, SUSPECTED" was low and marked unverified; it is now measured.

#### PERF-3 · OBJ · S3 · Effort XS · Confidence High
**Four presentational dashboard cards are needlessly client components.** `attendance-card.tsx`, `members-card.tsx`, `sessions-card.tsx` and `player-onboarding-card.tsx` each declare `"use client"` while containing **zero** hooks, handlers or browser APIs — and they are rendered from `app/coach/page.tsx`, which is a server component. Their sibling `financials-card.tsx` is correctly left server-side, proving the intended pattern.

The shared `components/coach/dashboard-card.tsx` primitive has **no** directive of its own and imports only `next/link`, one `lucide-react` icon and a CSS module — so today each card's `"use client"` is the only thing pulling the primitive and its import graph into the client bundle.

**Correction (2026-08-23):** this finding originally listed five cards. `reports-card.tsx:25` calls `useReportResume()`, and `components/coach/reports/report-resume.ts` is a `"use client"` module using `useState`/`useEffect` to read `localStorage` — so it legitimately requires the client boundary and is excluded. See [Corrected claims](#corrected-claims).

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

**Resolved (2026-08-23), with measurements.** Typecheck errors 2 → **0**. Files `tsc` read from `output/`: 919 → **0**. Vitest collected files 607 → **143**. The Vitest baseline was observed growing from 451 to 607 *during* the session as another agent extracted a tree under `output/` — the defect demonstrating itself in real time.

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
| "Dead CSS: `.status-draft`, `.status-published`, `.status-revision` not found in any `.tsx`" | **False positive — all three are live.** They are constructed dynamically as `` `status-${getCoachReportState(report)}` `` at `report-workspace.tsx:386` and `:778`, with the state strings asserted by `tests/coach-report-utils.test.ts`. Nine `is-*` state classes were flagged the same way and are live for the same reason. **A literal-name grep is not proof of death in this codebase** — it builds class strings via template literals, `styles[key]` bracket access, and `data-*` attribute selectors. Any future dead-code claim must rule out all three. |
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
