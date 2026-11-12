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
      /*
       * The platform owner is viewing this person's dashboard. Every form but
       * Exit preview is switched off, so the public header's sign-out has to
       * leave through that exit rather than the ordinary sign-out.
       */
      previewMode?: true
      role: AccountRole
    }
  }
  | { status: "unavailable" }
