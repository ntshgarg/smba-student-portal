import { describe, expect, it } from "vitest"

import { csvExportTruncationLine } from "@/lib/finance/csv-truncation"

// F-17: a streamed export's pages are pulled after the handler has returned, so
// its `catch` and its 500 are already unreachable when a page fails. The signal
// has to reach the coach through the file itself, which means this line is
// load-bearing in a way a log line is not.
describe("the notice a streamed export ends with when it stops short", () => {
  it("says the file is incomplete, how far it got, and not to reconcile it", () => {
    const line = csvExportTruncationLine(14, 200, "Run the export again.")

    expect(line).toContain("EXPORT INCOMPLETE")
    expect(line).toContain("stopped after 200 rows")
    expect(line).toContain("Do not reconcile from it")
    expect(line.endsWith("\r\n")).toBe(true)
  })

  it("counts a single row as a row, including none at all", () => {
    expect(csvExportTruncationLine(9, 1, "Run the export again."))
      .toContain("after 1 row and")
    expect(csvExportTruncationLine(9, 0, "Run the export again."))
      .toContain("after 0 rows and")
  })

  // The caller decides what the coach does next, because only the caller can
  // tell a refusal that will be decided the same way again from a moment that
  // has passed. Whatever it decides ends up in front of the coach verbatim.
  it("ends on the caller's account of why the export stopped", () => {
    const line = csvExportTruncationLine(9, 12, "The financial-records cursor is invalid.")

    expect(line).toContain("The financial-records cursor is invalid.")
    expect(line).not.toContain("Run the export again.")
  })

  // The CSV exports are covered by a property that every record carries the
  // same field count, and the notice is a record like any other.
  it("fills the export's full width so the record still parses", () => {
    for (const columns of [9, 14]) {
      const fields = csvExportTruncationLine(columns, 3, "Run the export again.")
        .replace(/\r\n$/u, "").split(",")
      expect(fields, `${columns}-column export`).toHaveLength(columns)
      expect(fields.slice(1).every((field) => field === "")).toBe(true)
    }
  })

  // Emitted without going through the encoders' `csvCell`, so it has to do its
  // own quoting -- and it must not read as a formula in the first cell of the
  // last row, whatever the caller's sentence adds after it.
  it("quotes itself when the caller's sentence carries a comma", () => {
    const line = csvExportTruncationLine(9, 4, 'Ask for help, "now".')

    expect(line).toBe(
      '"EXPORT INCOMPLETE: this file stopped after 4 rows and is missing the '
      + 'rest. Do not reconcile from it. Ask for help, ""now""."'
      + ",,,,,,,,\r\n",
    )
  })

  it("carries no character a CSV reader or a spreadsheet would act on", () => {
    const notice = csvExportTruncationLine(9, 42, "Run the export again.").split(",")[0]

    expect(notice).not.toMatch(/[",\r\n]/u)
    expect(notice).not.toMatch(/^[\s=+\-@\t\r]/u)
  })
})
