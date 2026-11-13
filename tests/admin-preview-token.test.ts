import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { renderToStaticMarkup } from "react-dom/server"

// What the proxy finds when it checks a preview is still showing.
const database = vi.hoisted(() => ({ lookupFails: false, signedIn: true, viewed: true }))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db/client", async () => {
  const { authRuntimeSessions } = await import("@/lib/db/schema")
  return {
    initializeDatabase: () => ({
      select: () => ({
        from: (table: unknown) => {
          const query = {
            innerJoin: () => query,
            where: () => query,
            get: () => {
              if (database.lookupFails) throw new Error("database unavailable")
              return (table === authRuntimeSessions ? database.signedIn : database.viewed)
                ? { id: "row" }
                : undefined
            },
          }
          return query
        },
      }),
    }),
  }
})
import {
  createAdminPreviewToken,
  readAdminPreviewToken,
} from "@/lib/auth/admin-preview"
import { AdminPreviewBanner } from "@/components/admin-preview-banner"
import { proxy } from "@/proxy"

const SESSION_TOKEN = "ownerSessionToken0123456789abcdef"
// Better Auth's signed cookie value: `token.signature`, URL-encoded.
const SESSION_COOKIE = `smba.session_token=${encodeURIComponent(`${SESSION_TOKEN}.c2lnbmF0dXJlK3NsYXNoLw==`)}`

function livePreviewCookie(now = new Date()) {
  return `smba_admin_preview=${createAdminPreviewToken({
    actorAccountId: "owner",
    sessionToken: SESSION_TOKEN,
    targetAccountId: "player",
  }, now)}`
}

function post(path: string, cookie: string) {
  return proxy(new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { cookie },
  }))
}

function clearsPreviewCookie(response: Response) {
  return /smba_admin_preview=;/u.test(response.headers.get("set-cookie") ?? "")
}

beforeEach(() => {
  database.lookupFails = false
  database.signedIn = true
  database.viewed = true
})

describe("platform-owner preview claims", () => {
  it("binds a short-lived signed preview to its owner, target and sign-in", () => {
    const now = new Date("2026-08-18T12:00:00Z")
    const token = createAdminPreviewToken({
      actorAccountId: "owner",
      sessionToken: SESSION_TOKEN,
      targetAccountId: "player",
    }, now)
    expect(readAdminPreviewToken(token, "owner", SESSION_TOKEN, now)).toMatchObject({
      actorAccountId: "owner",
      targetAccountId: "player",
    })
    expect(readAdminPreviewToken(token, "different-owner", SESSION_TOKEN, now)).toBeNull()
    expect(readAdminPreviewToken(token, "owner", "a-later-sign-in", now)).toBeNull()
    expect(readAdminPreviewToken(token, "owner", null, now)).toBeNull()
    expect(readAdminPreviewToken(`${token}tampered`, "owner", SESSION_TOKEN, now)).toBeNull()
    expect(readAdminPreviewToken(
      token,
      "owner",
      SESSION_TOKEN,
      new Date(now.getTime() + 60 * 60 * 1000 + 1),
    )).toBeNull()
  })

  it("blocks mutations during a live preview while allowing the explicit preview-exit post", async () => {
    const cookie = `${livePreviewCookie()}; ${SESSION_COOKIE}`
    expect((await post("/coach/actions", cookie)).status).toBe(403)
    expect((await post("/login", cookie)).status).toBe(403)
    expect((await post("/admin/preview/exit", cookie)).status).toBe(200)

    const navigation = await proxy(new NextRequest("http://localhost:3000/coach", {
      method: "GET",
      headers: { cookie },
    }))
    expect(navigation.status).toBe(200)
  })

  it("keeps the secure sign-in cookie name working as well", async () => {
    const secureCookie = SESSION_COOKIE.replace("smba.session_token", "__Secure-smba.session_token")
    expect((await post("/coach/actions", `${livePreviewCookie()}; ${secureCookie}`)).status).toBe(403)
  })

  it("clears a leftover preview cookie instead of blocking every form on the browser", async () => {
    // The owner's sign-in is gone: signing in again (or registering, or
    // recovering a password) must still work on this computer.
    const signedOut = await post("/login", livePreviewCookie())
    expect(signedOut.status).toBe(200)
    expect(clearsPreviewCookie(signedOut)).toBe(true)

    // Someone else signed in on the same browser.
    const otherSignIn = await post(
      "/coach/actions",
      `${livePreviewCookie()}; smba.session_token=someoneElse0123456789.sig`,
    )
    expect(otherSignIn.status).toBe(200)
    expect(clearsPreviewCookie(otherSignIn)).toBe(true)

    // Unsigned or expired values.
    expect((await post("/login", `smba_admin_preview=present; ${SESSION_COOKIE}`)).status).toBe(200)
    const expired = await post(
      "/login",
      `${livePreviewCookie(new Date(Date.now() - 2 * 60 * 60 * 1000))}; ${SESSION_COOKIE}`,
    )
    expect(expired.status).toBe(200)
    expect(clearsPreviewCookie(expired)).toBe(true)
  })

  it("stops blocking once the owner's sign-in row is gone or the viewed person is archived", async () => {
    const cookie = `${livePreviewCookie()}; ${SESSION_COOKIE}`

    // "Log out other devices" deleted this browser's sign-in while it previewed.
    database.signedIn = false
    const signedOut = await post("/login", cookie)
    expect(signedOut.status).toBe(200)
    expect(clearsPreviewCookie(signedOut)).toBe(true)

    // The previewed person was archived: Log out and approvals must still go through.
    database.signedIn = true
    database.viewed = false
    const archived = await post("/coach/actions", cookie)
    expect(archived.status).toBe(200)
    expect(clearsPreviewCookie(archived)).toBe(true)
  })

  it("keeps the preview read-only when the lookup itself fails", async () => {
    database.lookupFails = true
    expect((await post("/coach/actions", `${livePreviewCookie()}; ${SESSION_COOKIE}`)).status).toBe(403)
  })

  it("does not expose preview exit as a prefetchable GET link", () => {
    const markup = renderToStaticMarkup(AdminPreviewBanner({ label: "Head coach" }))
    expect(markup).toContain('action="/admin/preview/exit"')
    expect(markup).toContain('method="post"')
    expect(markup).not.toContain('href="/admin/preview/exit"')
  })
})
