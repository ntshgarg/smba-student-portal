import { pathToFileURL } from "node:url"

export const DEFAULT_ORIGIN = "https://smbaacademy.in"
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000

// A loopback origin is answered by a process on this machine. It is the one
// case where there is no third-party deployment on the other end -- which is
// why it may be plain HTTP below, and why the bypass gate exempts it.
const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "::1"]

export function validateMonitoredOrigin(value) {
  const origin = new URL(value)
  const loopback = LOOPBACK_HOSTNAMES.includes(origin.hostname)
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

/*
 * Preview deployments sit behind Vercel SSO, so every path answers 302 to
 * vercel.com/sso-api rather than the application. Vercel's documented way
 * through that for automation is a per-project bypass secret sent as a header.
 *
 * It is read from the environment and never accepted on the command line,
 * because argv is visible to any process on the machine and lands in CI logs
 * whenever a step echoes its own command. Production has no protection, so the
 * header is simply absent there and the same script serves both.
 */
export const BYPASS_ENVIRONMENT_VARIABLE = "VERCEL_AUTOMATION_BYPASS_SECRET"

/*
 * The bypass header travels *to* the deployment, so whoever wrote the code that
 * deployment is running reads the secret straight out of the inbound request.
 * For a fork pull request that is someone with no write access here.
 *
 * That is the half of the preview-smoke hole that pinning the checkout ref did
 * not close: pinning the ref stopped a stranger's code running on the runner,
 * but the direction of this leak is the request, not the response, so it
 * survived. Reaching the preview "over HTTP as data" describes what comes back,
 * not what is sent.
 *
 * So the caller has to state that the deployment under test was built from code
 * this repository trusts. .github/workflows/preview-smoke.yml establishes that
 * by asking GitHub whether the deployed commit is the head of a branch here or
 * is already on the default branch, and passes that answer through -- never a
 * hard-coded "true". Anything other than "true", including the variable being
 * absent, and the credential stays on the runner.
 *
 * Refusing loudly rather than quietly dropping the header matters: a dropped
 * header makes the preview answer Vercel's SSO redirect, and this script would
 * then report "the deployment is behind Vercel SSO, set
 * VERCEL_AUTOMATION_BYPASS_SECRET" -- advice that points whoever reads it
 * straight back at the gate.
 */
export const BYPASS_TRUST_ENVIRONMENT_VARIABLE = "SMBA_DEPLOYMENT_TRUSTED"

export function bypassHeaders(origin, environment = process.env) {
  const secret = environment[BYPASS_ENVIRONMENT_VARIABLE]?.trim()
  if (!secret) return {}

  if (!LOOPBACK_HOSTNAMES.includes(origin.hostname)
    && environment[BYPASS_TRUST_ENVIRONMENT_VARIABLE] !== "true") {
    throw new Error(
      `${BYPASS_ENVIRONMENT_VARIABLE} is set but ${BYPASS_TRUST_ENVIRONMENT_VARIABLE} is not "true", `
      + `so nothing was sent to ${origin.origin}. The protection bypass secret is only given to a `
      + "deployment built from code this repository trusts, because the deployment reads it out of "
      + "the request header. An untrusted preview has to be reported as not verified instead.",
    )
  }

  // Only the bypass header. Asking Vercel to also set the bypass cookie makes
  // it answer with a redirect in order to deliver that cookie, which a smoke
  // reading `redirect: "manual"` sees as a 307 rather than the application --
  // and the cookie is pointless here, because every request below carries the
  // header anyway.
  return { "x-vercel-protection-bypass": secret }
}

async function request(origin, pathname, timeoutMs, headers) {
  return fetch(new URL(pathname, origin), {
    cache: "no-store",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  })
}

export async function checkProductionOnce(originValue, options = {}) {
  const origin = validateMonitoredOrigin(originValue)
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  // Resolved once, before the first request, so the gate cannot be satisfied
  // for one path and not another.
  const headers = bypassHeaders(origin, options.environment)

  const healthResponse = await request(origin, "/api/health", timeoutMs, headers)
  if (healthResponse.status !== 200) {
    const target = healthResponse.headers.get("location") ?? ""
    if (target.startsWith("https://vercel.com/sso-api")) {
      throw new Error(
        "The deployment is behind Vercel SSO. Set "
        + `${BYPASS_ENVIRONMENT_VARIABLE} to the project's protection bypass secret.`,
      )
    }
    throw new Error(
      `Health endpoint returned HTTP ${healthResponse.status}`
      + `${target ? `, redirecting to ${target}` : ""}.`,
    )
  }
  const health = await healthResponse.json().catch(() => null)
  if (health?.status !== "ok") {
    throw new Error("Health endpoint did not report an operational database.")
  }

  const homeResponse = await request(origin, "/", timeoutMs, headers)
  if (homeResponse.status !== 200) {
    throw new Error(`Homepage returned HTTP ${homeResponse.status}.`)
  }
  const homeMarkup = await homeResponse.text()
  if (!homeMarkup.includes("Sathiya Moorthy Badminton Academy")) {
    throw new Error("Homepage did not contain the expected academy identity.")
  }

  const loginResponse = await request(origin, "/login", timeoutMs, headers)
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

  // Both of these fail the same way on every attempt, so raise them before the
  // loop: retrying an unaffirmed target for six attempts across thirty seconds
  // would bury the reason under five identical failures.
  bypassHeaders(validateMonitoredOrigin(originValue), options.environment)

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
