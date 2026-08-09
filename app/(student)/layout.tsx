import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AppShell } from "@/components/app-shell"
import { getCurrentStudent } from "@/lib/student/current-student"

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

  return <AppShell student={student.identity}>{children}</AppShell>
}
