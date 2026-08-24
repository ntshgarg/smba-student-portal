// What a streamed finance CSV export says when it stops before its last row.
//
// Deliberately importing nothing. The two encoders that use it are pure
// functions over rows, covered by a property test that parses their records
// (`tests/property/normalization-csv.property.test.ts`); pulling the http layer
// or the finance service in here would drag a logger and a database client into
// that test's import graph for the sake of one sentence of prose.

/**
 * A value the export cannot write, raised by an encoder about a row it holds.
 *
 * Separate from a read fault because it is a property of the row rather than of
 * the moment: the same export run again reaches the same row and stops in the
 * same place. Whoever turns a failure into words for the coach needs to tell
 * those two apart, or it tells a coach to retry something that cannot succeed.
 */
export class CsvExportValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CsvExportValueError"
  }
}

/**
 * Told that a streamed export stopped early, with the rows it did write, and
 * answers with the sentence the file's last line ends on.
 *
 * Required rather than optional at every call site. The encoders catch to keep
 * the notice in the file, and a catch whose handler can be left out is a catch
 * that silently discards a database error -- exactly what F-18 exists to
 * remove. It returns the coach's next step instead of the encoders writing one,
 * because only the caller knows whether the failure was a refusal the finance
 * service already worded, a row that will fail again, or a moment that passed.
 */
export type ExportTruncation = (error: unknown, rowsWritten: number) => string

/**
 * The last line of a streamed CSV export that stopped before its final row.
 *
 * An export's log is read by an operator who may never learn the export
 * happened. The coach is holding the file, so the file has to say so itself --
 * otherwise a short export is indistinguishable from a small one and gets
 * reconciled. The notice goes in the first column, where a spreadsheet puts it
 * directly under the names and amounts being reconciled, and carries the row
 * count so the coach can see exactly where the file stops.
 *
 * Padded to the full width because both CSV exports are covered by a property
 * that every record has the same number of columns
 * (`tests/property/normalization-csv.property.test.ts`), and a parser is
 * entitled to rely on it. `advice` is a caller's sentence rather than a literal
 * written here, so it may hold a comma or a quote and the cell is quoted when
 * it does; the cell still opens with `E`, which no spreadsheet reads as a
 * formula.
 */
export function csvExportTruncationLine(
  columns: number,
  rowsWritten: number,
  advice: string,
) {
  const notice = `EXPORT INCOMPLETE: this file stopped after ${rowsWritten} `
    + `${rowsWritten === 1 ? "row" : "rows"} and is missing the rest. `
    + `Do not reconcile from it. ${advice}`
  const cell = /[",\r\n]/u.test(notice)
    ? `"${notice.replaceAll('"', '""')}"`
    : notice
  return `${[cell, ...Array<string>(columns - 1).fill("")].join(",")}\r\n`
}
