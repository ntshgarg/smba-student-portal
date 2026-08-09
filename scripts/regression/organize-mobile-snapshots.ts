import { copyFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

type BatchItem = readonly [collection: string, fileName: string, label: string]
type Batch = {
  items: BatchItem[]
  slug: string
  title: string
}

const snapshotRoot = path.resolve(
  process.cwd(),
  process.env.SMBA_SNAPSHOT_ROOT ?? "snapshots/mobile-complete-2026-08-03",
)
const outputRoot = path.join(snapshotRoot, "workflow-batches")

const item = (collection: string, fileName: string, label: string): BatchItem => (
  [collection, fileName, label]
)

const batches: Batch[] = [
  {
    slug: "01-public-website",
    title: "Public website",
    items: [
      item("public-auth-final", "public-home-default-mobile-390-viewport.png", "Homepage hero at 390 px"),
      item("public-auth-final", "public-home-default-mobile-320-viewport.png", "Homepage hero at 320 px"),
      item("public-auth-final", "public-home-default-mobile-390-full.png", "Complete homepage scroll"),
      item("public-auth-final", "public-home-mobile-menu-mobile-320-viewport.png", "Mobile navigation at 320 px"),
      item("public-auth-final", "public-home-mobile-menu-mobile-390-viewport.png", "Mobile navigation at 390 px"),
      item("public-auth-final", "public-home-academy-anchor-mobile-390-viewport.png", "Academy anchor landing"),
      item("public-auth-final", "public-home-programs-anchor-mobile-390-viewport.png", "Programs anchor landing"),
      item("public-auth-final", "public-home-why-anchor-mobile-390-viewport.png", "Why SMBA anchor landing"),
      item("public-auth-final", "public-fee-weekday-standard-mobile-390-viewport.png", "Weekday Intermediate four-day fee"),
      item("public-auth-final", "public-fee-weekday-advanced-mobile-390-viewport.png", "Weekday Advanced fee"),
      item("public-auth-final", "public-fee-weekend-mobile-390-viewport.png", "Weekend Adult fee"),
      item("public-auth-final", "public-home-trial-anchor-mobile-390-viewport.png", "Free-trial section landing"),
      item("public-auth-final", "public-trial-form-filled-mobile-390-viewport.png", "Completed free-trial form"),
      item("focused-interactions", "public-trial-popup-blocked-mobile-390-viewport.png", "WhatsApp popup fallback"),
      item("public-auth-final", "public-home-contact-anchor-mobile-390-viewport.png", "Contact and Community landing"),
    ],
  },
  {
    slug: "02-authentication",
    title: "Authentication and registration",
    items: [
      item("public-auth-final", "login-default-mobile-320-viewport.png", "Login at 320 px"),
      item("public-auth-final", "login-default-mobile-360-viewport.png", "Login at 360 px"),
      item("public-auth-final", "login-default-mobile-390-viewport.png", "Login at 390 px"),
      item("public-auth-final", "login-default-mobile-430-viewport.png", "Login at 430 px"),
      item("public-auth-final", "login-default-mobile-320-full.png", "Complete login at 320 px"),
      item("public-auth-final", "login-default-mobile-390-full.png", "Complete login at 390 px"),
      item("public-auth-final", "login-format-error-mobile-390-viewport.png", "Academy ID format error"),
      item("public-auth-final", "login-account-not-found-mobile-390-viewport.png", "Academy ID not found"),
      item("public-auth-final", "register-default-mobile-320-viewport.png", "Registration at 320 px"),
      item("public-auth-final", "register-default-mobile-360-viewport.png", "Registration at 360 px"),
      item("public-auth-final", "register-default-mobile-390-viewport.png", "Registration at 390 px"),
      item("public-auth-final", "register-default-mobile-430-viewport.png", "Registration at 430 px"),
      item("public-auth-final", "register-default-mobile-390-full.png", "Complete registration page"),
      item("public-auth-final", "register-coach-selected-mobile-390-viewport.png", "Coach role selected"),
      item("public-auth-final", "register-validation-error-mobile-390-viewport.png", "Registration validation error"),
    ],
  },
  {
    slug: "03-player-journal",
    title: "Player Journal",
    items: [
      item("player-final", "player-dashboard-default-mobile-390-viewport.png", "Player welcome hero"),
      item("player-final", "player-dashboard-training-week-mobile-390-viewport.png", "Training-week cards"),
      item("player-final", "player-dashboard-default-mobile-390-full.png", "Complete Player Journal"),
      item("player-final", "player-dashboard-default-mobile-320-viewport.png", "Player hero at 320 px"),
      item("player-final", "player-dashboard-default-mobile-320-full.png", "Complete journal at 320 px"),
      item("player-final", "player-dashboard-default-mobile-360-viewport.png", "Player hero at 360 px"),
      item("player-final", "player-dashboard-default-mobile-360-full.png", "Complete journal at 360 px"),
      item("player-final", "player-dashboard-default-mobile-430-viewport.png", "Player hero at 430 px"),
      item("player-final", "player-dashboard-default-mobile-430-full.png", "Complete journal at 430 px"),
      item("player-long-name", "player-dashboard-default-mobile-320-viewport.png", "Long player name at 320 px"),
      item("player-long-name", "player-dashboard-default-mobile-390-viewport.png", "Long player name at 390 px"),
      item("player-long-name", "player-dashboard-default-mobile-430-viewport.png", "Long player name at 430 px"),
      item("player-long-name", "player-dashboard-default-mobile-390-full.png", "Complete long-name journal"),
      item("player-no-report", "player-dashboard-default-mobile-390-viewport.png", "Player without a published report"),
      item("player-no-report", "player-dashboard-default-mobile-390-full.png", "Complete no-report journal"),
    ],
  },
  {
    slug: "04-coach-dashboard",
    title: "Coach Dashboard and navigation",
    items: [
      item("coach-final", "coach-dashboard-default-mobile-390-viewport.png", "Coach morning briefing"),
      item("coach-final", "coach-dashboard-default-mobile-390-full.png", "Complete Coach Workspace"),
      item("coach-final", "coach-dashboard-account-menu-mobile-390-viewport.png", "Coach account menu"),
      item("coach-final", "coach-dashboard-account-menu-mobile-390-full.png", "Complete dashboard with account menu"),
      item("coach-final", "public-home-coach-account-menu-mobile-390-viewport.png", "Coach account on public homepage"),
      item("coach-final", "coach-calendar-day-mobile-390-viewport.png", "Calendar entry destination"),
      item("coach-final", "coach-attendance-open-mobile-390-viewport.png", "Attendance entry destination"),
      item("coach-final", "coach-attendance-record-mobile-390-viewport.png", "Record player attendance"),
      item("coach-final", "coach-staff-roll-call-mobile-390-viewport.png", "Staff roll call"),
      item("coach-final", "coach-attendance-adjustments-mobile-390-viewport.png", "Attendance Adjustments destination"),
      item("coach-final", "coach-schedules-default-mobile-390-viewport.png", "Schedules destination"),
      item("coach-final", "coach-members-default-mobile-390-viewport.png", "Members destination"),
      item("coach-final", "coach-reports-default-mobile-390-viewport.png", "Reports destination"),
      item("coach-final", "coach-calendar-month-mobile-390-viewport.png", "Calendar month navigator"),
      item("coach-final", "coach-schedules-collapsed-mobile-390-viewport.png", "Compact schedules overview"),
      item("coach-final", "coach-member-filters-open-mobile-390-viewport.png", "Member directory tools"),
      item("coach-final", "coach-report-editor-mobile-390-viewport.png", "Selected-player report editor"),
    ],
  },
  {
    slug: "05-calendar-and-attendance",
    title: "Calendar and attendance",
    items: [
      item("coach-final", "coach-calendar-day-mobile-390-viewport.png", "Day View landing"),
      item("coach-final", "coach-calendar-day-mobile-390-full.png", "Complete day schedule"),
      item("coach-final", "coach-calendar-month-mobile-390-viewport.png", "Month grid"),
      item("coach-final", "coach-calendar-month-mobile-390-full.png", "Complete month workflow"),
      item("coach-final", "coach-calendar-empty-day-mobile-390-viewport.png", "Empty selected day"),
      item("coach-final", "coach-calendar-empty-day-mobile-390-full.png", "Complete empty-day state"),
      item("coach-final", "coach-calendar-session-open-mobile-390-viewport.png", "Session roster expanded"),
      item("coach-final", "coach-calendar-session-open-mobile-390-full.png", "Complete expanded session"),
      item("focused-interactions", "coach-calendar-replacement-open-mobile-390-viewport.png", "Replacement-session form"),
      item("coach-final", "coach-calendar-session-open-mobile-320-viewport.png", "Expanded session at 320 px"),
      item("coach-final", "coach-calendar-session-open-mobile-430-viewport.png", "Expanded session at 430 px"),
      item("coach-final", "coach-attendance-open-mobile-390-viewport.png", "Attendance register open"),
      item("coach-final", "coach-attendance-open-mobile-390-full.png", "Complete attendance register"),
      item("coach-final", "coach-attendance-weekend-adult-mobile-390-viewport.png", "Weekend Adult register"),
      item("coach-final", "coach-attendance-year-start-mobile-390-viewport.png", "Year-start register position"),
      item("coach-final", "coach-attendance-year-start-mobile-390-full.png", "Complete year-start register"),
      item("coach-final", "coach-attendance-open-mobile-320-viewport.png", "Attendance at 320 px"),
      item("coach-final", "coach-attendance-open-mobile-430-viewport.png", "Attendance at 430 px"),
      item("coach-final", "coach-attendance-record-mobile-390-viewport.png", "Player recorder before session selection"),
      item("coach-final", "coach-attendance-record-session-mobile-390-viewport.png", "Selected player session roster"),
      item("coach-final", "coach-staff-attendance-register-mobile-390-viewport.png", "Staff attendance register"),
      item("coach-final", "coach-staff-roll-call-mobile-390-viewport.png", "Staff roll call"),
    ],
  },
  {
    slug: "06-schedules",
    title: "Schedules and rosters",
    items: [
      item("coach-final", "coach-schedules-default-mobile-390-viewport.png", "Schedules landing"),
      item("coach-final", "coach-schedules-default-mobile-390-full.png", "Complete schedules catalogue"),
      item("coach-final", "coach-schedules-collapsed-mobile-390-viewport.png", "Programme groups collapsed"),
      item("coach-final", "coach-schedules-collapsed-mobile-390-full.png", "Complete collapsed overview"),
      item("coach-final", "coach-schedule-create-mobile-390-viewport.png", "New weekday schedule form"),
      item("coach-final", "coach-schedule-create-mobile-390-full.png", "Complete schedule-creation workflow"),
      item("coach-final", "coach-schedule-create-weekend-mobile-390-viewport.png", "Weekend schedule selections"),
      item("coach-final", "coach-schedule-roster-open-mobile-390-viewport.png", "Schedule roster expanded"),
      item("coach-final", "coach-schedule-roster-open-mobile-390-full.png", "Complete expanded roster"),
      item("focused-interactions", "coach-schedule-roster-player-selected-mobile-390-viewport.png", "Eligible player and training days"),
      item("coach-final", "coach-schedule-roster-open-mobile-320-viewport.png", "Roster at 320 px"),
      item("coach-final", "coach-schedule-roster-open-mobile-320-full.png", "Complete roster at 320 px"),
      item("focused-interactions", "coach-schedule-roster-player-selected-mobile-320-viewport.png", "Assignment controls at 320 px"),
      item("coach-final", "coach-schedule-roster-open-mobile-360-viewport.png", "Roster at 360 px"),
      item("focused-interactions", "coach-schedule-roster-player-selected-mobile-360-viewport.png", "Assignment controls at 360 px"),
      item("coach-final", "coach-schedule-roster-open-mobile-430-viewport.png", "Roster at 430 px"),
      item("coach-final", "coach-schedule-roster-open-mobile-430-full.png", "Complete roster at 430 px"),
      item("focused-interactions", "coach-schedule-roster-player-selected-mobile-430-viewport.png", "Assignment controls at 430 px"),
    ],
  },
  {
    slug: "07-members",
    title: "Members",
    items: [
      item("coach-final", "coach-members-default-mobile-390-segment-001-y00000.png", "Directory introduction"),
      item("coach-final", "coach-members-default-mobile-390-segment-002-y00692.png", "Beginning of member list"),
      item("coach-final", "coach-members-default-mobile-390-segment-025-y16556.png", "End of member list"),
      item("coach-final", "coach-member-filters-open-mobile-390-viewport.png", "Filters expanded"),
      item("coach-final", "coach-member-filter-applied-mobile-390-viewport.png", "Filters applied"),
      item("coach-final", "coach-member-details-open-mobile-390-segment-002-y00692.png", "Expanded member profile"),
      item("coach-final", "coach-member-details-open-mobile-390-segment-003-y01384.png", "Expanded training details"),
      item("coach-final", "coach-member-contact-revealed-mobile-390-viewport.png", "Primary contact revealed"),
      item("coach-final", "coach-member-edit-form-mobile-390-viewport.png", "Member edit form"),
      item("coach-final", "coach-members-default-mobile-320-viewport.png", "Directory at 320 px"),
      item("coach-final", "coach-members-default-mobile-430-viewport.png", "Directory at 430 px"),
      item("coach-final", "coach-member-details-open-mobile-320-segment-002-y00465.png", "Member details at 320 px"),
      item("coach-final", "coach-member-details-open-mobile-430-segment-002-y00764.png", "Member details at 430 px"),
      item("coach-final", "coach-member-edit-form-mobile-320-viewport.png", "Edit form at 320 px"),
      item("coach-final", "coach-member-edit-form-mobile-430-viewport.png", "Edit form at 430 px"),
    ],
  },
  {
    slug: "08-reports",
    title: "Reports",
    items: [
      item("coach-final", "coach-reports-default-mobile-390-viewport.png", "Coach reports overview"),
      item("coach-final", "coach-reports-default-mobile-390-full.png", "Complete coach reports page"),
      item("coach-final", "coach-report-editor-mobile-390-viewport.png", "Coach report editor"),
      item("coach-final", "coach-report-editor-mobile-390-full.png", "Complete report editor"),
      item("coach-final", "coach-report-editor-mobile-320-viewport.png", "Editor at 320 px"),
      item("coach-final", "coach-report-editor-mobile-360-viewport.png", "Editor at 360 px"),
      item("coach-final", "coach-report-editor-mobile-430-viewport.png", "Editor at 430 px"),
      item("coach-final", "coach-report-preview-mobile-390-viewport.png", "Report preview dialog"),
      item("coach-final", "coach-report-preview-mobile-320-viewport.png", "Preview at 320 px"),
      item("coach-final", "coach-report-preview-mobile-360-viewport.png", "Preview at 360 px"),
      item("coach-final", "coach-report-preview-mobile-430-viewport.png", "Preview at 430 px"),
      item("player-final", "player-reports-default-mobile-390-viewport.png", "Player reports archive"),
      item("player-final", "player-reports-default-mobile-390-full.png", "Complete player report archive"),
      item("player-final", "player-report-expanded-mobile-390-viewport.png", "Expanded player report"),
      item("player-final", "player-report-expanded-mobile-320-viewport.png", "Expanded report at 320 px"),
      item("player-final", "player-report-expanded-mobile-360-viewport.png", "Expanded report at 360 px"),
      item("player-final", "player-report-expanded-mobile-430-viewport.png", "Expanded report at 430 px"),
      item("player-no-report", "player-reports-default-mobile-390-viewport.png", "No-report archive state"),
      item("player-no-report", "player-reports-default-mobile-390-full.png", "Complete no-report archive"),
    ],
  },
  {
    slug: "09-attendance-adjustments",
    title: "Attendance Adjustments",
    items: [
      item("coach-final", "coach-attendance-adjustments-mobile-390-viewport.png", "Adjustment workspace before selection"),
      item("coach-final", "coach-attendance-adjustments-mobile-390-full.png", "Complete default adjustment page"),
      item("coach-final", "coach-attendance-adjustment-calendar-mobile-390-viewport.png", "Missed-session calendar"),
      item("coach-final", "coach-attendance-adjustment-calendar-mobile-390-full.png", "Complete calendar and history"),
      item("coach-final", "coach-attendance-adjustment-source-selected-mobile-390-viewport.png", "Missed session selected"),
      item("coach-final", "coach-attendance-adjustments-mobile-320-viewport.png", "Default workspace at 320 px"),
      item("coach-final", "coach-attendance-adjustments-mobile-320-full.png", "Complete default page at 320 px"),
      item("coach-final", "coach-attendance-adjustment-calendar-mobile-320-viewport.png", "Calendar at 320 px"),
      item("coach-final", "coach-attendance-adjustment-calendar-mobile-320-full.png", "Complete calendar at 320 px"),
      item("coach-final", "coach-attendance-adjustment-source-selected-mobile-320-viewport.png", "Source selected at 320 px"),
      item("coach-final", "coach-attendance-adjustments-mobile-360-viewport.png", "Default workspace at 360 px"),
      item("coach-final", "coach-attendance-adjustment-calendar-mobile-360-viewport.png", "Calendar at 360 px"),
      item("coach-final", "coach-attendance-adjustment-source-selected-mobile-360-viewport.png", "Source selected at 360 px"),
      item("coach-final", "coach-attendance-adjustments-mobile-430-viewport.png", "Default workspace at 430 px"),
      item("coach-final", "coach-attendance-adjustments-mobile-430-full.png", "Complete default page at 430 px"),
      item("coach-final", "coach-attendance-adjustment-calendar-mobile-430-viewport.png", "Calendar at 430 px"),
      item("coach-final", "coach-attendance-adjustment-calendar-mobile-430-full.png", "Complete calendar at 430 px"),
      item("coach-final", "coach-attendance-adjustment-source-selected-mobile-430-viewport.png", "Source selected at 430 px"),
    ],
  },
  {
    slug: "10-account-and-edge-cases",
    title: "Account and responsive edge cases",
    items: [
      item("coach-final", "coach-dashboard-default-mobile-390-viewport.png", "Coach dashboard"),
      item("coach-final", "coach-dashboard-default-mobile-390-full.png", "Complete coach dashboard"),
      item("coach-final", "coach-dashboard-account-menu-mobile-390-viewport.png", "Coach account menu"),
      item("coach-final", "coach-dashboard-account-menu-mobile-390-full.png", "Complete coach account state"),
      item("coach-final", "public-home-coach-account-menu-mobile-390-viewport.png", "Coach account on public homepage"),
      item("player-final", "public-home-player-account-menu-mobile-390-viewport.png", "Player account on public homepage"),
      item("player-final", "player-dashboard-account-menu-mobile-320-viewport.png", "Player menu at 320 px"),
      item("player-final", "player-dashboard-account-menu-mobile-360-viewport.png", "Player menu at 360 px"),
      item("player-final", "player-dashboard-account-menu-mobile-390-viewport.png", "Player menu at 390 px"),
      item("player-final", "player-dashboard-account-menu-mobile-430-viewport.png", "Player menu at 430 px"),
      item("player-final", "player-dashboard-account-menu-mobile-390-full.png", "Complete player account state"),
      item("player-long-name", "player-dashboard-account-menu-mobile-320-viewport.png", "Long-name menu at 320 px"),
      item("player-long-name", "player-dashboard-account-menu-mobile-360-viewport.png", "Long-name menu at 360 px"),
      item("player-long-name", "player-dashboard-account-menu-mobile-390-viewport.png", "Long-name menu at 390 px"),
      item("player-long-name", "player-dashboard-account-menu-mobile-430-viewport.png", "Long-name menu at 430 px"),
    ],
  },
]

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function sourcePath(collection: string, fileName: string) {
  return path.join(snapshotRoot, collection, "loaded", "screenshots", fileName)
}

async function main() {
  await mkdir(outputRoot, { recursive: true })
  const manifest: Array<{
    count: number
    items: Array<{ destination: string; label: string; source: string }>
    slug: string
    title: string
  }> = []

  for (const batch of batches) {
    const batchDir = path.join(outputRoot, batch.slug)
    await mkdir(batchDir, { recursive: true })
    const copied: Array<{ destination: string; label: string; source: string }> = []

    for (const [index, [collection, fileName, label]] of batch.items.entries()) {
      const destinationName = `${String(index + 1).padStart(2, "0")}-${slugify(label)}.png`
      const source = sourcePath(collection, fileName)
      const destination = path.join(batchDir, destinationName)
      await copyFile(source, destination)
      copied.push({
        destination: path.relative(outputRoot, destination).split(path.sep).join("/"),
        label,
        source: path.relative(snapshotRoot, source).split(path.sep).join("/"),
      })
    }

    const readme = [
      `# ${batch.title}`,
      "",
      `${copied.length} ordered mobile screenshots.`,
      "",
      ...copied.map((entry, index) => (
        `${index + 1}. [${entry.label}](./${path.basename(entry.destination)})`
      )),
      "",
    ].join("\n")
    await writeFile(path.join(batchDir, "README.md"), readme, "utf8")
    manifest.push({ count: copied.length, items: copied, slug: batch.slug, title: batch.title })
  }

  const total = manifest.reduce((sum, batch) => sum + batch.count, 0)
  const index = [
    "# SMBA mobile workflow review batches",
    "",
    `${total} curated screenshots grouped into ${manifest.length} logical workflows.`,
    "",
    ...manifest.map((batch) => (
      `- [${batch.title}](./${batch.slug}/README.md) — ${batch.count} images`
    )),
    "",
    "The source regression collections remain unchanged in the parent directory.",
    "",
    "There is no standalone Settings route in the current product. The final batch therefore covers account menus, identity states, and responsive edge cases.",
    "",
    "Registration approval is intentionally absent from this read-only catalogue because completing approval changes database state. The Members batch shows approved member records and editing states.",
    "",
  ].join("\n")

  await Promise.all([
    writeFile(path.join(outputRoot, "README.md"), index, "utf8"),
    writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  ])
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
