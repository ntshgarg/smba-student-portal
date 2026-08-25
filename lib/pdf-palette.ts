/*
 * The brand palette for the generated PDFs, in the one place both generators
 * read it from. A PDF page carries DeviceRGB values, not custom properties, so
 * `app/globals.css`'s `:root` colours have to be restated as literals somewhere
 * — but once, not once per document.
 *
 * `lib/reports/pdf.ts` and `lib/finance/pdf.ts` each used to carry their own
 * copy, and both copies had drifted off the tokens: navy `#081c42` was CIE76
 * ΔE 11.27 from `--navy` (ΔE2000 5.34) and steel `#617083` was ΔE 5.37 from
 * `--steel` (ΔE2000 4.63), against a just-noticeable difference near 2.3. Red
 * (0.40) and ivory (1.28) were already imperceptibly close, but they are moved
 * here too, because a copy left behind is a copy that drifts next.
 *
 * The monthly report and the fee receipt are the artifacts a parent keeps, so
 * they carry the academy's own ivory, navy and red. `tests/design-tokens.test.ts`
 * re-reads `:root` and fails if these five ever part company with it again.
 *
 * Colours only. Both files draw through PDFKit's standard-14 Helvetica, whose
 * WinAnsi encoding has no U+20B9; see the note above `money` in
 * `lib/finance/pdf.ts` before touching anything typographic here.
 */
export const IVORY = "#f7f5f0" // --ivory
export const NAVY = "#071b32" // --navy
export const RED = "#c81d2a" // --red
export const STEEL = "#596673" // --steel
export const WHITE = "#ffffff" // --white
