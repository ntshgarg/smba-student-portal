export const publicSiteUrl =
  process.env.NEXT_PUBLIC_SMBA_PUBLIC_SITE_URL ?? "/"

const SITE_ORIGIN_ENV_VAR = "NEXT_PUBLIC_SMBA_SITE_ORIGIN"
const LOCAL_SITE_ORIGIN = "http://localhost:3000"

function invalidSiteOrigin(message: string): Error {
  return new Error(`${SITE_ORIGIN_ENV_VAR} ${message}`)
}

function isLocalOrLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")

  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "localhost.localdomain"
    || normalized === "::1"
    || normalized.startsWith("127.")
    || /^::ffff:7f[0-9a-f]{2}:/.test(normalized)
}

export function resolveSiteOrigin(
  configuredValue: string | undefined,
  nodeEnvironment: string | undefined,
): URL {
  const configuredOrigin = configuredValue?.trim()
  const isProduction = nodeEnvironment === "production"

  if (!configuredOrigin) {
    if (isProduction) {
      throw invalidSiteOrigin(
        "is required in production and must be an absolute HTTPS origin.",
      )
    }

    return new URL(LOCAL_SITE_ORIGIN)
  }

  let origin: URL
  try {
    origin = new URL(configuredOrigin)
  } catch {
    throw invalidSiteOrigin("must be an absolute URL.")
  }

  if (origin.username || origin.password) {
    throw invalidSiteOrigin("must not include credentials.")
  }
  if (origin.href.includes("?")) {
    throw invalidSiteOrigin("must not include a query string.")
  }
  if (origin.href.includes("#")) {
    throw invalidSiteOrigin("must not include a fragment.")
  }
  if (origin.pathname !== "/") {
    throw invalidSiteOrigin("must be an origin without a path.")
  }

  if (isProduction) {
    if (isLocalOrLoopbackHostname(origin.hostname)) {
      throw invalidSiteOrigin("must not use localhost or a loopback address in production.")
    }
    if (origin.protocol !== "https:") {
      throw invalidSiteOrigin("must use HTTPS in production.")
    }
  }

  return origin
}

export const siteOrigin = resolveSiteOrigin(
  process.env.NEXT_PUBLIC_SMBA_SITE_ORIGIN,
  process.env.NODE_ENV,
)

export function absoluteSiteUrl(path = "/") {
  return new URL(path, siteOrigin).toString()
}
