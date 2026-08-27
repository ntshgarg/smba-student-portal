import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

const execute = promisify(execFile)
const servers: Array<ReturnType<typeof createServer>> = []
const smokeScript = new URL("../scripts/operations/check-production.mjs", import.meta.url).pathname

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function originFor(responses: Partial<Record<string, { body: string; status?: number }>>) {
  const server = createServer((request, response) => {
    const configured = responses[request.url ?? ""] ?? { body: "not found", status: 404 }
    response.writeHead(configured.status ?? 200, {
      "content-type": request.url === "/api/health" ? "application/json" : "text/html",
    })
    response.end(configured.body)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.")
  return `http://127.0.0.1:${address.port}`
}

async function runSmoke(origin: string, attempts = 1) {
  return execute(process.execPath, [smokeScript, origin, "--attempts", String(attempts), "--delay-ms", "0"])
}

const healthy = {
  "/": { body: "<h1>Sathiya Moorthy Badminton Academy</h1>" },
  "/api/health": { body: JSON.stringify({ status: "ok" }) },
  "/login": { body: "<h1>Welcome back.</h1>" },
}

describe("public production smoke", () => {
  it("passes only when health, academy identity and login markers are present", async () => {
    const result = await runSmoke(await originFor(healthy))
    expect(JSON.parse(result.stdout)).toMatchObject({
      checks: { database: "ok", homepage: "ok", login: "ok" },
    })
  })

  it("retries a temporarily unhealthy deployment", async () => {
    let healthRequests = 0
    const server = createServer((request, response) => {
      if (request.url === "/api/health") {
        healthRequests += 1
        response.writeHead(healthRequests < 3 ? 503 : 200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: healthRequests < 3 ? "starting" : "ok" }))
        return
      }
      const configured = healthy[request.url as "/" | "/login"]
      response.writeHead(200, { "content-type": "text/html" })
      response.end(configured.body)
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.")

    await expect(runSmoke(`http://127.0.0.1:${address.port}`, 3)).resolves.toBeDefined()
    expect(healthRequests).toBe(3)
  })

  it.each([
    ["health HTTP", { ...healthy, "/api/health": { body: "{}", status: 503 } }, "Health endpoint returned HTTP 503"],
    ["health payload", { ...healthy, "/api/health": { body: JSON.stringify({ status: "down" }) } }, "operational database"],
    ["homepage HTTP", { ...healthy, "/": { body: "down", status: 503 } }, "Homepage returned HTTP 503"],
    ["homepage redirect", { ...healthy, "/": { body: "redirect", status: 302 } }, "Homepage returned HTTP 302"],
    ["homepage identity", { ...healthy, "/": { body: "<h1>Another site</h1>" } }, "academy identity"],
    ["login HTTP", { ...healthy, "/login": { body: "down", status: 503 } }, "Login page returned HTTP 503"],
    ["login heading", { ...healthy, "/login": { body: "<h1>Unknown</h1>" } }, "application heading"],
  ])("fails for an invalid %s response", async (_label, responses, message) => {
    await expect(runSmoke(await originFor(responses))).rejects.toMatchObject({ stderr: expect.stringContaining(message) })
  })

  it.each([
    "ftp://smbaacademy.in",
    "http://smbaacademy.in",
    "https://user:pass@smbaacademy.in",
    "https://smbaacademy.in/login",
    "https://smbaacademy.in?token=secret",
  ])("rejects unsafe monitored origin %s", async (origin) => {
    await expect(runSmoke(origin)).rejects.toBeDefined()
  })
})

/*
 * Preview deployments answer every path with a 302 to Vercel's SSO gate, so the
 * same smoke that guards production could not see one at all. Vercel's
 * documented route through that is a per-project bypass secret sent as a
 * header; these pin that it is sent, that it comes from the environment rather
 * than argv, and that a protected deployment says so instead of reporting a
 * bare 302.
 */
describe("preview deployments behind Vercel SSO", () => {
  it("sends the bypass header when the secret is set, and none when it is not", async () => {
    const seen: Array<Record<string, string | undefined>> = []
    const server = createServer((request, response) => {
      seen.push({
        bypass: request.headers["x-vercel-protection-bypass"] as string | undefined,
        cookie: request.headers["x-vercel-set-bypass-cookie"] as string | undefined,
      })
      const configured = healthy[request.url as keyof typeof healthy]
      response.writeHead(configured ? 200 : 404, {
        "content-type": request.url === "/api/health" ? "application/json" : "text/html",
      })
      response.end(configured?.body ?? "not found")
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("no port")
    const origin = `http://127.0.0.1:${address.port}`

    await execute(process.execPath, [smokeScript, origin, "--attempts", "1", "--delay-ms", "0"], {
      env: { ...process.env, VERCEL_AUTOMATION_BYPASS_SECRET: "secret-value" },
    })
    expect(seen.every((headers) => headers.bypass === "secret-value")).toBe(true)
    expect(seen.every((headers) => headers.cookie === "samesitenone")).toBe(true)

    seen.length = 0
    const withoutSecret = { ...process.env }
    delete withoutSecret.VERCEL_AUTOMATION_BYPASS_SECRET
    await execute(process.execPath, [smokeScript, origin, "--attempts", "1", "--delay-ms", "0"], {
      env: withoutSecret,
    })
    expect(seen.every((headers) => headers.bypass === undefined)).toBe(true)
  })

  it("names the SSO gate instead of reporting a bare redirect", async () => {
    const server = createServer((request, response) => {
      response.writeHead(302, {
        location: `https://vercel.com/sso-api?url=${encodeURIComponent(request.url ?? "/")}`,
      })
      response.end("Redirecting...")
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("no port")

    await expect(
      execute(process.execPath, [
        smokeScript, `http://127.0.0.1:${address.port}`, "--attempts", "1", "--delay-ms", "0",
      ]),
    ).rejects.toThrow(/behind Vercel SSO/u)
  })
})
