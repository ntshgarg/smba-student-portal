import type { Metadata } from "next"

import { CoachShell } from "@/components/coach/coach-shell"
import { AdminPreviewBanner, adminPreviewLabel } from "@/components/admin-preview-banner"
import { UnsavedWorkProvider } from "@/components/unsaved-work-guard"
import { requireCoachPage } from "@/lib/auth/current-coach"
import { recoveryEmailEnrollmentRequired } from "@/lib/auth/recovery-service"
import { redirect } from "next/navigation"

import "../portal.css"

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
  if (!identity.previewMode && recoveryEmailEnrollmentRequired(identity.subjectId)) {
    redirect("/account/recovery-email/setup")
  }

  const coach = {
    id: identity.subjectId,
    fullName: identity.fullName,
    firstName: identity.firstName,
    initials: identity.initials,
  }

  const previewBanner = identity.previewMode ? (
    <AdminPreviewBanner label={adminPreviewLabel({
      coachAccessLevel: access.accessLevel,
      fullName: identity.fullName,
      role: "coach",
    })} />
  ) : null

  if (access.accessLevel === "junior_coach") {
    return (
      <>
        {previewBanner}
        <UnsavedWorkProvider>
          <CoachShell coach={coach} previewMode={identity.previewMode === true}>{children}</CoachShell>
        </UnsavedWorkProvider>
      </>
    )
  }

  return (
    <>
      {previewBanner}
      <UnsavedWorkProvider>
        <CoachShell coach={coach} previewMode={identity.previewMode === true}>{children}</CoachShell>
      </UnsavedWorkProvider>
    </>
  )
}
