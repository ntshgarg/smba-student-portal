import { pathToFileURL } from "node:url"

export const DEFAULT_ORIGIN = "https://smbaacademy.in"
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000

export function validateMonitoredOrigin(value) {
  const origin = new URL(value)
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(origin.hostname)
  if (origin.protocol !== "https:" && !(loopback && origin.protocol === "http:")) {
    throw new Error("The monitored origin must use HTTPS, except for a loopback test server.")
  }
  if (origin.username || origin.password) {
    throw new Error("The monitored origin must not contain credentials.")
  }
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("The monitored origin must not contain a path, query or fragment.")
  }
  return origin
}

async function request(origin, pathname, timeoutMs) {
  return fetch(new URL(pathname, origin), {
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  })
}

export async function checkProductionOnce(originValue, options = {}) {
  const origin = validateMonitoredOrigin(originValue)
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  const healthResponse = await request(origin, "/api/health", timeoutMs)
  if (healthResponse.status !== 200) {
    throw new Error(`Health endpoint returned HTTP ${healthResponse.status}.`)
  }
  const health = await healthResponse.json().catch(() => null)
  if (health?.status !== "ok") {
    throw new Error("Health endpoint did not report an operational database.")
  }

  const homeResponse = await request(origin, "/", timeoutMs)
  if (homeResponse.status !== 200) {
    throw new Error(`Homepage returned HTTP ${homeResponse.status}.`)
  }
  const homeMarkup = await homeResponse.text()
  if (!homeMarkup.includes("Sathiya Moorthy Badminton Academy")) {
    throw new Error("Homepage did not contain the expected academy identity.")
  }

  const loginResponse = await request(origin, "/login", timeoutMs)
  if (loginResponse.status !== 200) {
    throw new Error(`Login page returned HTTP ${loginResponse.status}.`)
  }
  const loginMarkup = await loginResponse.text()
  if (!loginMarkup.includes("Welcome back.")) {
    throw new Error("Login page did not contain the expected application heading.")
  }

  return {
    checkedAt: new Date().toISOString(),
    checks: { database: "ok", homepage: "ok", login: "ok" },
    origin: origin.origin,
  }
}

export async function checkProduction(originValue, options = {}) {
  const attempts = options.attempts ?? 1
  const delayMs = options.delayMs ?? 0
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new Error("Smoke attempts must be an integer from 1 to 20.")
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
    throw new Error("Smoke retry delay must be an integer from 0 to 60000 milliseconds.")
  }

  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await checkProductionOnce(originValue, options)
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

function numericArgument(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isSafeInteger(value)) throw new Error(`${name} requires an integer value.`)
  return value
}

const executedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (executedDirectly) {
  const requestedOrigin = process.argv[2]?.startsWith("--")
    ? process.env.SMBA_MONITOR_ORIGIN ?? DEFAULT_ORIGIN
    : process.argv[2] ?? process.env.SMBA_MONITOR_ORIGIN ?? DEFAULT_ORIGIN
  const result = await checkProduction(requestedOrigin, {
    attempts: numericArgument("--attempts", 1),
    delayMs: numericArgument("--delay-ms", 0),
  })
  console.log(JSON.stringify(result))
}
