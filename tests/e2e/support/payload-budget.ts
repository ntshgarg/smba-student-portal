// One route payload measurement, reported the moment it is taken.
//
// The bytes used to reach only test.info().annotations, pushed after the last
// assertion in the case. An over-budget route throws at its own expect(), so
// the pushes never ran and the one run that needed the number was the one run
// that recorded nothing. Reporting from inside the measurement settles the
// ordering structurally: there is no way to obtain the byte count without
// having already printed it.
//
// stdout rather than an annotation, because playwright.phase8-followup.config.ts
// runs the `list` reporter alone and no terminal reporter prints annotations --
// grepping `annotation` through the whole of playwright 1.62.1's
// lib/runner/index.js finds them only in the html, json and junit serializers
// and in the skip-reason lookup for a step title. quality.yml may not upload an
// html report (tests/ci-diagnostics-controls.test.ts forbids it), so those
// reporters are not an option here. support/accessibility-audit.ts logs its
// advisory counts to the step log for the same reason.
//
// Typed structurally rather than against Playwright's Response so this stays
// importable from a plain Node test; Buffer satisfies Uint8Array.
export async function measureBudgetedPayload(
  response: { body(): Promise<Uint8Array> } | null,
  route: string,
  budgetBytes: number,
) {
  if (!response) throw new Error(`Navigation to ${route} did not return a document response.`)

  const bytes = (await response.body()).byteLength
  console.log(`[payload-budget] ${route}: ${bytes} bytes measured against a budget of ${budgetBytes}`)
  return bytes
}
