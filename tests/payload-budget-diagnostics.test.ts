import { afterEach, describe, expect, it, vi } from "vitest"

import { measureBudgetedPayload } from "@/tests/e2e/support/payload-budget"

// Stand-ins, not the budgets phase8-followup.spec.ts holds. `git log -S` on
// either of those literals is the evidence that comment offers for their never
// having been re-measured, and a second occurrence anywhere in the tree changes
// the count that search reports -- which would put the commit that added it
// into the answer and retire the evidence.
const MEASURED_BYTES = 12_346
const BUDGET_BYTES = 12_345
const ROUTE = "/coach/calendar?date=2026-08-03"

function documentResponseOf(bytes: number) {
  return { body: async () => new Uint8Array(bytes) }
}

/*
 * The measurement used to be reported by two test.info().annotations pushed
 * after the last assertion in the case. An over-budget route throws at its own
 * expect() several lines earlier, so those pushes never ran on the only kind of
 * run that wanted them -- and the `list` reporter the suite is configured with
 * prints no annotation on a green run either. What replaced them has to hold
 * the ordering the annotations did not, which is what these assert.
 */
describe("route payload budget diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("reports the bytes it measured before any caller can assert on them", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})

    const bytes = await measureBudgetedPayload(documentResponseOf(MEASURED_BYTES), ROUTE, BUDGET_BYTES)

    // Returning the count is what the caller needs to assert on, and the report
    // is on the way there: there is no measurement this can miss.
    expect(bytes).toBe(MEASURED_BYTES)
    expect(log).toHaveBeenCalledTimes(1)
    const reported = String(log.mock.calls[0]?.[0])
    expect(reported).toContain(String(MEASURED_BYTES))
    expect(reported).toContain(String(BUDGET_BYTES))
    expect(reported).toContain(ROUTE)
  })

  it("still fails loudly, and names the route, when no document response came back", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})

    await expect(measureBudgetedPayload(null, ROUTE, BUDGET_BYTES))
      .rejects.toThrow(`Navigation to ${ROUTE} did not return a document response.`)
    expect(log).not.toHaveBeenCalled()
  })
})
