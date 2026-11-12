/**
 * M024 -- the ways out of an admin preview.
 *
 * While the owner views someone's dashboard, the proxy turns away every form
 * except Exit preview. Log out was one of those forms, so it ended on an error
 * page with the owner still signed in. And the pages a preview may not open
 * (account security, recovery email setup, the sign-in page) all sent the owner
 * to /admin, which -- seeing a player rather than the owner -- sent them to
 * /login, which sent a player still owing a recovery email back to setup, then
 * /admin again, until the browser reported too many redirects.
 */
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  adminPreviewBlocksChanges: vi.fn(async () => false),
  clearDatabaseSession: vi.fn(async () => {}),
  cookieValue: null as string | null,
  ensureDueTrainingChangesApplied: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getRawAuthSession: vi.fn(),
  ownerRow: { id: "owner" } as { id: string } | undefined,
  readAdminPreviewToken: vi.fn(),
  redirect: vi.fn((destination: string) => {
    const error = new Error(`NEXT_REDIRECT:${destination}`) as Error & { digest: string }
    error.digest = `NEXT_REDIRECT;push;${destination};307;`
    throw error
  }),
  requireHeadAdminAccess: vi.fn(),
  writeAuthSecurityEvent: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.cookieValue ? { value: mocks.cookieValue } : undefined),
  }),
  headers: async () => new Headers(),
}))
vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity, hasActiveSession: async () => true },
}))
vi.mock("@/lib/auth/session", () => ({
  adminPreviewBlocksChanges: mocks.adminPreviewBlocksChanges,
  clearDatabaseSession: mocks.clearDatabaseSession,
  getRawAuthSession: mocks.getRawAuthSession,
}))
vi.mock("@/lib/auth/admin-preview", () => ({
  ADMIN_PREVIEW_COOKIE: "smba_admin_preview",
  readAdminPreviewToken: mocks.readAdminPreviewToken,
}))
vi.mock("@/lib/auth/security-context", () => ({
  writeAuthSecurityEvent: mocks.writeAuthSecurityEvent,
}))
vi.mock("@/lib/db/client", () => ({
  initializeDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: () => mocks.ownerRow }) }) }),
  }),
}))
vi.mock("@/lib/auth/coach-access", () => ({
  getCoachAccessProfile: vi.fn(),
  requireHeadAdminAccess: mocks.requireHeadAdminAccess,
}))
vi.mock("@/lib/training/changes", () => ({
  ensureDueTrainingChangesApplied: mocks.ensureDueTrainingChangesApplied,
}))
vi.mock("@/app/login/actions", () => ({ clearSession: vi.fn() }))
vi.mock("@/components/motion/use-presence", () => ({
  // The menu renders its items only once opened; render it opened.
  usePresence: () => ({ mounted: true, state: "open" }),
}))

import { AccountMenu } from "@/components/account-menu"
import { POST as exitPreview } from "@/app/admin/preview/exit/route"
import AdminPage from "@/app/admin/page"
import LoginPage from "@/app/login/page"
import { requireHeadAdminAction } from "@/lib/auth/current-coach"

const previewedPlayer = {
  academyId: "SMBA-PL-0004",
  actorSubjectId: "owner",
  firstName: "Asha",
  fullName: "Asha Raman",
  initials: "AR",
  previewMode: true as const,
  role: "player" as const,
  subjectId: "player-4",
}

function exitRequest(fields: Record<string, string> = {}) {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) body.set(key, value)
  return new Request("http://localhost:3000/admin/preview/exit", { body, method: "POST" })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cookieValue = "preview-token"
  mocks.ownerRow = { id: "owner" }
  mocks.getRawAuthSession.mockResolvedValue({
    session: { token: "owner-session" },
    user: { id: "owner" },
  })
  mocks.readAdminPreviewToken.mockReturnValue({ actorAccountId: "owner", targetAccountId: "player-4" })
})

describe("Log out during a preview", () => {
  it("goes out through the preview's own exit, the one form the preview allows", () => {
    const markup = renderToStaticMarkup(
      <AccountMenu account={previewedPlayer} previewMode publicSiteHref="/" />,
    )
    expect(markup).toContain('action="/admin/preview/exit"')
    expect(markup).toContain('name="signOut"')
    expect(markup).toContain("Log out")
    // The previewed person's account security is not the owner's to open.
    expect(markup).not.toContain('href="/account/security"')
  })

  it("keeps the ordinary menu outside a preview", () => {
    const markup = renderToStaticMarkup(<AccountMenu account={previewedPlayer} publicSiteHref="/" />)
    expect(markup).toContain('href="/account/security"')
    expect(markup).not.toContain('action="/admin/preview/exit"')
  })

  it("ends the preview, signs the owner out and leaves for the public site", async () => {
    const response = await exitPreview(exitRequest({ signOut: "1" }))
    expect(mocks.clearDatabaseSession).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(303)
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/")
    expect(response.headers.get("set-cookie")).toMatch(/smba_admin_preview=;/u)
  })

  it("Exit preview alone keeps the owner signed in and returns to the console", async () => {
    const response = await exitPreview(exitRequest())
    expect(mocks.clearDatabaseSession).not.toHaveBeenCalled()
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/admin")
  })
})

describe("the stop record", () => {
  it("is filed under the person who was viewed, beside the start record", async () => {
    await exitPreview(exitRequest())
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "player-4",
      actorAccountId: "owner",
      eventType: "admin_preview_stopped",
    }))
  })

  it("falls back to the owner when the preview had already lapsed", async () => {
    mocks.readAdminPreviewToken.mockReturnValue(null)
    await exitPreview(exitRequest())
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "owner",
      eventType: "admin_preview_stopped",
    }))
  })
})

describe("the owner console during a preview", () => {
  it("says where the owner is and offers Exit preview instead of redirecting", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(previewedPlayer)
    const markup = renderToStaticMarkup(await AdminPage())
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(markup).toContain("Exit preview")
    expect(markup).toContain("still viewing Asha")
    expect(markup).toContain('href="/player"')
  })

  it("sends the sign-in page to the console rather than the viewed person's next step", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(previewedPlayer)
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/admin")
  })
})

describe("the head coach action gate", () => {
  it("refuses a preview even if a form got past the proxy", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({
      ...previewedPlayer,
      firstName: "Head",
      fullName: "Head Coach",
      role: "coach",
      subjectId: "coach-1",
    })
    await expect(requireHeadAdminAction()).rejects.toThrow(/read-only/u)
    expect(mocks.requireHeadAdminAccess).not.toHaveBeenCalled()
  })
})
