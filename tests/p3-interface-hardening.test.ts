import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return tsxFiles(entryPath)
    return entry.isFile() && entry.name.endsWith(".tsx") ? [entryPath] : []
  })
}

describe("P3 interface hardening", () => {
  it("hydrates time-sensitive coach views from one server-provided instant", () => {
    const registerPage = source("app/coach/attendance/players/register/page.tsx")
    const recorderPage = source("app/coach/attendance/players/record/page.tsx")
    const calendarPage = source("app/coach/calendar/page.tsx")
    const register = source("components/coach/player-attendance-register.tsx")
    const recorder = source("components/coach/attendance/player-attendance-recorder.tsx")
    const calendar = source("components/coach/calendar/session-calendar.tsx")

    expect(registerPage).toContain("referenceInstant={now.getTime()}")
    expect(recorderPage).toContain("initialReferenceInstant={now.getTime()}")
    expect(calendarPage).toContain("referenceInstant={now.getTime()}")
    expect(register).toContain("useState(initialReferenceInstant)")
    expect(recorder).toContain("useState(initialReferenceInstant)")
    expect(calendar).toContain("useState(initialReferenceInstant)")
    expect(`${register}${recorder}${calendar}`).not.toContain("useState(Date.now())")
  })

  it("models financial record views as mutually exclusive payloads", () => {
    const workspace = source("components/coach/financials/financial-records-workspace.tsx")

    expect(workspace).toContain('activeView: "fees"')
    expect(workspace).toContain('activeView: "collections"')
    expect(workspace).toContain('activeView: "activity"')
    expect(workspace).toContain("activity?: never")
    expect(workspace).toContain("dayBook?: never")
    expect(workspace).toContain("feeRegister?: never")
  })

  it("gives native form controls stable submission metadata", () => {
    const files = [
      ...tsxFiles(path.join(process.cwd(), "app")),
      ...tsxFiles(path.join(process.cwd(), "components")),
    ]
    const unnamedControls = files.flatMap((file) => {
      const contents = readFileSync(file, "utf8")
      return Array.from(contents.matchAll(
        /<(?:input|select|textarea)\b(?:(?!\bname=)[^>])*?>/gu,
      )).map((match) => `${path.relative(process.cwd(), file)}: ${match[0].replace(/\s+/gu, " ")}`)
    })

    expect(unnamedControls).toEqual([])
  })

  it("declares touch and browser chrome policies without suppressing focus", () => {
    const globalStyles = source("app/globals.css")
    const layout = source("app/layout.tsx")
    const touchRule = globalStyles.match(
      /:where\(a, button, input, select, textarea, summary, \[role="button"\]\) \{([^}]*)\}/u,
    )?.[1]

    expect(touchRule).toContain("touch-action: manipulation")
    expect(touchRule).not.toContain("outline")
    expect(layout).toContain("export const viewport: Viewport")
    expect(layout).toContain('themeColor: "#071b32"')
  })

  it("uses an ellipsis for pending route announcements", () => {
    const loadingSources = [
      source("app/coach/loading.tsx"),
      source("app/coach/financials/loading.tsx"),
      source("app/(student)/loading.tsx"),
      source("app/(student)/player/financials/loading.tsx"),
    ].join("\n")

    expect(loadingSources).toContain("…")
    expect(loadingSources).not.toMatch(/(?:Loading|Opening)[^"<]*\./u)
  })
})
