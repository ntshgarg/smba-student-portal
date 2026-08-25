import type { ActionFeedback } from "@/components/inline-notice"
import { tryCopyText, type ClipboardWriter } from "@/lib/client/clipboard"
import { formatAcademyDate, getAcademyDateKey } from "@/lib/format"

/**
 * The two ways a set of authenticator recovery codes leaves the screen it is
 * minted on, kept out of `two-factor-setup-form.tsx` because both screens that
 * hand codes out need them and only one of them draws a QR code. Importing
 * these from the enrolment form pulled `qrcode.react` and the whole enrolment
 * component into the /account/security client chunk -- measured at +29.1 KB
 * raw, +9.5 KB gzip on a route that never renders a QR code, which Turbopack
 * did not shake out.
 */

/**
 * The clipboard and the file carry the same document, so both routes out of a
 * handout screen leave the same thing to read. The prose is part of it: a bare
 * column of ten strings found in a downloads folder months later says nothing
 * about what it opens or that each line is spent on use.
 *
 * `issuedAt` is a parameter so the document is a pure function of its inputs;
 * the callers are click handlers, where reading the clock is safe.
 */
export function recoveryCodesDocument(codes: string[], issuedAt: Date = new Date()) {
  return {
    fileName: `SMBA-authenticator-recovery-codes-${getAcademyDateKey(issuedAt)}.txt`,
    text: [
      "Sathiya Moorthy Badminton Academy - authenticator recovery codes",
      `Issued ${formatAcademyDate(issuedAt)}`,
      "",
      "Each code signs the coach account in once when the authenticator app is",
      "not to hand. Cross a code off after it is used. Keep this away from the",
      "device that runs the app, and never share it.",
      "",
      ...codes,
      "",
    ].join("\n"),
  }
}

/**
 * The browser half of a download, as the four calls it actually takes. The
 * components pass the real ones; a test passes doubles, because the vitest
 * environment is `node` (vitest.config.ts:11) and there is no anchor to click.
 */
export type RecoveryCodeDownloadPort = {
  createAnchor: () => { click: () => void; download?: string; href?: string }
  createObjectUrl: (text: string) => string
  revokeObjectUrl: (url: string) => void
  /** Runs `release` well after the click; see downloadRecoveryCodes. */
  defer: (release: () => void) => void
}

/** Exported so every screen that hands out codes saves them the same way. */
export const browserDownloadPort: RecoveryCodeDownloadPort = {
  createAnchor: () => document.createElement("a"),
  createObjectUrl: (text) => URL.createObjectURL(new Blob([text], { type: "text/plain" })),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  defer: (release) => { window.setTimeout(release, 60_000) },
}

export async function copyRecoveryCodes(
  codes: string[],
  clipboard?: ClipboardWriter | null,
): Promise<ActionFeedback> {
  // `tryCopyText` answers false for a missing Clipboard API and for a denied
  // write alike, and the two are indistinguishable from here, so the failure
  // names the remedy rather than the cause.
  const copied = await tryCopyText(recoveryCodesDocument(codes).text, clipboard)
  return copied
    ? { message: `All ${codes.length} recovery codes are on the clipboard`, tone: "success" }
    : { message: "The clipboard was not available. Download the codes instead", tone: "error" }
}

export function downloadRecoveryCodes(
  codes: string[],
  port: RecoveryCodeDownloadPort,
): ActionFeedback {
  const { fileName, text } = recoveryCodesDocument(codes)
  const anchor = port.createAnchor()
  // Without `download` the click navigates to the blob instead of saving it,
  // and navigating unmounts whichever form is holding the codes -- they live
  // in its action state, and neither enrolment nor the reissue panel on
  // /account/security shows a set twice. Refuse rather than click.
  if (!("download" in anchor)) {
    return { message: "This browser cannot save files. Copy the codes instead", tone: "error" }
  }

  let objectUrl = ""
  try {
    objectUrl = port.createObjectUrl(text)
    anchor.href = objectUrl
    anchor.download = fileName
    anchor.click()
  } catch {
    if (objectUrl) port.revokeObjectUrl(objectUrl)
    return { message: "The file could not be prepared. Copy the codes instead", tone: "error" }
  }

  // The click queues the read of the object URL rather than performing it, so
  // releasing it in this task -- or in the next one, which is all setTimeout 0
  // buys -- can cancel the save before a byte is read. `browserDownloadPort`
  // holds it for a minute; whatever is left goes when the document does.
  port.defer(() => port.revokeObjectUrl(objectUrl))
  // Nothing observable says where the file landed -- some phone browsers open a
  // text file rather than storing it -- so the notice claims only the start.
  return { message: `Download started as ${fileName}`, tone: "success" }
}
