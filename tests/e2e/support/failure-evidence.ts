import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test as base } from "@playwright/test"
import type { Page, TestInfo } from "@playwright/test"

const SENSITIVE_PARAMETER = /^(?:auth|code|email|key|password|pin|recovery|secret|session|token|totp)(?:[-_].*)?$/iu
const MASK_SELECTORS = [
  "input",
  "textarea",
  '[contenteditable]:not([contenteditable="false"])',
  "code",
  "pre",
  '[data-sensitive="true"]',
  '.recovery-email-sent',
  '.totp-qr',
  '[aria-label*="QR" i]',
  '[alt*="QR" i]',
  '[autocomplete="current-password"]',
  '[autocomplete="new-password"]',
  '[name*="password" i]',
  '[name*="pin" i]',
  '[name*="email" i]',
  '[name*="totp" i]',
  '[name*="recovery" i]',
  '[id*="password" i]',
  '[id*="pin" i]',
  '[id*="email" i]',
  '[id*="totp" i]',
  '[id*="recovery" i]',
].join(",")

function evidenceRoot() {
  return path.resolve(process.env.SMBA_FAILURE_EVIDENCE_ROOT ?? "output/failure-evidence")
}

function safeSegment(value: string) {
  const normalized = sanitizeFailureText(value)
    .replace(/[^a-z0-9_-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
  return normalized || "playwright"
}

export function sanitizeFailureText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "<redacted-email>")
    .replace(/\b(?:SMBA-(?:HC|JC|PL)-\d{4})\b/gu, "<redacted-academy-id>")
    .replace(/\b[A-Z2-7]{20,}\b/gu, "<redacted-secret>")
    .replace(/((?:password|passphrase|pin|totp|recovery[ -]?(?:code|key)?|backup[ -]?code|secret)\s*(?:=|:|is)\s*)[^&\s,;]+/giu, "$1<redacted>")
    .replace(/((?:[?&]|\b)(?:auth|code|email|key|password|pin|recovery|secret|session|token|totp)(?:[-_][a-z0-9_-]+)?=)[^&\s]+/giu, "$1<redacted>")
    .replace(/\b\d{6}\b/gu, "<redacted-six-digit-code>")
}

export function sanitizeFailureUrl(value: string) {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_PARAMETER.test(key)) url.searchParams.delete(key)
    }
    url.username = ""
    url.password = ""
    url.hash = ""
    return sanitizeFailureText(url.toString())
  } catch {
    return sanitizeFailureText(value)
  }
}

function evidenceDirectory(testInfo: TestInfo) {
  const fingerprint = createHash("sha256")
    .update(`${testInfo.testId}:${testInfo.retry}:${testInfo.workerIndex}`)
    .digest("hex")
    .slice(0, 16)
  return path.join(evidenceRoot(), safeSegment(testInfo.project.name), fingerprint)
}

export async function captureMaskedFailure(page: Page, testInfo: TestInfo, name: string) {
  const directory = evidenceDirectory(testInfo)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const screenshotPath = path.join(directory, `${safeSegment(name)}.masked.png`)

  await page.addStyleTag({
    content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
  }).catch(() => undefined)
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    mask: [page.locator(MASK_SELECTORS)],
    maskColor: "#0a1f38",
    path: screenshotPath,
  })

  return screenshotPath
}

export async function stageFailureEvidence(
  page: Page,
  testInfo: TestInfo,
  browserMessages: readonly string[] = [],
  cause?: unknown,
) {
  const directory = evidenceDirectory(testInfo)
  mkdirSync(directory, { recursive: true, mode: 0o700 })

  if (!page.isClosed()) {
    await captureMaskedFailure(page, testInfo, "page-failure").catch(() => undefined)
  }

  const error = testInfo.error ?? (cause instanceof Error ? cause : undefined)
  const evidence = {
    browserMessages: browserMessages.slice(-80).map(sanitizeFailureText),
    error: error ? {
      message: sanitizeFailureText(error.message ?? String(error)),
      stack: sanitizeFailureText(error.stack ?? "").split("\n").slice(0, 40).join("\n"),
    } : null,
    expectedStatus: testInfo.expectedStatus,
    project: sanitizeFailureText(testInfo.project.name),
    retry: testInfo.retry,
    status: testInfo.status,
    title: sanitizeFailureText(testInfo.title),
    url: page.isClosed() ? "<page-closed>" : sanitizeFailureUrl(page.url()),
  }

  writeFileSync(
    path.join(directory, "failure.sanitized.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o600 },
  )
}

export const test = base.extend<{ failureEvidence: void }>({
  failureEvidence: [async ({ page }, use, testInfo) => {
    const browserMessages: string[] = []
    const recordConsole = (message: { text(): string; type(): string }) => {
      if (["error", "warning"].includes(message.type())) browserMessages.push(message.text())
    }
    const recordPageError = (error: Error) => browserMessages.push(error.stack ?? error.message)
    page.on("console", recordConsole)
    page.on("pageerror", recordPageError)
    await use()
    page.off("console", recordConsole)
    page.off("pageerror", recordPageError)

    if (testInfo.status !== testInfo.expectedStatus) {
      await stageFailureEvidence(page, testInfo, browserMessages).catch(() => undefined)
    }
  }, { auto: true }],
})

export { expect }
