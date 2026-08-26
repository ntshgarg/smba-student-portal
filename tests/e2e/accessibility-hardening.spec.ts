import type { Locator, Page } from "@playwright/test"

// Not "@playwright/test": the harness stages the masked failure evidence the
// browser job uploads. See playwright.responsive-overflow.config.ts.
import { expect, test } from "./support/failure-evidence"

const COACH_ACADEMY_ID = "SMBA-HC-0001"
const PLAYER_ACADEMY_ID = process.env.SMBA_CAPTURE_PLAYER_ACADEMY_ID ?? "SMBA-PL-0001"
const FIXTURE_PASSWORD = process.env.SMBA_FIXTURE_PASSWORD ?? "SMBA fixture access 2026!"

async function loginAsCoach(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByLabel("Academy ID").fill(COACH_ACADEMY_ID)
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/coach"), {
    timeout: 20_000,
  })
}

async function loginAsPlayer(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByLabel("Academy ID").fill(PLAYER_ACADEMY_ID)
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => url.pathname.startsWith("/player"), {
    timeout: 20_000,
  })
}

async function expectMobileSafeFont(control: Locator) {
  await expect(control).toBeVisible()
  const fontSize = await control.evaluate((element) => (
    Number.parseFloat(window.getComputedStyle(element).fontSize)
  ))
  expect(fontSize).toBeGreaterThanOrEqual(16)
}

test("authentication failures restore focus to the invalid field", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  const academyId = page.getByLabel("Academy ID")

  await academyId.fill("invalid")
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.locator("#academy-id-error")).toBeVisible()
  await expect(academyId).toHaveAttribute("aria-describedby", "academy-id-error")
  await expect(academyId).toHaveAttribute("aria-invalid", "true")
  await expect(academyId).toBeFocused()

  await page.getByRole("button", { name: "Continue" }).click()
  await expect(academyId).toBeFocused()

  await page.goto("/register", { waitUntil: "domcontentloaded" })
  const fullName = page.getByLabel("Full name")

  await page.getByRole("button", { name: "Request registration" }).click()
  await expect(page.locator("#full-name-error")).toBeVisible()
  await expect(fullName).toHaveAttribute("aria-describedby", "full-name-error")
  await expect(fullName).toHaveAttribute("aria-invalid", "true")
  await expect(fullName).toBeFocused()

  await page.getByRole("button", { name: "Request registration" }).click()
  await expect(fullName).toBeFocused()
})

test("operational controls remain zoom-safe and today controls are comfortably tappable", async ({ page }) => {
  await loginAsCoach(page)
  await page.setViewportSize({ height: 568, width: 320 })

  await page.goto("/coach/members", { waitUntil: "domcontentloaded" })
  await expectMobileSafeFont(page.getByPlaceholder("Search members"))
  await page.getByRole("button", { name: /Filters/u }).click()
  for (const filter of ["Level", "Status", "Batch"]) {
    await expectMobileSafeFont(page.getByLabel(filter))
  }

  await page.goto("/coach/schedules/new", { waitUntil: "domcontentloaded" })
  const scheduleControls = page.locator([
    '.coach-series-form input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])',
    ".coach-series-form select",
  ].join(", "))
  expect(await scheduleControls.count()).toBeGreaterThan(0)
  for (let index = 0; index < await scheduleControls.count(); index += 1) {
    await expectMobileSafeFont(scheduleControls.nth(index))
  }

  for (const route of [
    "/coach/attendance/players/register",
    "/coach/attendance/staff/register",
  ]) {
    await page.goto(route, { waitUntil: "domcontentloaded" })
    const jumpToToday = page.getByRole("button", { name: "Jump to today" })
    await expect(jumpToToday).toBeVisible()
    const bounds = await jumpToToday.boundingBox()
    expect(bounds?.height).toBeGreaterThanOrEqual(44)
  }
})

/**
 * The day the coach's calendar is already showing, taken from the app rather
 * than from the runner. `/coach/calendar` with no date redirects to
 * `?date=${getIndiaDateKey(academyNow())}` (app/coach/calendar/page.tsx:20-25),
 * so this reads back the server's own idea of today -- which is the clock that
 * decides whether a session is upcoming, and which is not necessarily the
 * runner's once anything pins it.
 */
async function academyTodayFromCalendar(page: Page) {
  await page.goto("/coach/calendar", { waitUntil: "domcontentloaded" })
  await page.waitForURL(/\/coach\/calendar\?date=\d{4}-\d{2}-\d{2}$/u, { timeout: 20_000 })
  return new URL(page.url()).searchParams.get("date") ?? ""
}

/** The next date key, in UTC so no runner time zone can move it by a day. */
function nextDateKey(dateKey: string) {
  const next = new Date(`${dateKey}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

/*
 * Un-quarantined from G-27, and neither half of the repair is the one the
 * quarantine note predicted.
 *
 * The date is the half it did predict. The case opened
 * /coach/calendar?date=2026-08-10 for a control session-calendar.tsx:544 renders
 * only while occurrenceIsUpcoming() holds against the instant
 * app/coach/calendar/page.tsx:20 takes from academyNow(), so once the wall clock
 * passed that day the summary was not in the DOM to click. It now asks the app
 * which day it is and opens the day after, because the stress fixture schedules
 * 3 to 9 sessions on every one of the 92 dates from 2026-07-01 to 2026-09-30
 * (scripts/regression/profiles.ts:11-12) and the earliest of them starts at
 * 06:00 IST -- so every session on tomorrow's card is still upcoming from any
 * instant inside today, whatever the hour. That buys until 2026-09-30, exactly
 * as the note said moving the constant would: past the fixture's last occurrence
 * nothing anywhere in it is upcoming and no locator can find a control the
 * server does not render. What deriving adds is that the case stops failing on
 * dates *inside* the window, and that when the window does end it fails on an
 * explicit count with the reason attached instead of timing out on a click.
 *
 * The half it did not predict is that a duration of 15 could never have reached
 * the Server Action from a browser at all. That input is `type="number" min={30}
 * max={300} step={15}` (session-calendar.tsx:553) on a form carrying no
 * `noValidate`, so 15 fails interactive validation, the submit event never fires
 * and `window.confirm` is never reached -- and every value the browser does let
 * through is one lib/sessions/service.ts:927-933 accepts too, which leaves
 * "Choose a valid session duration." unreachable through this form. The case now
 * submits 22:00 for 300 minutes: both satisfy the DOM's own constraints, and the
 * rule they break is one only the server holds -- service.ts:949-955, a
 * replacement may not cross midnight -- reported against the same field, with the
 * same aria-invalid, aria-describedby and focus contract the case was written for.
 *
 * 22:00 and not the 19:00 this first carried, because 19:00 plus 300 is 1440 to
 * the minute and service.ts:949 reads `>= 24 * 60`. A session that ends exactly
 * at midnight arguably does not cross it, so that comparison is a plausible thing
 * for someone to correct to `>` -- and on the day they do, a case pinned to the
 * boundary stops asserting a rejection and starts performing a write: it would
 * cancel a fixture occurrence and insert a replacement into the same
 * /tmp/smba-ci-stress.db that phase8-followup.spec.ts measures route payloads
 * against two CI steps later. 22:00 plus 300 is 1620, satisfies min/max/step
 * identically, and is 180 minutes clear of the comparison either way it is
 * written. The card count below is a backstop, not a guard: it can only report a
 * write that has already landed.
 */
test("replacement validation stays inline in the production Server Action path", async ({ page }) => {
  const serverFailures: string[] = []
  const consoleErrors: string[] = []
  page.on("response", (response) => {
    if (response.request().method() === "POST" && response.status() >= 500) {
      serverFailures.push(`${response.status()} ${response.url()}`)
    }
  })
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await loginAsCoach(page)
  const upcomingDate = nextDateKey(await academyTodayFromCalendar(page))
  await page.goto(`/coach/calendar?date=${upcomingDate}`, { waitUntil: "domcontentloaded" })

  const daySessions = page.locator('.coach-day-session > button[aria-expanded="false"]')
  await expect(
    daySessions,
    `${upcomingDate} carries no session card. The stress fixture schedules`
    + " 2026-07-01 to 2026-09-30 and nothing in it is upcoming after that,"
    + " so this case cannot pass until the fixture window moves.",
  ).not.toHaveCount(0)
  await daySessions.first().click()

  const detail = page.locator(".coach-occurrence-detail")
  await expect(detail).toBeVisible()
  await detail.locator("summary", { hasText: "Replace session" }).click()

  // Counted before the submit and checked after it, because this case now reaches
  // the Server Action for real against the shared stress workspace that
  // phase8-followup.spec.ts measures next. A rule change that made 22:00 for 300
  // minutes acceptable would cancel this occurrence and add its replacement to the
  // same day -- one card more here, and a route payload budget two steps later
  // failing for a reason nothing in that suite could explain.
  const dayCards = page.locator(".coach-day-session")
  const dayCardCount = await dayCards.count()

  const duration = detail.getByLabel("Duration")
  await detail.getByLabel("Time").fill("22:00")
  await duration.fill("300")
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Create replacement" }).click()

  const error = page.getByText("A replacement session cannot cross midnight", { exact: true })
  await expect(error).toBeVisible()
  await expect(duration).toHaveAttribute("aria-invalid", "true")
  await expect(duration).toHaveAttribute("aria-describedby", /occurrence-feedback-/u)
  await expect(duration).toBeFocused()
  await expect(
    dayCards,
    "A rejected replacement must leave the day's register exactly as it found it.",
  ).toHaveCount(dayCardCount)
  expect(serverFailures).toEqual([])
  expect(consoleErrors.filter((message) => /500|server components render|digest/u.test(message)))
    .toEqual([])
})

/*
 * Un-quarantined from G-27, with a second wrong number found beside the recorded
 * one.
 *
 * The recorded one: the last step searched "SMBA#" and expected the window to
 * fall back to twelve rows. d9d8dbf moved every approved account onto a
 * role-prefixed Academy ID -- SMBA-HC-0001, SMBA-JC-000N, SMBA-PL-NNNN -- and
 * scripts/regression/fixture.ts:2176-2190 fails the fixture build if any
 * approved ID departs from that sequence, so nothing in a member's ID, name or
 * primary contact contains "SMBA#": the search matched nobody, the directory
 * rendered .coach-member-empty-state in place of .coach-member-table and the row
 * count was 0. "SMBA-PL-" is the term that carries the original intent, because
 * it still matches every player in the register and so proves the window reset
 * rather than a filter that happened to leave twelve behind.
 *
 * The second: the register holds 99 members, not 100, and always has. The stress
 * profile approves 100 players (profiles.ts:80) and archives one of them
 * (profiles.ts:122), fixture.ts:2254-2269 fails the build unless exactly one is
 * archived, and lib/coach/database.ts:204-208 excludes archived accounts from
 * the directory. So the summary reads "Showing 12 of 99 members" and the case
 * failed on its second assertion -- three steps before it ever reached the
 * search term the quarantine note was about. Naming 99 rather than reading the
 * total back off the heading is deliberate: if archived members ever reach the
 * directory this is the assertion that says so.
 */
test("Member Directory reveals results in one-way groups of twelve", async ({ page }) => {
  await loginAsCoach(page)
  await page.setViewportSize({ height: 844, width: 390 })
  await page.goto("/coach/members", { waitUntil: "domcontentloaded" })

  const rows = page.locator(".coach-member-table tbody > tr")
  await expect(rows).toHaveCount(12)
  await expect(page.getByRole("heading", { name: "Showing 12 of 99 members" })).toBeVisible()

  await page.getByRole("button", { name: "Show more members" }).click()
  await expect(rows).toHaveCount(24)
  await expect(page.getByRole("heading", { name: "Showing 24 of 99 members" })).toBeVisible()

  await page.getByPlaceholder("Search members").fill("SMBA-PL-")
  await expect(rows).toHaveCount(12)
  await expect(page.getByRole("heading", { name: "Showing 12 of 99 members" })).toBeVisible()
})

test("Member Directory filters restore from the URL and browser history", async ({ page }) => {
  await loginAsCoach(page)
  await page.goto("/coach/members?level=Intermediate&batch=Weekend&status=active", {
    waitUntil: "networkidle",
  })

  await page.getByRole("button", { name: /Filters/u }).click()
  await expect(page.getByLabel("Level")).toHaveValue("Intermediate")
  await expect(page.getByLabel("Batch")).toHaveValue("Weekend")
  await expect(page.getByLabel("Status")).toHaveValue("active")

  await page.getByLabel("Level").selectOption("Advanced")
  await expect(page).toHaveURL((url) => url.searchParams.get("level") === "Advanced")
  await page.getByLabel("Batch").selectOption("Weekday")
  await expect(page).toHaveURL((url) => url.searchParams.get("batch") === "Weekday")

  await page.goBack()
  await expect(page.getByLabel("Level")).toHaveValue("Advanced")
  await expect(page.getByLabel("Batch")).toHaveValue("Weekend")

  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: /Filters/u }).click()
  await expect(page.getByLabel("Level")).toHaveValue("Advanced")
  await expect(page.getByLabel("Batch")).toHaveValue("Weekend")
})

/*
 * Un-quarantined from G-27, and the only one of the five that was passing on the
 * day it was quarantined. player-attendance-card.tsx opens on the month of
 * record.referenceDate, which lib/attendance/player-record.ts:23-33 derives from
 * academyNow(), so the previous-month control read "View July 2026" only while
 * the wall clock was inside August 2026; from 1 September it reads "View August
 * 2026" and the click waited out the whole 120s timeout for a calendar reason on
 * a change that touched nothing.
 *
 * It now reads the label the control is offering and asserts the state that
 * label should produce, so nothing here names a month. Only two things are
 * derived, because only two are ambiguous: which month the control is offering,
 * and which year the selector's first button holds. Everything the register is
 * actually being tested for -- that ?month= is the two-digit index of the month
 * the control named, that the heading follows it, that a reload and a Back
 * restore both -- is asserted exactly as before. MONTH_LABELS is the one piece of
 * the register the spec still has to hold a copy of, since a rendered label
 * cannot say which number it should serialise to.
 */
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const

function monthParamFor(monthLabel: string) {
  const index = MONTH_LABELS.findIndex((label) => label === monthLabel)
  expect(index, `${monthLabel} is not one of the register's month labels`)
    .toBeGreaterThanOrEqual(0)
  return String(index + 1).padStart(2, "0")
}

test("Player attendance month and year restore through refresh and Back", async ({ page }) => {
  await loginAsPlayer(page)
  await page.goto("/player", { waitUntil: "networkidle" })

  const toggle = page.getByRole("button", { name: "Open attendance record" })
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(page).toHaveURL((url) => url.searchParams.get("attendance") === "register")
  const calendar = page.getByRole("grid", { name: /Your attendance calendar/u })
  await expect(calendar.getByRole("columnheader")).toHaveCount(7)
  await expect(calendar.getByRole("gridcell")).toHaveCount(42)

  // The disabled spelling of this control is "No previous attendance month
  // available", so a shape check here is what separates "the register moved on a
  // month" from "the register has no previous month to offer".
  const previousMonth = page.locator(".player-attendance-month-nav.is-previous")
  await expect(previousMonth).toHaveAttribute("aria-label", /^View [A-Za-z]+ \d{4}$/u)
  const previousMonthLabel = ((await previousMonth.getAttribute("aria-label")) ?? "")
    .replace(/^View /u, "")
  const [previousMonthName] = previousMonthLabel.split(" ")
  const previousMonthParam = monthParamFor(previousMonthName)

  await previousMonth.click()
  await expect(page).toHaveURL((url) => url.searchParams.get("month") === previousMonthParam)
  await expect(page.locator(".player-attendance-month-current > strong"))
    .toHaveText(previousMonthLabel)

  const yearButtons = page.locator(".player-attendance-year-selector button")
  expect(await yearButtons.count()).toBeGreaterThan(1)
  const alternateYear = yearButtons.first()
  const alternateYearLabel = (await alternateYear.textContent())?.trim() ?? ""
  await alternateYear.click()
  await expect(page).toHaveURL((url) => url.searchParams.get("year") === alternateYearLabel)

  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.getByRole("button", { name: "Close attendance record" })).toBeVisible()
  await expect(page.locator(".player-attendance-year-selector button", {
    hasText: alternateYearLabel,
  })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".player-attendance-month-current > strong"))
    .toHaveText(`${previousMonthName} ${alternateYearLabel}`)

  await page.getByRole("button", { name: "Close attendance record" }).click()
  await expect(page).toHaveURL((url) => !url.searchParams.has("attendance"))
  await page.goBack()
  await expect(page.getByRole("button", { name: "Close attendance record" })).toBeVisible()
  await expect(page).toHaveURL((url) => (
    url.searchParams.get("attendance") === "register"
    && url.searchParams.get("year") === alternateYearLabel
    && url.searchParams.get("month") === previousMonthParam
  ))

  await page.getByRole("button", { name: "Jump to today" }).click()
  await expect(page).toHaveURL((url) => (
    !url.searchParams.has("year") && !url.searchParams.has("month")
  ))
})
