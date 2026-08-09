import type { AccountRole } from "@/lib/auth/identity"

/**
 * Display-only public chrome data. Never use this response to authorize access.
 */
export type SessionSummaryResponse =
  | { status: "anonymous" }
  | {
    status: "authenticated"
    account: {
      name: string
      initials: string
      role: AccountRole
    }
  }
  | { status: "unavailable" }
