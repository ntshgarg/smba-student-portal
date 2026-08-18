export function secureAuthCookiesRequired() {
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") return true
  if (process.env.BETTER_AUTH_SECURE_COOKIES === "false") return false
  if (process.env.BETTER_AUTH_SECURE_COOKIES === "true") return true
  return process.env.NODE_ENV === "production"
}
