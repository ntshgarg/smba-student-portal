import { test } from "./support/failure-evidence"

test("stages masked evidence for an unexpected browser failure", async ({ page }) => {
  test.skip(process.env.SMBA_FAILURE_EVIDENCE_SENTINEL !== "true")
  const secret = process.env.SMBA_FAILURE_EVIDENCE_SENTINEL_SECRET ?? "sentinel-password"
  const email = process.env.SMBA_FAILURE_EVIDENCE_SENTINEL_EMAIL ?? "sentinel@example.test"

  await page.setContent(`<!doctype html>
    <html lang="en">
      <head><title>Failure evidence sentinel</title></head>
      <body>
        <main>
          <h1>Failure evidence sentinel</h1>
          <label>Password <input type="password" value="${secret}"></label>
          <label>Email <input type="email" value="${email}"></label>
          <code data-sensitive="true">246810</code>
        </main>
      </body>
    </html>`)

  throw new Error("Intentional failure-evidence sentinel.")
})
