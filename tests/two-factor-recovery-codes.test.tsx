import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * F-8. The ten recovery codes are minted once, live only in the action state
 * this component holds, and stop being obtainable the moment confirmTotpSetup
 * succeeds -- it sets two_factor_enabled, after which the page guard and
 * startTotpSetup both redirect away. /account/security can mint a replacement
 * set from there, but never show this one again.
 *
 * The suite has no DOM, so the controls cannot be pressed here. Two things can
 * still be checked. The state each render commits to: that the submit which
 * discards the codes refuses until it is acknowledged, and that the
 * explanation it points at exists while it points at it. And the two ways out
 * of the screen, which take their browser calls as arguments the way
 * `tryCopyText(value, clipboard)` does, so a `node` run can drive both their
 * successes and every failure they are able to see.
 */

const { controls, unusedAction } = vi.hoisted(() => ({
  controls: {
    acknowledged: false,
    acknowledgementSteered: false,
    setup: null as { backupCodes: string[]; totpURI: string } | null,
  },
  unusedAction: () => Promise.reject(new Error("The actions are never dispatched here.")),
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    // One state serves both call sites: the codes branch reads `setup`, the
    // verify form reads `error`.
    useActionState: () => [{ error: null, setup: controls.setup }, () => {}, false],
    useState: (initial: unknown) => {
      // The acknowledgement is component state and a static render cannot tick
      // it. It is the first `false` the render reaches -- the component's own
      // hooks run before any child mounts -- so the steer cannot stray into
      // qrcode.react or the notice.
      if (initial !== false || controls.acknowledgementSteered) return actual.useState(initial)
      controls.acknowledgementSteered = true
      return actual.useState(controls.acknowledged)
    },
  }
})

vi.mock("@/app/auth/two-factor/actions", () => ({
  confirmTotpSetup: unusedAction,
  startTotpSetup: unusedAction,
}))

const { TwoFactorSetupForm } = await import("@/components/two-factor-setup-form")
// The copy and download helpers moved out of the enrolment form so that the
// reissue panel on /account/security can reuse them without dragging
// `qrcode.react` into its client chunk.
const {
  copyRecoveryCodes,
  downloadRecoveryCodes,
  recoveryCodesDocument,
} = await import("@/lib/client/recovery-codes")

const backupCodes = ["AAAA-1111", "BBBB-2222", "CCCC-3333"]

/** The opening tag of the submit that discards the codes. */
function submitTag(markup: string) {
  const start = markup.indexOf('<button class="login-submit"')
  expect(start).toBeGreaterThan(-1)
  return markup.slice(start, markup.indexOf(">", start) + 1)
}

function enrolmentMarkup({ acknowledged }: { acknowledged: boolean }) {
  controls.acknowledged = acknowledged
  controls.acknowledgementSteered = false
  return renderToStaticMarkup(<TwoFactorSetupForm />)
}

describe("the recovery codes an enrolling coach has to keep", () => {
  beforeEach(() => {
    controls.setup = {
      backupCodes,
      totpURI: "otpauth://totp/SMBA:coach?secret=JBSWY3DPEHPK3PXP&issuer=SMBA",
    }
  })

  it("offers a copy and a download beside the codes", () => {
    const markup = enrolmentMarkup({ acknowledged: false })

    for (const code of backupCodes) expect(markup).toContain(code)
    expect(markup).toContain("Copy all codes")
    expect(markup).toContain("Download as a file")
  })

  it("holds the submit closed and explains why, with the explanation rendered", () => {
    const markup = enrolmentMarkup({ acknowledged: false })

    // aria-disabled rather than `disabled`: a disabled button leaves the tab
    // order, and a control focus mode never reaches cannot read out its reason.
    expect(submitTag(markup)).toContain('aria-disabled="true"')
    expect(submitTag(markup)).not.toContain('disabled=""')
    expect(submitTag(markup)).toContain('aria-describedby="totp-codes-saved-hint"')
    expect(markup).toContain('id="totp-codes-saved-hint"')
  })

  it("opens the submit and drops the dangling description together", () => {
    const markup = enrolmentMarkup({ acknowledged: true })

    expect(submitTag(markup)).not.toContain("disabled")
    expect(markup).not.toContain("totp-codes-saved-hint")
    expect(markup).toContain("Verify and enter workspace")
  })
})

describe("the two ways of getting the codes off this screen", () => {
  it("names the count the clipboard took, from the same document as the file", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)

    await expect(copyRecoveryCodes(backupCodes, { writeText })).resolves.toEqual({
      message: "All 3 recovery codes are on the clipboard",
      tone: "success",
    })
    const [written] = writeText.mock.calls[0] as [string]
    expect(written).toContain("Sathiya Moorthy Badminton Academy")
    for (const code of backupCodes) expect(written).toContain(code)
  })

  it("points at the download when there is no Clipboard API to write to", async () => {
    await expect(copyRecoveryCodes(backupCodes, undefined)).resolves.toEqual({
      message: "The clipboard was not available. Download the codes instead",
      tone: "error",
    })
  })

  it("points at the download when the clipboard write is refused", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Permission denied"))

    await expect(copyRecoveryCodes(backupCodes, { writeText })).resolves.toEqual({
      message: "The clipboard was not available. Download the codes instead",
      tone: "error",
    })
  })

  it("hands the browser a named file and keeps the object URL alive past the click", () => {
    const anchor = { click: vi.fn(), download: "", href: "" }
    let blobbed = ""
    const port = {
      createAnchor: () => anchor,
      createObjectUrl: (text: string) => { blobbed = text; return "blob:recovery-codes" },
      revokeObjectUrl: vi.fn(),
      defer: vi.fn(),
    }

    const feedback = downloadRecoveryCodes(backupCodes, port)

    expect(blobbed).toContain("Sathiya Moorthy Badminton Academy")
    for (const code of backupCodes) expect(blobbed).toContain(code)
    expect(anchor.href).toBe("blob:recovery-codes")
    expect(anchor.download).toMatch(/^SMBA-authenticator-recovery-codes-\d{4}-\d{2}-\d{2}\.txt$/u)
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(feedback).toEqual({
      message: `Download started as ${anchor.download}`,
      tone: "success",
    })
    // The click only queued the read. Revoking in this task, which is what the
    // release is handed to `defer` rather than run for, would cancel the save.
    expect(port.revokeObjectUrl).not.toHaveBeenCalled()
    port.defer.mock.calls[0][0]()
    expect(port.revokeObjectUrl).toHaveBeenCalledWith("blob:recovery-codes")
  })

  it("refuses an anchor that cannot save rather than navigate off the codes", () => {
    const anchor = { click: vi.fn() }
    const port = {
      createAnchor: () => anchor,
      createObjectUrl: vi.fn(() => "blob:recovery-codes"),
      revokeObjectUrl: vi.fn(),
      defer: vi.fn(),
    }

    expect(downloadRecoveryCodes(backupCodes, port)).toEqual({
      message: "This browser cannot save files. Copy the codes instead",
      tone: "error",
    })
    // A click on an anchor without `download` navigates to the blob, which
    // unmounts the only component holding the codes.
    expect(anchor.click).not.toHaveBeenCalled()
    expect(port.createObjectUrl).not.toHaveBeenCalled()
  })

  it("reports a download that could not be prepared instead of a start", () => {
    const anchor = { click: vi.fn(), download: "", href: "" }
    const port = {
      createAnchor: () => anchor,
      createObjectUrl: vi.fn(() => { throw new Error("Blob quota exceeded") }),
      revokeObjectUrl: vi.fn(),
      defer: vi.fn(),
    }

    expect(downloadRecoveryCodes(backupCodes, port)).toEqual({
      message: "The file could not be prepared. Copy the codes instead",
      tone: "error",
    })
    expect(anchor.click).not.toHaveBeenCalled()
    expect(port.defer).not.toHaveBeenCalled()
  })
})

describe("the document behind both controls", () => {
  const issuedAt = new Date("2026-08-24T06:00:00.000Z")

  it("names itself for a downloads folder read months later", () => {
    expect(recoveryCodesDocument(backupCodes, issuedAt).fileName)
      .toBe("SMBA-authenticator-recovery-codes-2026-08-24.txt")
  })

  it("carries every code under prose that says what they are", () => {
    const { text } = recoveryCodesDocument(backupCodes, issuedAt)

    expect(text).toContain("Sathiya Moorthy Badminton Academy")
    expect(text).toContain("Issued 24 August 2026")
    expect(text).toContain("once")
    for (const code of backupCodes) expect(text).toContain(`\n${code}\n`)
  })
})
