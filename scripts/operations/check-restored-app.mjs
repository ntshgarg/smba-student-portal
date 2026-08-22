const [originArgument] = process.argv.slice(2)
const origin = new URL(originArgument || "http://127.0.0.1:3103")
if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1"
  || origin.port !== "3103" || origin.username || origin.password
  || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error("The restored-application smoke target must be http://127.0.0.1:3103.")
}

async function response(pathname) {
  const result = await fetch(new URL(pathname, origin), {
    headers: { "user-agent": "smba-stored-backup-restore-verifier" },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  })
  if (result.status !== 200) throw new Error(`${pathname} returned HTTP ${result.status}.`)
  return result
}

const health = await response("/api/health")
const payload = await health.json()
if (payload?.status !== "ok") throw new Error("The restored database health payload is invalid.")

const login = await response("/login")
const body = await login.text()
if (!/Sign in to SMBA|Welcome back/u.test(body)) {
  throw new Error("The restored application login page is missing its expected heading.")
}

process.stdout.write("Restored application health and login smoke passed.\n")
