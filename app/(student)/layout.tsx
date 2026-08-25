import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AppShell } from "@/components/app-shell"
import { AdminPreviewBanner } from "@/components/admin-preview-banner"
import { getCurrentStudent } from "@/lib/student/current-student"
import { recoveryEmailEnrollmentRequired } from "@/lib/auth/recovery-service"

import "../portal.css"

export const metadata: Metadata = {
  title: {
    default: "SMBA Player Journal",
    template: "%s | SMBA Player Journal",
  },
  description: "A personal training journal for SMBA players.",
  robots: {
    index: false,
    follow: false,
  },
}

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const student = await getCurrentStudent()

  if (!student) redirect("/login")
  if (!student.identity.previewMode && recoveryEmailEnrollmentRequired(student.identity.playerId)) {
    redirect("/account/recovery-email/setup")
  }

  return (
    <>
      {student.identity.previewMode ? (
        <AdminPreviewBanner label={`${student.identity.fullName} · Player`} />
      ) : null}
      <AppShell student={student.identity}>{children}</AppShell>
    </>
  )
}
