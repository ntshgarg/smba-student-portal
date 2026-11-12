/**
 * M024 -- the public site's Sign out during an admin preview.
 *
 * The account menu's "Return to academy" leads to the public site, whose
 * header shows the person being viewed and a Sign out button. That button sent
 * the ordinary sign-out, which the preview refuses, so it ended on an error
 * page with the owner still signed in and still previewing.
 */
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/login/actions", () => ({ clearSession: vi.fn() }))

import { accountFromSessionSummary, HeaderSignOut } from "@/components/public/public-header"

const summary = {
  account: { initials: "AR", name: "Asha Raman", role: "player" },
  status: "authenticated",
}

describe("the public header during an admin preview", () => {
  it("knows from the session summary that a preview is open", () => {
    expect(accountFromSessionSummary(summary)).toMatchObject({ previewMode: false })
    expect(accountFromSessionSummary({
      ...summary,
      account: { ...summary.account, previewMode: true },
    })).toMatchObject({ dashboardHref: "/player", previewMode: true })
  })

  it("signs out through Exit preview, the one form a preview allows", () => {
    const markup = renderToStaticMarkup(<HeaderSignOut previewMode />)
    expect(markup).toContain('action="/admin/preview/exit"')
    expect(markup).toContain('method="post"')
    expect(markup).toContain('name="signOut"')
    expect(markup).toContain("Exit preview and sign out")
  })

  it("keeps the ordinary sign-out otherwise", () => {
    const markup = renderToStaticMarkup(<HeaderSignOut previewMode={false} />)
    expect(markup).not.toContain("/admin/preview/exit")
    expect(markup).toContain("Sign out")
  })
})
