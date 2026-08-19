const DEFAULT_ORIGIN = "https://smbaacademy.in"
const REQUEST_TIMEOUT_MS = 15_000

const requestedOrigin = process.argv[2] ?? process.env.SMBA_MONITOR_ORIGIN ?? DEFAULT_ORIGIN
const origin = new URL(requestedOrigin)

if (!/^https?:$/.test(origin.protocol)) {
  throw new Error("The monitored origin must use HTTP or HTTPS.")
}
if (origin.username || origin.password || origin.pathname !== "/") {
  throw new Error("The monitored origin must not contain credentials or a path.")
}

async function request(path) {
  const response = await fetch(new URL(path, origin), {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  return response
}

const healthResponse = await request("/api/health")
if (healthResponse.status !== 200) {
  throw new Error(`Health endpoint returned HTTP ${healthResponse.status}.`)
}
const health = await healthResponse.json()
if (health?.status !== "ok") {
  throw new Error("Health endpoint did not report an operational database.")
}

const loginResponse = await request("/login")
if (loginResponse.status !== 200) {
  throw new Error(`Login page returned HTTP ${loginResponse.status}.`)
}
const loginMarkup = await loginResponse.text()
if (!loginMarkup.includes("Welcome back.")) {
  throw new Error("Login page did not contain the expected application heading.")
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  checks: {
    database: "ok",
    login: "ok",
  },
  origin: origin.origin,
}))
