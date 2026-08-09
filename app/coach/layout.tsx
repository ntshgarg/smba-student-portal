import type { Metadata } from "next"

import { CoachShell } from "@/components/coach/coach-shell"
import { UnsavedWorkProvider } from "@/components/unsaved-work-guard"
import { requireCoachPage } from "@/lib/auth/current-coach"

export const metadata: Metadata = {
  title: {
    default: "SMBA Coach Workspace",
    template: "%s | SMBA Coach Workspace",
  },
  description: "The private coaching workspace for SMBA.",
  robots: {
    index: false,
    follow: false,
  },
}

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const { access, identity } = await requireCoachPage()

  const coach = {
    id: identity.subjectId,
    fullName: identity.fullName,
    firstName: identity.firstName,
    initials: identity.initials,
  }

  if (access.accessLevel === "junior_coach") {
    return (
      <UnsavedWorkProvider>
        <CoachShell coach={coach}>{children}</CoachShell>
      </UnsavedWorkProvider>
    )
  }

  return (
    <UnsavedWorkProvider>
      <CoachShell coach={coach}>{children}</CoachShell>
    </UnsavedWorkProvider>
  )
}
