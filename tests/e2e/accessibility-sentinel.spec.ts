import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

test("the scanner rejects an isolated inaccessible fixture", async ({ page }) => {
  test.skip(process.env.SMBA_ACCESSIBILITY_PROFILE !== "admin")
  test.fail(true, "The fixture deliberately contains an unnamed button and must fail Axe.")
  await page.setContent(`<!doctype html>
    <html lang="en">
      <head><title>Accessibility sentinel</title></head>
      <body><main><h1>Scanner sentinel</h1><button></button></main></body>
    </html>`)
  const results = await new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
    "wcag22aa",
  ]).analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])
})
