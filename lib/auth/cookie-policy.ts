export function secureAuthCookiesRequired() {
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") return true
  if (process.env.BETTER_AUTH_SECURE_COOKIES === "false") return false
  if (process.env.BETTER_AUTH_SECURE_COOKIES === "true") return true
  return process.env.NODE_ENV === "production"
}

/*
 * Better Auth's cookie prefix (lib/auth/better-auth.ts). Kept here so code that
 * must read the sign-in cookie without loading the auth runtime -- the proxy in
 * particular -- names it the same way.
 */
export const AUTH_COOKIE_PREFIX = "smba"
