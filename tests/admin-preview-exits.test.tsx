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
  adminPreviewTargetGone: vi.fn(async () => false),
  clearDatabaseSession: vi.fn(async () => {}),
  cookieValue: null as string | null,
  ensureDueTrainingChangesApplied: vi.fn(),
  getCoachAccessProfile: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getRawAuthSession: vi.fn(),
  ownerRow: { id: "owner" } as { id: string } | undefined,
  readAdminPreviewRecord: vi.fn(),
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
  portalRepository: { getPlayer: async () => null },
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity, hasActiveSession: async () => true },
}))
vi.mock("@/lib/auth/session", () => ({
  adminPreviewTargetGone: mocks.adminPreviewTargetGone,
  clearDatabaseSession: mocks.clearDatabaseSession,
  getRawAuthSession: mocks.getRawAuthSession,
}))
vi.mock("@/lib/auth/admin-preview", () => ({
  ADMIN_PREVIEW_COOKIE: "smba_admin_preview",
  readAdminPreviewRecord: mocks.readAdminPreviewRecord,
}))
vi.mock("@/lib/auth/security-context", () => ({
  writeAuthSecurityEvent: mocks.writeAuthSecurityEvent,
}))
vi.mock("@/lib/db/client", () => {
  // Any query: `get` finds the owner row, `all` finds nothing.
  const query: object = new Proxy({}, {
    get: (_target, key) => key === "get"
      ? () => mocks.ownerRow
      : key === "all" ? () => [] : () => query,
  })
  return { initializeDatabase: () => query }
})
vi.mock("@/lib/auth/coach-access", () => ({
  getCoachAccessProfile: mocks.getCoachAccessProfile,
  requireHeadAdminAccess: mocks.requireHeadAdminAccess,
}))
vi.mock("@/lib/auth/recovery-service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/recovery-service")>(),
  recoveryEmailEnrollmentRequired: () => false,
}))
vi.mock("@/lib/auth/initial-setup", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/initial-setup")>(),
  headCoachSetupAvailable: () => false,
}))
vi.mock("@/lib/auth/authenticator-reset-service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/authenticator-reset-service")>(),
  listPendingAuthenticatorResetRequests: () => [],
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
import { AppShell } from "@/components/app-shell"
import { CoachShell } from "@/components/coach/coach-shell"
import { POST as exitPreview } from "@/app/admin/preview/exit/route"
import AdminPage, { generateMetadata as adminMetadata } from "@/app/admin/page"
import LoginPage from "@/app/login/page"
import { requireCoachPage, requireHeadAdminAction } from "@/lib/auth/current-coach"
import { getCurrentStudent } from "@/lib/student/current-student"

const owner = {
  academyId: "SMBA-PO-0001",
  firstName: "Platform",
  fullName: "Platform Owner",
  initials: "PO",
  role: "platform_admin" as const,
  subjectId: "owner",
}

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
  mocks.adminPreviewTargetGone.mockResolvedValue(false)
  mocks.cookieValue = "preview-token"
  mocks.ownerRow = { id: "owner" }
  mocks.getRawAuthSession.mockResolvedValue({
    session: { token: "owner-session" },
    user: { id: "owner" },
  })
  mocks.readAdminPreviewRecord.mockReturnValue({ actorAccountId: "owner", targetAccountId: "player-4" })
})

describe("Log out during a preview", () => {
  it("goes out through the preview's own exit, the one form the preview allows", () => {
    const markup = renderToStaticMarkup(
      <AccountMenu account={previewedPlayer} previewMode publicSiteHref="/" />,
    )
    expect(markup).toContain('action="/admin/preview/exit"')
    expect(markup).toContain('name="signOut"')
    // It says whose sign-in ends: the name shown is the person being viewed.
    expect(markup).toContain("Viewing as")
    expect(markup).not.toContain("Signed in as")
    expect(markup).toContain("Exit preview and log out")
    // The previewed person's account security is not the owner's to open.
    expect(markup).not.toContain('href="/account/security"')
  })

  it("is the menu the coach and player pages actually show during a preview", () => {
    const coachMarkup = renderToStaticMarkup(
      <CoachShell coach={{ ...previewedPlayer, id: "coach-1" }} previewMode>page</CoachShell>,
    )
    expect(coachMarkup).toContain('action="/admin/preview/exit"')
    expect(coachMarkup).not.toContain('href="/account/security"')

    const playerMarkup = renderToStaticMarkup(
      <AppShell student={{ ...previewedPlayer, playerId: "player-4" }}>page</AppShell>,
    )
    expect(playerMarkup).toContain('action="/admin/preview/exit"')
    expect(playerMarkup).not.toContain('href="/account/security"')
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

  it("falls back to the owner only when no preview cookie came with the exit", async () => {
    mocks.readAdminPreviewRecord.mockReturnValue(null)
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

  it("names a coach the way the coach pages do, and keeps a way to log out", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ ...previewedPlayer, role: "coach", subjectId: "coach-1" })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "junior_coach" })
    const markup = renderToStaticMarkup(await AdminPage())
    expect(markup).toContain("Asha Raman · Assistant coach")
    expect(markup).toContain('href="/coach"')
    expect(markup).toMatch(/<h1[^>]*>You are still viewing Asha/u)
    expect(markup).toContain('name="signOut"')
    expect(await adminMetadata()).toMatchObject({ title: "Admin preview" })
  })

  it("says the preview ended when the person viewed is gone, and leaves the console working", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(owner)
    mocks.adminPreviewTargetGone.mockResolvedValue(true)
    const markup = renderToStaticMarkup(await AdminPage())
    expect(markup).toContain("no longer")
    expect(markup).toContain("Close preview")
    // The console itself is the ordinary one: the proxy no longer refuses its
    // forms, so its own Log out and account security work again.
    expect(markup).toContain("View a dashboard")
    expect(markup).toContain('href="/account/security"')
    expect(markup).not.toContain('name="signOut"')
    expect(await adminMetadata()).toMatchObject({ title: "Platform owner" })
  })

  it("shows no preview notice on an ordinary visit to the console", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(owner)
    const markup = renderToStaticMarkup(await AdminPage())
    expect(markup).not.toContain("admin-preview-banner")
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

describe("training changes during a preview", () => {
  it("are applied for a previewed coach, so the owner sees the schedule the coach has", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ ...previewedPlayer, role: "coach", subjectId: "coach-1" })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "head_admin" })
    await requireCoachPage()
    expect(mocks.ensureDueTrainingChangesApplied).toHaveBeenCalledTimes(1)
  })

  it("are applied for a previewed player too", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(previewedPlayer)
    await getCurrentStudent()
    expect(mocks.ensureDueTrainingChangesApplied).toHaveBeenCalledTimes(1)
  })
})
