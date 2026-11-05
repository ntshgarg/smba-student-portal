import "server-only"

/*
 * The one place BETTER_AUTH_SECRET is read.
 *
 * Five modules keyed HMACs off this variable, and only the auth runtime refused
 * to start without it. The other four -- email-code and recovery hashes, the
 * credential hashes, the Academy-ID and address hashes in the audit trail, and
 * the admin-preview token -- each did `process.env.BETTER_AUTH_SECRET || "<a
 * string published in this repository>"`, so a deployment that lost the variable
 * kept running and quietly keyed those hashes and the preview signature off a
 * public value. Everything now goes through here, so they all fail the same way
 * the auth runtime does.
 *
 * `localFallback` is each caller's own legacy value rather than one shared
 * constant, on purpose: hashes already stored in a local fixture database were
 * written with those exact strings, and changing them would orphan every
 * activation claim and audit subject in it. The fallback is only ever returned
 * where a published value is acceptable -- never on Vercel, and never in a
 * production build unless SMBA_ALLOW_LOCAL_AUTH_SECRET=true says it is a
 * disposable fixture.
 */

// `next build` and `next start` both set NODE_ENV=production for a purely local
// artifact, so NODE_ENV alone cannot decide whether a published fallback value
// is acceptable. coachTotpRequired below resolves the same ambiguity by reading an
// explicit variable before falling back to NODE_ENV; mirror that ordering here.
// `npm run build` and the three fixture:start:* commands declare the opt-in
// because they only ever serve a disposable local fixture.
function localAuthSecretAllowed() {
  if (process.env.SMBA_ALLOW_LOCAL_AUTH_SECRET === "true") return true
  if (process.env.SMBA_ALLOW_LOCAL_AUTH_SECRET === "false") return false
  return process.env.NODE_ENV !== "production"
}

export function resolveAuthSecret(localFallback: string) {
  if (process.env.VERCEL === "1"
    && process.env.VERCEL_ENV === "production"
    && process.env.PROTOTYPE_ACADEMY_ID_AUTH === "true") {
    throw new Error("Prototype Academy-ID-only authentication must not be enabled in production.")
  }
  const configured = process.env.BETTER_AUTH_SECRET?.trim()
  if (configured) {
    if (configured.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.")
    }
    return configured
  }

  if (process.env.VERCEL === "1") {
    throw new Error("BETTER_AUTH_SECRET is required for a Vercel deployment.")
  }
  // A self-hosted deployment has no VERCEL variable, and this secret signs
  // sessions and encrypts TOTP material, so fail rather than silently use a
  // value published in this repository. This throws on the first request that
  // loads this module, not at boot -- Next.js evaluates route modules lazily and
  // app/api/health/route.ts does not import it, so an unconfigured deployment
  // still comes up and still reports healthy.
  if (!localAuthSecretAllowed()) {
    throw new Error(
      "BETTER_AUTH_SECRET is required in production. Set SMBA_ALLOW_LOCAL_AUTH_SECRET=true"
      + " only to serve a disposable local fixture from a production build.",
    )
  }
  return localFallback
}
