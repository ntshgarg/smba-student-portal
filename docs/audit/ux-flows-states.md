# UX Flows, Interaction States and Information Architecture — Independent Audit

**Scope:** UX flows, interaction states, IA. Repo `/Users/nitishg/smba-student-portal`, branch `audit/fresh-pass`, HEAD `fa88c08`. Read-only pass.
**Not in scope (other agents):** visual design, accessibility, performance, security, data modelling. Accessibility is referenced only where it is inseparable from a state (e.g. `role="alert"` on a failure notice).

---

## 1. Method

### What I examined

- **All 46 `page.tsx` files** under `app/`, plus 4 `layout.tsx`, 9 `loading.tsx`, 5 `error.tsx`, 1 `global-error.tsx`, 1 `not-found.tsx`, and 17 `route.ts` handlers.
- **Every Server Action module** (14 files carrying `"use server"`) and **every client call site** that invokes one (34 import sites across `components/` and `app/`).
- The shared state infrastructure: `components/unsaved-work-guard.tsx`, `lib/client/network-failure.ts`, `lib/client/attendance-draft-storage.ts`, `components/inline-notice.tsx`, `components/route-recovery.tsx`, `components/coach/coach-portal-provider.tsx`, `lib/actions/operational-result.ts`.
- **All 13 Playwright specs** under `tests/e2e/` (3,803 lines). These were the single most useful source on intended behaviour; `registration-resilience.spec.ts` and `attendance-workspaces.spec.ts` in particular encode resilience contracts that the rest of the app does not uniformly meet.
- `output/audit/web-interface-guidelines.md` (read in full), applied as behaviour rather than as Tailwind spellings, per the caveat in that file.
- The UI/UX rules database via `search.py --domain ux`. Four queries run; results reported honestly in §6.

### Flows traced end to end in source

Four complete traces, page → component → server action → service → resulting UI state:

1. **Player attendance save** (the highest-stakes path) — `app/coach/attendance/players/record/page.tsx` → `components/coach/attendance/player-attendance-recorder.tsx` → `useAttendancePortal().saveAttendanceRegister` in `components/coach/coach-portal-provider.tsx:211` → `saveAttendanceRegisterAction` in `app/coach/actions.ts:168` → `saveSessionAttendanceRecords` in `lib/sessions/service.ts:524`, including the localStorage draft round trip through `lib/client/attendance-draft-storage.ts`. Written up in §3 under ST-4, ST-8 and §4.
2. **Finance activation → monthly fee issue → payment recording** — `app/coach/financials/page.tsx:46` → `components/coach/financials/financials-activation.tsx` → `activateFinanceAction`; then `app/coach/financials/record/page.tsx` → `components/coach/financials/financials-rapid-desk.tsx:161` → `recordAllocatedPaymentAction` with `mutationId` idempotency.
3. **Player onboarding, all four stages** — `app/coach/onboarding/page.tsx` → `components/coach/onboarding/player-onboarding-register.tsx` (`RequestStep` 250 → `AssessmentStep` 338 → `SessionStep` 543 → `FeePlanStep` 729) → `app/coach/onboarding/actions.ts` and `app/coach/financials/actions.ts`. This trace produced ST-2.
4. **Two-factor enrolment** — `app/auth/two-factor/setup/page.tsx` → `components/two-factor-setup-form.tsx` → `startTotpSetup` / `confirmTotpSetup` in `app/auth/two-factor/actions.ts:187`. This trace produced UX-1.

### How inheritance was resolved

App Router special-file inheritance was resolved mechanically rather than by eye, with a Node script that walks each `page.tsx` up its **file-system** ancestry (so route groups `(public)` and `(student)` count as segments) and reports the nearest `loading.tsx` and `error.tsx`. The full output is §2. Two rules were applied:

- A `loading.tsx` is only meaningful if the segment can suspend. Each page was classified `async`/`sync` by `export default async function`. Three pages are synchronous (`/`, `/progress`, `/reports`) and are marked **n/a** for loading, not absent — a synchronous page never shows a loading boundary, so its absence is not a defect.
- An `error.tsx` does not catch throws from its *own* segment's `layout.tsx`; those go to the parent boundary. This does not change any verdict here because `app/error.tsx` sits above everything, so every route is covered either way.

### One claim proved from library source rather than asserted

The behaviour of a **rejected `useActionState` action** (ST-1) is load-bearing for several findings, so I read React's implementation rather than assume. `runActionStateAction` catches a rejection into `onActionError`, which marks the action node `"rejected"` (`node_modules/react-dom/cjs/react-dom-client.development.js:8448-8461`); `updateActionStateImpl` then passes the thenable through `useThenable` (`:8564-8581`), and `trackUsedThenable` does `case "rejected": throw thenable.reason` (`:5958-5963`). A rejected action therefore **throws during render and escalates to the nearest error boundary** — it is not returned as state. This is a property of React 19.2.8 as vendored in this repo.

### What needs a browser

I did not start a dev server (port 3000 and `.data/*.db` are shared) and ran no Playwright. The following are therefore reported at Confidence Medium with exact proof commands attached to each finding:

- The rendered result of ST-1 (which error boundary UI a coach actually sees when a login/TOTP submit fails in transit).
- Whether `loading.tsx` visibly appears on the five uncovered routes under production latency (ST-5) — the absence of the file is proved; the perceptual cost is not.
- The stranded-button behaviour in ST-2 (proved by reading, but the exact rendered label needs a browser).

---

## 2. State coverage matrix

Generated by walking file-system ancestry for every `page.tsx`. Legend: **C** = covered in this segment · **I** = inherited from an ancestor segment · **A** = absent · **n/a** = not applicable, with reason.

Column meanings:
- **Load** — an ancestor or own `loading.tsx` exists *and* the page is async.
- **Err** — an ancestor or own `error.tsx` exists.
- **Empty** — the page or its primary component renders a purposeful zero-data state (verified by reading, not by filename).
- **Off** — a failed mutation on this route is explained as a *network* condition with a retry affordance (i.e. routes through `lib/client/network-failure.ts`). Read-only routes are n/a: they have no mutation to fail.
- **1st** — genuine first-run (empty academy) renders guidance rather than an empty shell.

| # | Route | Async | Load | Err | Empty | Off | 1st |
|---|---|---|---|---|---|---|---|
| 1 | `/` | sync | n/a — synchronous, never suspends | I `app/error.tsx` | C marketing copy, static | n/a read-only | n/a public |
| 2 | `/announcements/[announcementId]` | async | I `app/(public)/announcements/loading.tsx` | I `app/error.tsx` | C `notFound()` on miss | n/a read-only | n/a public |
| 3 | `/player` | async | I `app/(student)/loading.tsx` | I `app/(student)/error.tsx` | C `page.tsx:114-133`, `:165` | n/a read-only | C |
| 4 | `/player/announcements` | async | I `app/(student)/loading.tsx` | I `app/(student)/error.tsx` | C `page.tsx:39-42` | n/a read-only | C |
| 5 | `/player/announcements/[announcementId]` | async | I `app/(student)/loading.tsx` | I `app/(student)/error.tsx` | C `notFound()` on miss | n/a read-only | C |
| 6 | `/player/financials` | async | **C** `player/financials/loading.tsx` | **C** `player/financials/error.tsx` | C `page.tsx:61` | n/a read-only | C |
| 7 | `/player/reports` | async | I `app/(student)/loading.tsx` | I `app/(student)/error.tsx` | C `page.tsx:37-42` | n/a read-only | C |
| 8 | `/account/recovery-email/setup` | async | I `app/account/loading.tsx` | I `app/error.tsx` | n/a form-only | **A** ST-1 | n/a |
| 9 | `/account/security` | async | I `app/account/loading.tsx` | I `app/error.tsx` | C single-session copy `:156` | **A** ST-1, ST-3 | n/a |
| 10 | `/activate` | async | **A** ST-5 | I `app/error.tsx` | C 4-state machine `:58-71` | **A** ST-1 | n/a |
| 11 | `/admin` | async | I `app/admin/loading.tsx` | I `app/error.tsx` | C `page.tsx:135` | **A** ST-3 (has try/catch, no network wording) | C |
| 12 | `/auth/pin/setup` | async | I `app/auth/loading.tsx` | I `app/error.tsx` | n/a form-only | **A** ST-1 | n/a |
| 13 | `/auth/two-factor` | async | I `app/auth/loading.tsx` | I `app/error.tsx` | n/a form-only | **A** ST-1 | n/a |
| 14 | `/auth/two-factor/reconnect` | async | I `app/auth/loading.tsx` | I `app/error.tsx` | n/a form-only | **A** ST-1 | n/a |
| 15 | `/auth/two-factor/recovery` | async | I `app/auth/loading.tsx` | I `app/error.tsx` | n/a form-only | **A** ST-1 | n/a |
| 16 | `/auth/two-factor/setup` | async | I `app/auth/loading.tsx` | I `app/error.tsx` | n/a form-only | **A** ST-1, UX-1 | n/a |
| 17 | `/coach` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C every card has a zero branch | n/a read-only | C except UX-4 |
| 18 | `/coach/announcements` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `announcement-archive.tsx:124` | **A** ST-3 | C |
| 19 | `/coach/announcements/new` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | n/a composer | C good copy `announcement-composer.tsx:116` | n/a |
| 20 | `/coach/announcements/[id]` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `notFound()` on miss | **A** ST-3 | n/a |
| 21 | `/coach/attendance` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | n/a pure redirect `:11` | n/a | n/a |
| 22 | `/coach/attendance/adjustments` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `:666-669` and per-step | **A** ST-3 | C |
| 23 | `/coach/attendance/coaches` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | n/a pure redirect `:11` | n/a | n/a |
| 24 | `/coach/attendance/players/record` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `:354-358`, `:377-387`, `:508-512` | **C** best in app | C |
| 25 | `/coach/attendance/players/register` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `player-attendance-register.tsx:258` | n/a read-only | C |
| 26 | `/coach/attendance/staff/record` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `staff-roll-call.tsx:239-243` | **C** | C |
| 27 | `/coach/attendance/staff/register` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `staff-attendance-register.tsx:143` | n/a read-only | C |
| 28 | `/coach/calendar` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `session-calendar.tsx:277-282` | **A** ST-3 | C |
| 29 | `/coach/financials` | async | I `app/coach/financials/loading.tsx` | I `app/coach/financials/error.tsx` | C activation panel `:46` | **A** ST-3 | C |
| 30 | `/coach/financials/record` | async | I `app/coach/financials/loading.tsx` | I `app/coach/financials/error.tsx` | C redirects if not activated `:47` | **A** ST-3 | C |
| 31 | `/coach/financials/records` | async | I `app/coach/financials/loading.tsx` | I `app/coach/financials/error.tsx` | C `EmptyRecords` ×3 `:503,:627,:715` | **A** ST-3 | C |
| 32 | `/coach/financials/players/[playerId]` | async | I `app/coach/financials/loading.tsx` | I `app/coach/financials/error.tsx` | C `player-ledger.tsx:506`, `:1586` | **A** ST-3 | C |
| 33 | `/coach/members` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `member-directory.tsx:1062-1067` | **A** ST-3 | C |
| 34 | `/coach/onboarding` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `:1218` | **A** ST-2, ST-3 | C |
| 35 | `/coach/reports` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `published-reports.tsx:144` | n/a read-only | C |
| 36 | `/coach/reports/publications/[publicationId]` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `notFound()` on miss | n/a read-only | n/a |
| 37 | `/coach/reports/write` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `report-workspace.tsx:674-688` | **A** ST-3 | C |
| 38 | `/coach/schedules` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | C `session-schedules.tsx:770-773` | **A** ST-3 | C |
| 39 | `/coach/schedules/new` | async | I `app/coach/loading.tsx` | I `app/coach/error.tsx` | n/a create form | **A** ST-3 | n/a |
| 40 | `/login` | async | **A** ST-5 | I `app/error.tsx` | n/a form-only | **A** ST-1 | n/a |
| 41 | `/progress` | sync | n/a — synchronous redirect | I `app/error.tsx` | n/a redirect | n/a | n/a |
| 42 | `/recover` | async | **A** ST-5 | I `app/error.tsx` | n/a form-only | **A** ST-1 | n/a |
| 43 | `/recover/reset` | async | **A** ST-5 | I `app/error.tsx` | C expired-token branch | **A** ST-1 | n/a |
| 44 | `/register` | async | **A** ST-5 | I `app/error.tsx` | n/a form-only | **C** `registration-form.tsx:55-61` | n/a |
| 45 | `/reports` | sync | n/a — synchronous redirect | I `app/error.tsx` | n/a redirect | n/a | n/a |
| 46 | `/setup/head-coach` | async | I `app/setup/loading.tsx` | I `app/error.tsx` | C claim-state branches | **A** ST-1 | C |

### Totals after resolving inheritance

| State | Covered (own or inherited) | Genuinely absent | Not applicable |
|---|---|---|---|
| **Loading** | 41 | **5** — `/login`, `/register`, `/recover`, `/recover/reset`, `/activate` | 3 (`/`, `/progress`, `/reports` are synchronous) |
| **Error** | **46** | 0 | 0 |
| **Empty / zero-data** | 30 | 0 | 16 (forms, redirects, detail routes using `notFound()`) |
| **Offline / failed mutation** | 4 — `/coach/attendance/players/record`, `/coach/attendance/staff/record`, `/register`, `/coach/announcements/new` | **21** mutating routes | 21 (read-only or redirect) |
| **First run** | 20 | 0 (one weak case, UX-4) | 26 |

**The headline is that loading, error and empty are in very good shape and offline is not.** Only 5 of 46 routes lack a loading state and every one of the 46 has an error boundary. Empty states are genuinely comprehensive — I found none missing. The one systemic hole is failed-mutation handling: the app has a purpose-built network-failure classifier and uses it on 2 of 23 mutating surfaces.

---

## 3. Findings

Ordered by severity, then confidence. Anything that can silently lose a coach's work or fail opaquely on bad connectivity is at the top.

---

### ST-1 — A form submission that never reaches the server destroys the whole page and everything typed into it, on every authentication surface

- **Classification:** mutation feedback
- **Type:** Objective defect
- **Severity:** Critical
- **Location:** 20 `useActionState` call sites across 12 components, covering 9 routes:
  - `components/login-form.tsx:50`, `:87` → `/login`
  - `components/two-factor-verification-form.tsx:17`, `:18` → `/auth/two-factor`
  - `components/two-factor-setup-form.tsx:18`, `:19` → `/auth/two-factor/setup`
  - `components/two-factor-reconnect-form.tsx:15` → `/auth/two-factor/reconnect`
  - `components/authenticator-recovery-form.tsx:17`, `:60` → `/auth/two-factor/recovery`
  - `components/pin-setup-form.tsx:18` → `/auth/pin/setup`
  - `components/activation-form.tsx:12` → `/activate`
  - `components/recovery-form.tsx:17` → `/recover`
  - `components/recovery-reset-forms.tsx:21`, `:63` → `/recover/reset`
  - `components/account-security-workspace.tsx:66`, `:70`, `:71` → `/account/security`
  - `components/recovery-email-enrollment-form.tsx:32`, `:36` → `/activate`, `/account/recovery-email/setup`, `/setup/head-coach`
  - `components/recovery-email-security-panel.tsx:26`, `:30` → `/account/security`
  - `components/head-coach-setup-form.tsx:22` → `/setup/head-coach`
- **Evidence:** every site passes the server action straight in, with no client-side rejection handling:

  ```
  components/login-form.tsx:50
    const [state, formAction, pending] = useActionState(loginWithAcademyId, initialState)
  components/two-factor-verification-form.tsx:17
    const [totpState, totpAction, totpPending] = useActionState(verifyTotpSignIn, initialState)
  ```

  React's own implementation, as vendored at `react-dom@19.2.8`, escalates a rejected action to the error boundary rather than returning it as state:

  ```
  node_modules/react-dom/cjs/react-dom-client.development.js:8454-8456
    (actionNode.status = "rejected"),
      (actionNode.reason = error),
      notifyActionListeners(actionNode),

  node_modules/react-dom/cjs/react-dom-client.development.js:5958-5963
    case "rejected":
      throw (
        ((thenableState = thenable.reason),
        checkIfUseWrappedInAsyncCatch(thenableState),
        thenableState)
      );
  ```

  A transport failure rejects with a `TypeError` — the exact condition `lib/client/network-failure.ts:66-74` was written to classify. The server actions themselves are careful (`app/login/actions.ts` returns `{ error }` for every *server-side* failure), so this is purely about the request never arriving. The contrast is decisive: the one hand-rolled form in the app does handle it, and there is a Playwright test asserting the behaviour:

  ```
  components/registration-form.tsx:53-61
      try {
        setState(await submitRegistration(initialState, formData))
      } catch {
        setState({
          error: SUBMISSION_FAILURE_MESSAGE,   // "We couldn't send your request. Your name is still here—please try again."

  tests/e2e/registration-resilience.spec.ts:281-285
      await expect(formError).toContainText("We couldn't send your request")
      await expect(fullNameField).toHaveValue(fullName)
      await expect(submit).toBeEnabled()
  ```
- **Why it matters:** the guidelines require that error messages "include fix/next step, not just problem". Replacing the form with `app/error.tsx`'s "Something went wrong. Try loading it again." gives no cause, no next step, and — worse — discards the user's input, because the entire subtree unmounts. Every one of these 20 sites is on the critical path to *getting into the product at all*. The team clearly knows the right answer; it is implemented once, tested, and then not generalised.
- **User impact:** a head coach signing in courtside on a weak connection enters their username and password, taps Continue, and the page is replaced by a generic error card with the form gone. On `/auth/two-factor` they lose a 6-digit TOTP code that expires in 30 seconds and must re-read it from their phone. A parent on `/activate` loses a password they just composed. On `/recover/reset` a user mid-recovery is thrown out of the flow with no indication whether the reset landed.
- **Effort:** M — a `useResilientActionState` wrapper that catches the rejection and folds `describeSaveFailure` output into the existing `state.error` shape, then 20 mechanical call-site swaps. The action signatures already carry an `error: string | null` field, so no state-shape changes are needed.
- **Confidence:** Medium — the React mechanism is proved from source (High), but I have not observed the rendered outcome in this app.
- **How to prove:**
  ```
  npm run db:prepare:local
  BETTER_AUTH_SECURE_COOKIES=false DB_FILE_NAME=.data/academy-clean.db npx next dev -p 3100
  ```
  Open `http://localhost:3100/login`, DevTools → Network → Offline, fill both fields, submit. Expect `app/error.tsx` ("Something went wrong.") and an empty form on reset. Repeat at `/auth/two-factor`. Compare against `http://localhost:3100/register`, which should keep the typed name and show an inline message.

---

### ST-2 — A failed onboarding reset leaves the button disabled and spinning forever, with the coach's fee preview already thrown away

- **Classification:** mutation feedback / data loss
- **Type:** Objective defect
- **Severity:** High
- **Location:** `components/coach/onboarding/player-onboarding-register.tsx:744-760` (single site; button at `:801-803`)
- **Evidence:** this is the only async handler in the codebase that raises a busy flag without a `try`/`finally`. I scanned every async function in `app/` and `components/` that contains an `await` and sets a busy flag; 20 sites, 19 correct, this one not:

  ```
  744:   async function resetAssignment() {
  745:     if (busy) return
  746:     setBusy(true)
  747:     setFeedback(null)
  748:     setPreview(null)
  749:     setConfirmed(false)
  750:     const result = await resetOnboardingSessionAssignmentAction(item.id)
  751:     setBusy(false)
  ```

  The button that calls it:

  ```
  801:         <button type="button" disabled={busy} onClick={() => void resetAssignment()}>
  802:           {busy ? "Resetting…" : "Reset session assignment"}
  803:         </button>
  ```

  `resetOnboardingSessionAssignmentAction` (`app/coach/onboarding/actions.ts:27-46`) returns `{ ok: false }` for `OperationalActionError` but **rethrows everything else** (`:44`), and a transport failure rejects before the server is reached either way. On rejection, line 751 never runs, so `busy` stays `true`; `onClick={() => void resetAssignment()}` discards the promise, so nothing catches it and no message is set. Two further lines make it worse: `:748` and `:749` clear `preview` and `confirmed` **before** the await, so the fee timeline the coach generated is gone even though the reset failed.
- **Why it matters:** the guidelines require a submit button to re-enable and a failure to explain itself. Here the control is permanently disabled with no error text, so the surface is unrecoverable without a manual reload — and the reload also discards the preview. Every other handler in this same 1,225-line file gets this right (`:257-269`, `:390-425`, `:594-618`, `:826-885`), which makes it a clear oversight rather than a design choice.
- **User impact:** a head coach clearing a stuck future-dated onboarding case taps "Reset session assignment", the request fails, and the button reads "Resetting…" forever. Nothing tells them whether the reset happened. They reload, and their generated fee timeline is gone too.
- **Effort:** S — wrap in `try`/`catch`/`finally`, move the `setPreview(null)` / `setConfirmed(false)` clears into the success branch, and route the catch through `describeSaveFailure`.
- **Confidence:** High — proved by reading; the control flow is unambiguous.
- **How to prove:** already proved statically. For a live demo: at `/coach/onboarding` with a future-dated case, DevTools → Network → Offline, click "Reset session assignment"; the button stays disabled and no notice appears.

---

### ST-3 — Twenty-one mutating surfaces show the raw browser exception text when the network fails, while the app already owns a classifier that writes the right sentence

- **Classification:** mutation feedback / copy
- **Type:** Objective defect
- **Severity:** High
- **Location:** 31 catch sites that surface `error.message` verbatim. Full list:
  - `components/coach/financials/player-ledger.tsx:146`, `:196`, `:379`, `:561`, `:700`, `:852`, `:985`, `:1060`, `:1121`, `:1359` (10 sites)
  - `components/coach/onboarding/player-onboarding-register.tsx:264`, `:292`, `:421`, `:614`, `:881` (5)
  - `components/coach/calendar/session-schedules.tsx:423`, `:610`, `:750` (3)
  - `components/coach/calendar/session-calendar.tsx:353`, `:394` (2)
  - `components/coach/attendance-adjustments-workspace.tsx:485`, `:511` (2)
  - `components/coach/financials/financials-rapid-desk.tsx:153`, `:206` (2)
  - `components/coach/members/member-directory.tsx:494`, `:547` (2)
  - `components/coach/reports/report-workspace.tsx:305`, `:369` (2)
  - `components/coach/calendar/session-create.tsx:176` (1)
  - `components/coach/financials/financials-activation.tsx:39` (1)
  - `components/coach/financials/prepare-fees.tsx:49` (1)
  - `components/admin/admin-authenticator-recovery-queue.tsx:47-49` (1)
- **Evidence:** the shared helper exists and is complete —

  ```
  lib/client/network-failure.ts:122-133
    const cause = failure === "offline"
      ? "this device is offline"
      : "the request did not complete"
    const nextStep = failure === "offline"
      ? "Try again when the connection returns"
      : "Check the connection and try again"
    return {
      kind: failure,
      message: `${subject} could not be saved because ${cause}. ${retained}. ${nextStep}.`,
      offerRetry: true,
    }
  ```

  — but `rg -n "describeSaveFailure" components app` returns exactly two consumers, both attendance:

  ```
  components/coach/attendance/player-attendance-recorder.tsx:276
  components/coach/attendance/staff-roll-call.tsx:181
  ```

  Everywhere else the pattern is the raw message:

  ```
  components/coach/financials/player-ledger.tsx:196
          message: error instanceof Error ? error.message : "The refund could not be recorded",
  components/coach/members/member-directory.tsx:494
          message: error instanceof Error ? error.message : "The member could not be saved",
  ```

  For a transport failure the `error instanceof Error` branch wins, so the coach is shown the browser's own wording — `"Failed to fetch"` (Chrome), `"Load failed"` (Safari), `"NetworkError when attempting to fetch resource."` (Firefox). `lib/client/network-failure.ts:53-64` documents these exact strings as the thing the classifier exists to hide. The fallback string after the `:` — which is decent copy — is only reached for a non-`Error` throw, which essentially never happens.
- **Why it matters:** two guideline rules, applied literally. "Error messages include fix/next step, not just problem": `Load failed` has neither. And the classifier's `offerRetry` flag, which drives the "Save attendance again" affordance in the two attendance components, is unavailable at all 31 of these sites, so none of them can offer the retry the guidelines ask for. There is also a correctness dimension the helper handles and these sites do not: `withSaveDeadline` distinguishes a *timeout* (write may have landed) from a *failure* (it certainly did not), and says so.
- **User impact:** a head coach recording a ₹4,000 payment in a patchy corner of the venue taps "Record payment" and sees `Load failed` next to the form. Nothing tells them whether the payment was recorded, whether to retry, or whether retrying will double-charge. The same coach on the attendance screen, two taps away, gets a full sentence naming the cause, confirming their marks are retained, and offering a safe retry.
- **Effort:** M — the call sites are uniform; the change is mechanical. `player-ledger.tsx` alone accounts for 10 of 31.
- **Confidence:** High — proved by reading. The browser strings are documented in the repo's own source comment.
- **How to prove:** already proved statically. Live: `/coach/financials/record`, DevTools → Offline, submit a payment; compare the notice against the same treatment on `/coach/attendance/players/record`.

---

### UX-1 — Two-factor recovery codes are displayed once, on a screen with no copy, no download and no acknowledgement, and can never be retrieved again

- **Classification:** data loss / flow friction
- **Type:** Objective defect
- **Severity:** High
- **Location:** `components/two-factor-setup-form.tsx:64-68` (display); `components/two-factor-setup-form.tsx:69-91` (the verify form that navigates away); `app/auth/two-factor/actions.ts:191` (re-entry blocked); `components/account-security-workspace.tsx` (no reissue surface)
- **Evidence:** the codes are rendered as a plain list inside `useActionState` state and nothing else:

  ```
  64:      <section className="totp-backup-codes" aria-labelledby="backup-code-title">
  65:        <h2 id="backup-code-title">Save these recovery codes now</h2>
  66:        <p>Each code works once. Store them somewhere separate from this device.</p>
  67:        <ul>{setupState.setup.backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
  68:      </section>
  ```

  There is no copy button, no download, no `confirm` checkbox gating the verify submit. The verify form immediately below it is fully enabled. The codes live only in `setupState`, which is client memory — a reload, a back navigation, or an ST-1 rejection discards them.

  Re-entry to the setup screen is blocked once enrolment succeeds:

  ```
  app/auth/two-factor/actions.ts:191
    if (rawSession.user.twoFactorEnabled) redirect(destinationForUser(rawSession.user.id))
  ```

  And there is no reissue surface anywhere. Searching the account security page and its workspace for any mention of the concept returns nothing:

  ```
  $ rg -n "recovery code|backup code|Recovery code" components/account-security-workspace.tsx app/account/security/page.tsx
  $ echo $?
  1
  ```

  `/account/security` offers only "Reconnect authenticator" (`components/account-security-workspace.tsx:117-120`), which per `app/auth/two-factor/setup/page.tsx:60` *retires* the existing codes rather than showing them.
- **Why it matters:** the screen's own heading is an instruction — "Save these recovery codes now" — that the interface gives the user no means to follow. Under `Navigation & State`, "destructive actions need confirmation modal or undo window"; irreversibly discarding the only copy of an account's recovery secrets by navigating forward is exactly that, and it happens on a button press with no gate. Every mainstream 2FA enrolment flow (GitHub, Google, Stripe) puts a download/copy control and an "I have saved these" checkbox between the codes and the continue button.
- **User impact:** a head coach enrolling on their phone courtside scans the QR, types the 6-digit code, and taps "Verify and enter workspace" without scrolling back to transcribe ten codes. The codes are gone permanently. When they later replace their phone, their only route back in is the admin-mediated queue at `/auth/two-factor/recovery`, which requires a platform admin to action a request — plausibly days of lost access to the register.
- **Effort:** M — add a "Copy codes" button and a "Download as text" link, gate the verify submit behind an "I have saved these codes" checkbox (the pattern already exists in this codebase at `components/coach/financials/financials-activation.tsx:81-93`), and keep the codes in state until verification succeeds.
- **Confidence:** High — the absence of a reissue surface is proved by an exhaustive search that returned nothing.
- **How to prove:** already proved statically.

---

### ST-4 — Report prose, the longest free text in the product, is the one substantial input with no local draft persistence

- **Classification:** data loss
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `components/coach/reports/report-workspace.tsx:250` (the only home for the text), `:281-311` (`saveDraft`); `components/coach/reports/report-resume.ts:37-42` (persists a pointer, not content)
- **Evidence:** the text lives in component state alone:

  ```
  components/coach/reports/report-workspace.tsx:250
    const [reportText, setReportText] = useState(report?.reportText ?? "")
  ```

  with a 5,000-character ceiling (`:406` — "Maximum 5,000 characters"). What *is* persisted is only which player and month to return to:

  ```
  components/coach/reports/report-resume.ts:37-42
  export function persistReportResumePoint(
    storage: Pick<Storage, "setItem">,
    resumePoint: CoachReportResumePoint,
  ) {
    storage.setItem(REPORT_RESUME_STORAGE_KEY, JSON.stringify(resumePoint))
  }
  ```

  `CoachReportResumePoint` is `{ month, playerId }` (`report-resume.ts:21-24`) — no text. An exhaustive search confirms only two client-storage consumers exist in the whole app:

  ```
  $ rg -n "localStorage|sessionStorage" lib components app
  components/coach/reports/report-resume.ts:51
  components/coach/reports/report-resume.ts:65
  lib/client/attendance-draft-storage.ts:67
  ```

  The codebase already articulates precisely why this matters, in the module header of the feature that *does* persist:

  ```
  lib/client/attendance-draft-storage.ts:5-10
   * Attendance marks live in component state until the coach saves them, so until
   * now a discarded page took every mark with it and left no trace: iOS Safari
   * reclaims a backgrounded tab under memory pressure, and the leave-site dialog
   * is one mis-tap from confirming. These drafts are the only record of marks that
   * were made but never sent.
  ```

  Every clause of that applies verbatim to a half-written report. `useUnsavedWorkGuard` (`report-workspace.tsx:514`) covers deliberate navigation and `beforeunload`, but tab reclamation fires neither.
- **Why it matters:** the guard protects against the user *choosing* to leave. It cannot protect against the OS reclaiming the tab, which is the scenario the attendance-draft module was written to survive. Two comparable surfaces in one product, one hardened and one not, for the same failure mode.
- **User impact:** a head coach writes two paragraphs on a player, switches to a message to check a detail, and comes back to an empty textarea. The resume pointer helpfully returns them to the right player and month — with nothing in it.
- **Effort:** M — `lib/client/attendance-draft-storage.ts` is a ready-made template (versioned key, defensive parser, quota-tolerant write, staleness pruning). Key on `${playerId}:${month}`, reuse `restoredAttendanceDraftNotice`-style announced restore.
- **Confidence:** High — proved by exhaustive search for client storage.
- **How to prove:** already proved statically.

---

### ST-5 — Five async routes have no loading state, including the app's front door

- **Classification:** missing state
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `app/login/page.tsx`, `app/register/page.tsx`, `app/recover/page.tsx`, `app/recover/reset/page.tsx`, `app/activate/page.tsx`. There is no `app/loading.tsx`, so nothing is inherited.
- **Evidence:** inheritance resolved by walking file-system ancestry for all 46 pages; these five are the only async pages with no `loading.tsx` above them:

  ```
  /activate      | app/activate/page.tsx      | async | NONE | app/error.tsx
  /login         | app/login/page.tsx         | async | NONE | app/error.tsx
  /recover       | app/recover/page.tsx       | async | NONE | app/error.tsx
  /recover/reset | app/recover/reset/page.tsx | async | NONE | app/error.tsx
  /register      | app/register/page.tsx      | async | NONE | app/error.tsx
  ```

  They genuinely suspend — each awaits a session lookup, not just params:

  ```
  app/login/page.tsx:26      const identity = await sessionProvider.getCurrentIdentity()
  app/register/page.tsx:22   const identity = await sessionProvider.getCurrentIdentity()
  app/recover/page.tsx:22    const identity = await sessionProvider.getCurrentIdentity()
  ```

  The remaining three uncovered routes (`/`, `/progress`, `/reports`) are **synchronous** and correctly need nothing. Nine other segments already do this properly with the shared `RouteLoadingState`, including `app/auth/loading.tsx` — so `/auth/two-factor` is covered while `/login`, one step earlier in the same journey, is not.
- **Why it matters:** in production the database is Turso over the network, so `getCurrentIdentity()` is a real round trip. Without a boundary the user gets a blank document while it resolves. The gap is arbitrary rather than considered: the component, the copy conventions and eight sibling examples all already exist.
- **User impact:** a parent on a slow mobile connection opens the portal link and sees white until the session check returns, with no signal the app is working. This is the first impression for every unauthenticated visitor.
- **Effort:** S — four files (`app/login/loading.tsx`, `app/register/loading.tsx`, `app/recover/loading.tsx`, `app/activate/loading.tsx`; `/recover/reset` inherits from `app/recover/`), each ~10 lines copying `app/auth/loading.tsx`. I recommend the targeted version over a single `app/loading.tsx`, which would put a Suspense boundary above the static marketing home.
- **Confidence:** High for the absence (mechanically resolved). Medium for the perceptual cost, which depends on production latency.
- **How to prove:** for the perceptual cost — `npx next build && npx next start -p 3100`, then DevTools → Network → Slow 4G, hard-load `/login` and watch for an unstyled gap; compare with `/auth/two-factor`.

---

### UX-2 — Rejecting a registration is irreversible and the confirmation does not say so

- **Classification:** destructive action / copy
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `components/coach/onboarding/player-onboarding-register.tsx:284`
- **Evidence:**

  ```
  284:    if (busy || !window.confirm(`Reject ${item.fullName}’s registration request?`)) return
  ```

  The case is then removed from the register entirely (`:299` passes `remove: true`), and there is no un-reject action anywhere in `app/coach/onboarding/actions.ts` or `app/coach/actions.ts`. Compare with how carefully the *same codebase* words its other confirmations:

  ```
  components/coach/members/member-directory.tsx:505
    `Archive ${player.member.fullName}? Their portal access will be revoked, while attendance and reports remain preserved.`
  components/coach/calendar/session-schedules.tsx:734
    `End ${seriesLabel(series)} now? Upcoming sessions will be cancelled and every player will be removed from this schedule. This cannot be undone.`
  components/coach/attendance-adjustments-workspace.tsx:496
    `Void this make-up adjustment${...}? The original absence will be restored.`
  ```

  Each of those names the consequence. The rejection prompt restates the button label as a question.
- **Why it matters:** a confirmation whose text carries no information beyond "are you sure" trains users to dismiss it. The guidelines' `Content & Copy` section asks for specificity; the surrounding code already meets that bar, so this reads as an omission.
- **User impact:** a head coach clearing a queue mis-taps Reject on a genuine applicant. The prompt gives no reason to pause. The applicant vanishes from onboarding and must be told to register again from scratch — the coach has no way to tell them, because the rejected record is gone from the register.
- **Effort:** S — one string. Suggested: *"Reject {name}'s registration request? They will be removed from onboarding and will have to register again. This cannot be undone."*
- **Confidence:** High.

---

### UX-3 — Two concession confirmations omit the amount, on the one screen where money is the whole point

- **Classification:** destructive action / copy
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `components/coach/financials/player-ledger.tsx:969`, `:1044`
- **Evidence:**

  ```
   969:    if (!window.confirm(`Apply this concession to ${charge.feeReference}?`)) return
  1044:    if (!window.confirm(`Reverse the concession applied to ${application.feeReference}?`)) return
  ```

  Neither states how much is being written off or restored. The refund confirmations in the same file do exactly that:

  ```
  157-158:    if (!window.confirm(
                `Record a ${formatInr(reviewedAmountPaise)} refund for ${receipt.receiptReference} and end the fee plan on ${formatDueDate(withdrawalEffectiveOn)}?`,
  ```

  `formatInr` is already imported in this file (`components/coach/financials/financials-client-utils.ts:44`), so the value is one call away.
- **Why it matters:** the fee reference is an opaque identifier; the rupee amount is the thing a head coach can actually check against their intent. A confirmation that omits the only verifiable fact is not a real check.
- **User impact:** a head coach applying concessions across several charges confirms the wrong one and only discovers it when a parent queries the invoice. The reversal is available but requires noticing first.
- **Effort:** S — two strings, using the `formatInr` already in scope.
- **Confidence:** High.

---

### ST-6 — Logging devices out gives no confirmation, no success message and no failure message

- **Classification:** destructive action / mutation feedback
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** `components/account-security-workspace.tsx:176-179` (single session), `:201` (all other devices)
- **Evidence:**

  ```
  176:                      onClick={() => {
  177:                        setRevokingSessionId(session.id)
  178:                        startTransition(() => revokeSessionAction(session.id))
  179:                      }}

  201:            <button className="security-secondary-action" type="button" onClick={() => startTransition(() => revokeOtherSessionsAction())} disabled={isPending}>
  202:              Log out other devices
  203:            </button>
  ```

  The returned promise is never inspected — no `await`, no `.catch`, no result handling. There is no `window.confirm` on either path, and no `InlineNotice` anywhere in the sessions panel (`:150-205`). Both actions do call `revalidatePath("/account/security")` server-side (`app/account/security/actions.ts:136`, `:154`), so on success the list eventually updates; on failure nothing at all happens. Every one of the 14 other `window.confirm` sites in this codebase guards a *less* disruptive action than "sign out every other device".
- **Why it matters:** `Navigation & State` — "Destructive actions need confirmation modal or undo window — never immediate." Both are immediate. And per the UX rules database (`Feedback / Confirmation Messages`: *Do: brief success message · Don't: silent success*), success here is entirely silent.
- **User impact:** a head coach clicks "Log out other devices" to be safe, and cannot tell whether it worked. If it failed, the stale device stays signed in and the coach believes it does not. Conversely a mis-click immediately signs out their own tablet at the venue with no confirmation step.
- **Effort:** S — add `window.confirm` naming the device count, and an `InlineNotice` fed by an awaited result.
- **Confidence:** High.

---

### ST-7 — Ten surfaces holding real user input sit outside the unsaved-work provider and cannot use the guard even if they wanted to

- **Classification:** data loss
- **Type:** Objective defect
- **Severity:** Medium
- **Location:** provider mounted only at `app/coach/layout.tsx:39` and `:49`. Uncovered input surfaces: `/auth/two-factor/setup`, `/auth/two-factor/reconnect`, `/auth/pin/setup`, `/account/security`, `/account/recovery-email/setup`, `/setup/head-coach`, `/activate`, `/register`, `/recover`, `/recover/reset`.
- **Evidence:** the provider appears in exactly one file —

  ```
  $ rg -n "UnsavedWorkProvider" app components
  app/coach/layout.tsx:5:import { UnsavedWorkProvider } from "@/components/unsaved-work-guard"
  app/coach/layout.tsx:39:        <UnsavedWorkProvider>
  app/coach/layout.tsx:49:      <UnsavedWorkProvider>
  ```

  — and the hook hard-fails outside it, so this is a structural block rather than an oversight per surface:

  ```
  components/unsaved-work-guard.tsx:317-319
    if (!context) {
      throw new Error("useUnsavedWorkGuard must be used inside UnsavedWorkProvider")
    }
  ```

  All 17 `useUnsavedWorkGuard` call sites are consequently under `components/coach/`. Note this is *correctly* scoped for `(student)` routes, which are read-only and hold no input — the gap is specifically the `auth`, `account`, `setup` and root-level form routes.
- **Why it matters:** the highest-consequence instance is `/auth/two-factor/setup`, where navigating away discards recovery codes permanently (UX-1). `/setup/head-coach` is a one-time academy bootstrap, and `/account/security` holds password and PIN entry.
- **User impact:** a coach on the 2FA setup screen taps the browser back button to check something and loses the recovery codes with no warning — the exact interaction `beforeunload` exists to intercept.
- **Effort:** S — hoist `UnsavedWorkProvider` to `app/layout.tsx`, or add it to the auth/account/setup subtrees. The provider is a client component wrapping children with no server dependency, so hoisting is low-risk; it does add a client boundary at the root, which argues mildly for the subtree option.
- **Confidence:** High.

---

### ST-8 — A restored attendance draft claims marks are unsaved when the server already has them

- **Classification:** missing state / copy
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `components/coach/attendance/player-attendance-recorder.tsx:133-146`; same shape at `components/coach/attendance/staff-roll-call.tsx:97-109`
- **Evidence:** the restore path adopts the stored draft wholesale, with no comparison against the server-rendered records that are in scope on the same line:

  ```
  136:      const restored = readPlayerAttendanceDraft(selectedOccurrenceId)
  137:      if (!restored.length) return
  138:      setDraftChanges(restored)
  139:      setFeedback({
  140:        message: restoredAttendanceDraftNotice(restored.length, "save attendance"),
  ```

  and that notice asserts something that may be false:

  ```
  lib/client/attendance-draft-storage.ts:292-293
    return `${count} unsaved ${count === 1 ? "change" : "changes"} restored from an`
      + ` earlier visit. Nothing is recorded until you ${saveAction}`
  ```

  The reconciliation logic already exists eleven lines away in the *same component*, in the mark handler, which drops a change that matches the stored value:

  ```
  245:    const matchesBase = next === base || (next === "cleared" && !base)
  246:    const nextChanges: SessionAttendanceChange[] = matchesBase
  247:      ? rest
  ```

  The restore path is reachable with already-saved marks because a `SaveTimeoutError` (`lib/client/network-failure.ts:42-51`) leaves the draft in place while the write may well have landed — the helper says so explicitly at `:107-108`.
- **Why it matters:** the notice is designed to prevent a dangerous misreading ("these look saved but are not"). In the timeout case it produces the opposite misreading, telling a coach that recorded attendance is unrecorded.
- **User impact:** a coach whose save timed out reopens the register later and is told "6 unsaved changes restored from an earlier visit. Nothing is recorded until you save attendance" — for six marks that are in the database. Self-healing (pressing Save is an idempotent no-op, see §4), but it costs trust in the notice at exactly the moment it matters.
- **Effort:** S — filter `restored` against `attendanceRecords[selectedOccurrenceId]` before `setDraftChanges`, and skip the notice if nothing survives.
- **Confidence:** High for the code path; Medium for how often a real timeout produces it.
- **How to prove:** at `/coach/attendance/players/record`, mark players, use DevTools request blocking to hold the action past the 20 s deadline while letting it complete server-side, then reload.

---

### UX-4 — The Attendance dashboard card is the only card that does not adapt its copy to an empty academy

- **Classification:** IA / copy
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `components/coach/attendance-card.tsx:22-58`
- **Evidence:** `scheduleCount` arrives but is used only to render the status pill; the body copy and all five links are constant:

  ```
  $ rg -n "scheduleCount" components/coach/attendance-card.tsx
  22:export function AttendanceCard({ scheduleCount }: { scheduleCount: number }) {
  27:        count: scheduleCount,
  28:        unit: scheduleCount === 1 ? "schedule" : "schedules",
  ```

  ```
  33:      <CoachDashboardSummary detail="Current truth for every scheduled session and academy day.">
  34:        Player &amp; staff registers
  ```

  Every sibling card branches on emptiness:

  ```
  components/coach/sessions-card.tsx:24            : "No training scheduled yet."
  components/coach/members-card.tsx:25             : "Approved players and staff appear here once onboarding is complete."
  components/coach/financials/financials-card.tsx:83   Financial records are not set up
  components/coach/announcements/announcement-card.tsx:11  : "Notice board is clear"
  components/coach/player-onboarding-card.tsx:43   : "Academy onboarding is complete"
  ```
- **Why it matters:** on day one the card reads "0 schedules · Player & staff registers · Current truth for every scheduled session and academy day", offering three player links and two staff links that all lead to correctly-empty screens. The destinations handle it well (`player-attendance-register.tsx:258`, `staff-roll-call.tsx:241`), so this is a wasted trip rather than a broken one — but it is the only card that makes the head coach take it. Per the UX rules database (`Feedback / Empty States`: *Do: show helpful message and action*), the card has the action and not the message.
- **User impact:** a head coach on day one clicks into Attendance expecting somewhere to start, finds nothing to do, and has to work out for themselves that Sessions comes first.
- **Effort:** S — branch `detail` on `scheduleCount === 0` and point the primary action at `/coach/schedules/new`, matching `SessionsCard`.
- **Confidence:** High.

---

### UX-5 — "Attendance register" labels two different destinations inside one card

- **Classification:** copy / IA
- **Type:** Objective defect
- **Severity:** Low
- **Location:** `components/coach/attendance-card.tsx:12` and `:18`
- **Evidence:**

  ```
  12:  { href: "/coach/attendance/players/register", label: "Attendance register" },
  ...
  18:  { href: "/coach/attendance/staff/register", label: "Attendance register" },
  ```

  Disambiguation is entirely positional — the visible group headings "Players" and "Staff" (`:38`, `:48`) and the group `aria-label`s (`:39`, `:49`). The sibling links in the same card are specific ("Record attendance", "Reschedule attendance", "Staff roll call").
- **Why it matters:** the guidelines ask for specific labels ("Save API Key" not "Continue"). Two identical link texts in one card force the user to rely on layout, and any surface that lists links out of context — search, a future command palette, browser history — sees two indistinguishable entries.
- **User impact:** a head coach scanning the card for the staff register has to read the group heading rather than the link, which is the slower path.
- **Effort:** S — "Player register" / "Staff register", or leave the player one and rename the staff one.
- **Confidence:** High.

---

### UX-6 — "Fee Plan" and "fee plan" name the same concept on adjacent screens

- **Classification:** copy
- **Type:** Objective defect
- **Severity:** Low
- **Location:** Title Case in onboarding and members — `components/coach/onboarding/player-onboarding-register.tsx:68`, `:144`, `:147`, `:179`, `:609`, `:610`, `:765`, `:780`, `:786`, `:881`; `components/coach/player-onboarding-card.tsx:15`, `:41`; `components/coach/members/member-directory.tsx:115`, `:118`. Lower case in the ledger and finance actions — `components/coach/financials/player-ledger.tsx:677`, `:700`, `:716`, `:752`; `app/coach/financials/actions.ts:184`. Mixed within one file at `player-ledger.tsx:636` ("Fee Plan") vs `:700` ("fee plan").
- **Evidence:** the two treatments meet inside a single user journey. Onboarding ends by linking to the ledger with `Review Fee Plan` (`player-onboarding-register.tsx:786`); the ledger it lands on says `The fee plan could not be ended` (`player-ledger.tsx:700`).
- **Why it matters:** Title Case signals a proper noun — a named artefact in the product. Lower case signals a generic phrase. Using both makes it unclear whether "Fee Plan" is a thing the system tracks or just words.
- **User impact:** a head coach moving from onboarding to the ledger cannot be sure the "Fee Plan" they created is the "fee plan" being discussed. Minor, but it is the central financial object in the product.
- **Effort:** S — pick one (Title Case, given `Financials` and `Academy onboarding` are already capitalised as product areas) and apply it across ~20 strings.
- **Confidence:** High.

---

### UX-7 — Every move between workspace areas routes through the dashboard, because there is no persistent navigation

- **Classification:** IA / flow friction
- **Type:** Subjective suggestion
- **Severity:** Low
- **Location:** `components/coach/coach-shell.tsx:20-35`; the same shape at `components/app-shell.tsx:20-35`
- **Evidence:** the coach header contains a brand link and an account menu, and nothing else:

  ```
  20:      <header className="portal-header coach-portal-header">
  21:        <Link className="portal-brand coach-portal-brand" href="/coach" aria-label="SMBA Coach Workspace home">
  ...
  34:        <AccountMenu account={coach} publicSiteHref={publicSiteUrl} />
  35:      </header>
  ```

  Every interior page instead carries its own back link to the hub — `player-attendance-recorder.tsx:469`, `staff-roll-call.tsx:202`, `report-workspace.tsx:678`, `financials-activation.tsx:50`, and so on. Going from recording attendance to checking a fee record is: back to dashboard → find Financials card → Fee records.
- **Why it matters:** hub-and-spoke with a strong dashboard is a legitimate pattern, and for a phone-first courtside user it arguably beats a crowded nav bar. But it is applied uniformly to a head coach on a desktop who moves between finance, reports and members repeatedly in one sitting, and for them every transition is three interactions instead of one. Worth calling out as a deliberate trade-off to re-examine rather than a defect.
- **User impact:** a head coach doing month-end work (issue fees → check records → write reports → publish) traverses the dashboard three extra times.
- **Effort:** M — a persistent area switcher in `CoachShell` for viewports above the mobile breakpoint, leaving the phone layout as it is.
- **Confidence:** High for the absence; the severity judgement is subjective.

---

### UX-8 — The product is unusable the moment connectivity drops, with no warning beforehand

- **Classification:** missing state
- **Type:** Subjective suggestion
- **Severity:** Medium
- **Location:** app-wide. No service worker, no web app manifest, no `online`/`offline` listener.
- **Evidence:** an exhaustive search finds `navigator.onLine` read in exactly one place, and only reactively:

  ```
  $ rg -n "navigator\.onLine|addEventListener\(\"online|serviceWorker|manifest" app components lib public
  lib/client/network-failure.ts:12    return typeof navigator === "undefined" ? true : navigator.onLine !== false
  ```

  and its only caller runs after a failure has already occurred:

  ```
  lib/client/network-failure.ts:66-73
  export function classifyNetworkFailure(
    error: unknown,
    isOnline: boolean = deviceIsOnline(),
  ): NetworkFailureKind | null {
  ```

  `rg -l "manifest"` over `app/` and `public/` returns nothing, and `app/layout.tsx:37-79` declares no `manifest` in its metadata. Every route is server-rendered per request, so a navigation without connectivity yields the browser's own offline page.
- **Why it matters:** the stated usage context is a coach marking attendance courtside on poor connectivity while a session runs. The team has clearly thought hard about this at the *save* layer — the deadline, the classifier, the localStorage drafts, the retry affordance are all genuinely good. But the layer below is missing: nothing warns a coach they have gone offline, and nothing lets them open the register at all if the page was not already loaded.
- **User impact:** a coach walks into a dead spot mid-session. The register they already have open still works and drafts survive, which is the important part. But if they had navigated away first, they cannot get back, and there was no signal that the connection had dropped.
- **Effort:** L for a full app-shell service worker; **S for the high-value 20%** — an `online`/`offline` listener driving a persistent banner in `CoachShell`, so a coach knows before they mark thirty players. I would do the S first and treat the L as a separate product decision.
- **Confidence:** High for the absence; Medium for the operational severity, which depends on real venue connectivity I cannot observe.
- **How to prove:** load `/coach/attendance/players/record`, DevTools → Offline, mark players — drafts persist, save fails with good copy. Then navigate to `/coach/financials` — expect the browser offline page.

---

## 4. What's working well

Named specifics, because several of these are better than the norm and should not be regressed by any of the fixes above.

**Attendance save is genuinely well engineered, and its replay safety is real.** I set out to prove that the timeout copy — *"Attendance was not confirmed in time and may or may not have been recorded. Your marks are still on screen. Saving again is safe and will confirm the result."* (`lib/client/network-failure.ts:107-108`) — was a false promise, on the theory that a retry after a landed write would hit the optimistic-concurrency check and fail with a conflict. It does not, because the service puts the idempotent no-op **before** the conflict check:

```
lib/sessions/service.ts:651-658
      const currentChoice: SessionAttendanceChange["choice"] = stored?.choice ?? "cleared"
      if (currentChoice === change.choice) return
      if (currentChoice !== change.expectedChoice) {
        operationalActionError(
          "CONFLICT",
          "Player attendance changed since this page was opened. Refresh and try again.",
```

The staff path is identical (`lib/coach/staff-attendance.ts:342-349`). The copy is accurate and the ordering is deliberate.

**The attendance draft module is exemplary.** `lib/client/attendance-draft-storage.ts` versions its key, rejects any payload it does not recognise wholesale rather than salvaging part of it (`:85-89`), prunes on the read path so no background job is needed (`:125-129`), compares staleness symmetrically so a backwards clock discards rather than pins (`:117-123`), and retries once after quota exhaustion then gives up silently because "a draft that cannot be stored must never cost the coach the register in front of them" (`:183-192`). This is the standard the rest of the app should be measured against — and ST-4 is simply the request to apply it once more.

**`RegistrationForm` is the reference implementation for resilient mutation.** `components/registration-form.tsx` combines a UUID idempotency key that survives retries (`:50`), an in-flight ref that blocks double submission independently of React state (`:44`), retained input on failure, specific transport copy, and focus restored to the submit button (`:36-40`). `tests/e2e/registration-resilience.spec.ts:235-253` proves double submit creates one account; `:255-304` proves two consecutive 503s write nothing and preserve the exact name. ST-1 is entirely about generalising this.

**Empty-state coverage is comprehensive and I could not find a gap.** I searched under `empty`, `blank`, `none`, `zero`, `placeholder`, `no-`, `length === 0`, `!x.length`, `.length ? :`, `yet.`, `appear here`, `Nothing`, `not set up`, and `Create the first`. Every list surface has a purposeful zero state with a next action. Several are easy to miss by filename and worth naming: `components/coach/reports/report-workspace.tsx:674-688` (zero active players, with a link to Schedules), `components/coach/calendar/session-schedules.tsx:770-773`, `components/coach/attendance-adjustments-workspace.tsx:666-669`, `components/coach/financials/financial-records-workspace.tsx:503/:627/:715`.

**Destructive-action copy is mostly excellent.** Of 14 `window.confirm` sites, 11 name the consequence explicitly — `member-directory.tsx:505`, `session-schedules.tsx:734`, `session-calendar.tsx:331` and `:367`, `attendance-adjustments-workspace.tsx:496`, `player-ledger.tsx:158`, `:361`, `:1104`, `:1303`. `session-calendar.tsx:331` even folds in a *conditional* clause warning that an unsaved replacement draft will be discarded. UX-2 and UX-3 are the three exceptions, not the rule.

**Irreversible financial activation is gated properly.** `components/coach/financials/financials-activation.tsx:81-93` requires an explicit checkbox reading "I understand this creates SMBA's permanent financial ledger. It cannot be reset or switched off later; corrections remain auditable", and the submit stays disabled until it is ticked (`:96`). This is the pattern UX-1 should adopt.

**Busy-state hygiene is near-perfect.** I scanned every async function in `app/` and `components/` that awaits and sets a busy flag: 20 sites, 19 with correct `try`/`finally`. ST-2 is the single exception. Loading labels correctly use the ellipsis character the guidelines ask for ("Saving…", "Issuing…", "Verifying…", "Resetting…") rather than three periods.

**Finance mutations are idempotent throughout.** `useIdempotencyKey` (`components/coach/financials/financials-client-utils.ts:31-42`) mints a UUID lazily and resets it on success or on input change, and it is threaded through 15 finance call sites plus report publication (`report-workspace.tsx:328`) and announcement publication (`announcement-composer.tsx:65`).

**Error boundaries are complete and well written.** All 46 routes are covered; four segment-level boundaries give area-appropriate copy and return destinations; `app/global-error.tsx:8-13` even inlines a font fallback because the root layout has not rendered behind it. `RouteErrorState` offers both a `router.refresh()` retry and a labelled way out (`components/route-recovery.tsx:71-74`).

**Stale-tab protection is real and tested.** `tests/e2e/attendance-workspaces.spec.ts:195-238` proves that a second tab holding stale attendance cannot overwrite a newer save, and that the stale tab is told why.

---

## 5. Suggested PRs

Independent and parallelisable unless a dependency is stated. File overlaps between my own PRs are flagged explicitly.

### PR-1 — Explain network failures on every mutating surface
- **Findings:** ST-3
- **Scope:** replace the `error instanceof Error ? error.message` pattern at 31 catch sites with `describeSaveFailure`, and surface `offerRetry` as a retry affordance the way the attendance recorder already does.
- **Files:** `player-ledger.tsx` (10), `player-onboarding-register.tsx` (5), `session-schedules.tsx` (3), `session-calendar.tsx` (2), `attendance-adjustments-workspace.tsx` (2), `financials-rapid-desk.tsx` (2), `member-directory.tsx` (2), `report-workspace.tsx` (2), `session-create.tsx` (1), `financials-activation.tsx` (1), `prepare-fees.tsx` (1), `admin-authenticator-recovery-queue.tsx` (1)
- **Effort:** M · **Risk:** Low — additive; the failure branch is the only path touched
- **Dependencies:** none
- **Overlaps:** `player-onboarding-register.tsx` with PR-2; `report-workspace.tsx` with PR-5. Land PR-1 first in both cases, or expect a small conflict.

### PR-2 — Fix the stranded onboarding reset
- **Findings:** ST-2
- **Scope:** add `try`/`catch`/`finally` to `resetAssignment`; move the `setPreview(null)` / `setConfirmed(false)` clears into the success branch.
- **Files:** `components/coach/onboarding/player-onboarding-register.tsx` (lines 744-760 only)
- **Effort:** S · **Risk:** Low
- **Dependencies:** none
- **Overlaps:** same file as PR-1, different function — trivially resolvable.

### PR-3 — Make authentication forms survive a dropped request
- **Findings:** ST-1
- **Scope:** add a `useResilientActionState` wrapper that catches the action rejection and folds `describeSaveFailure` into the existing `error` field; swap 20 call sites.
- **Files:** new `lib/client/use-resilient-action-state.ts`; `login-form.tsx`, `two-factor-verification-form.tsx`, `two-factor-setup-form.tsx`, `two-factor-reconnect-form.tsx`, `authenticator-recovery-form.tsx`, `pin-setup-form.tsx`, `activation-form.tsx`, `recovery-form.tsx`, `recovery-reset-forms.tsx`, `account-security-workspace.tsx`, `recovery-email-enrollment-form.tsx`, `recovery-email-security-panel.tsx`, `head-coach-setup-form.tsx`
- **Effort:** M · **Risk:** Medium — touches every authentication path. Gate behind `npm run regression:authentication` and `npm run regression:registration`.
- **Dependencies:** none
- **Overlaps:** `two-factor-setup-form.tsx` with PR-4; `account-security-workspace.tsx` with PR-6.

### PR-4 — Let coaches actually save their recovery codes
- **Findings:** UX-1
- **Scope:** add Copy and Download controls to the codes block; gate the verify submit behind an "I have saved these codes" checkbox, reusing the pattern at `financials-activation.tsx:81-93`.
- **Files:** `components/two-factor-setup-form.tsx`, `app/globals.css`
- **Effort:** M · **Risk:** Low — adds a step to enrolment; update any e2e that walks this flow.
- **Dependencies:** none, but lands more cleanly after PR-3 (same file).

### PR-5 — Persist report drafts locally
- **Findings:** ST-4
- **Scope:** a `lib/client/report-draft-storage.ts` modelled on `attendance-draft-storage.ts`, keyed `${playerId}:${month}`, with an announced restore.
- **Files:** new `lib/client/report-draft-storage.ts`; `components/coach/reports/report-workspace.tsx`; new unit test alongside `tests/attendance-draft-persistence.test.tsx`
- **Effort:** M · **Risk:** Low
- **Dependencies:** none
- **Overlaps:** `report-workspace.tsx` with PR-1.

### PR-6 — Confirm and confirm-back the destructive actions that do neither
- **Findings:** ST-6, UX-2, UX-3
- **Scope:** add `window.confirm` plus success/failure notices to both session-revocation paths; add consequences to the registration-rejection prompt; add `formatInr` amounts to the two concession prompts.
- **Files:** `components/account-security-workspace.tsx`, `components/coach/onboarding/player-onboarding-register.tsx`, `components/coach/financials/player-ledger.tsx`
- **Effort:** S · **Risk:** Low
- **Dependencies:** none
- **Overlaps:** all three files appear in PR-1/PR-2/PR-3. Sequence this **last** among the copy PRs, or split the `account-security-workspace.tsx` hunk out.

### PR-7 — Add the five missing loading states
- **Findings:** ST-5
- **Scope:** four `loading.tsx` files using `RouteLoadingState`; `/recover/reset` inherits from `app/recover/`.
- **Files:** new `app/login/loading.tsx`, `app/register/loading.tsx`, `app/recover/loading.tsx`, `app/activate/loading.tsx`
- **Effort:** S · **Risk:** Low — new files only, no existing file touched
- **Dependencies:** none · **Overlaps:** none. Best first merge.

### PR-8 — Extend the unsaved-work guard beyond the coach workspace
- **Findings:** ST-7
- **Scope:** mount `UnsavedWorkProvider` over the auth/account/setup subtrees; register guards on the 2FA setup, head-coach setup and PIN forms.
- **Files:** `app/layout.tsx` **or** new `app/auth/layout.tsx` + `app/account/layout.tsx` + `app/setup/layout.tsx`; `components/two-factor-setup-form.tsx`, `components/head-coach-setup-form.tsx`, `components/pin-setup-form.tsx`
- **Effort:** S · **Risk:** Medium — the provider attaches global `click`, `submit`, `popstate` and `beforeunload` listeners (`unsaved-work-guard.tsx:284-287`); widening its scope widens their reach. Exercise `tests/e2e/authentication-responsive.spec.ts`.
- **Dependencies:** PR-4 defines what "dirty" means on the 2FA screen, so land PR-4 first.
- **Overlaps:** `two-factor-setup-form.tsx` with PR-3 and PR-4.

### PR-9 — Reconcile restored attendance drafts against saved records
- **Findings:** ST-8
- **Scope:** filter the restored draft against server records before adopting it; suppress the notice when nothing survives.
- **Files:** `components/coach/attendance/player-attendance-recorder.tsx`, `components/coach/attendance/staff-roll-call.tsx`, `tests/attendance-draft-persistence.test.tsx`
- **Effort:** S · **Risk:** Low — but this is the highest-stakes component in the product; extend the existing unit tests rather than relying on manual checks.
- **Dependencies:** none · **Overlaps:** none.

### PR-10 — First-run and terminology copy
- **Findings:** UX-4, UX-5, UX-6
- **Scope:** branch the Attendance card on `scheduleCount === 0`; disambiguate the two "Attendance register" labels; settle "Fee Plan" casing across ~20 strings.
- **Files:** `components/coach/attendance-card.tsx`, `components/coach/financials/player-ledger.tsx`, `components/coach/onboarding/player-onboarding-register.tsx`, `components/coach/player-onboarding-card.tsx`, `components/coach/members/member-directory.tsx`, `app/coach/financials/actions.ts`
- **Effort:** S · **Risk:** Low — but string changes break Playwright locators; grep `tests/e2e/` for each string first.
- **Dependencies:** none
- **Overlaps:** `player-ledger.tsx` and `player-onboarding-register.tsx` with PR-1/PR-2/PR-6. Land last.

### PR-11 — Offline awareness (the cheap 20%)
- **Findings:** UX-8
- **Scope:** an `online`/`offline` listener driving a persistent banner in `CoachShell`, so a coach knows before they mark thirty players. Explicitly **not** a service worker; treat full offline capability as a separate product decision.
- **Files:** new `components/offline-banner.tsx`; `components/coach/coach-shell.tsx`; `app/globals.css`
- **Effort:** S · **Risk:** Low — `navigator.onLine` reports interface presence, not reachability, so word the banner as a hint rather than a verdict, matching the reasoning already written at `lib/client/network-failure.ts:61-64`.
- **Dependencies:** none · **Overlaps:** `coach-shell.tsx` with PR-7 of UX-7 if that is ever taken up.

---

## 6. Notes on the UX rules database

Four queries run against `/Users/nitishg/.codex/skills/ui-ux-pro-max/scripts/search.py --domain ux`. Reporting these honestly, since two of them were not useful:

- `"empty state first run onboarding guidance"` → returned **Feedback / Empty States** (*Do: show helpful message and action · Don't: blank empty screens*, Severity Medium). Cited in UX-4.
- `"error message recovery offline network failure"` → returned **Feedback / Error Recovery** (*Do: provide clear next steps · Don't: error without recovery path*, Severity Medium). Consistent with ST-1 and ST-3.
- `"destructive action confirmation undo"` → returned **Interaction / Confirmation Dialogs** (Severity High) and **Feedback / Confirmation Messages** (*Don't: silent success*, Severity Medium). Both cited in ST-6.
- `"unsaved changes data loss autosave draft"` → **returned nothing relevant.** The two hits were "Bulk Actions" and "Auto-Play Video". The data-loss findings (ST-4, ST-7, UX-1) therefore rest on the Vercel guidelines' Forms rule ("Warn before navigation with unsaved changes") and on this codebase's own stated reasoning in `lib/client/attendance-draft-storage.ts:5-10`, not on the rules database.
