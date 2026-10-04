import { cache } from "react"

import { createStudentIdentity } from "@/lib/auth/identity"
import { portalRepository, sessionProvider } from "@/lib/data"
import { ensureDueTrainingChangesApplied } from "@/lib/training/changes"

export const getCurrentStudent = cache(async () => {
  const session = await sessionProvider.getCurrentIdentity()
  if (!session || session.role !== "player") return null
  if (!session.previewMode) ensureDueTrainingChangesApplied()

  const identity = createStudentIdentity(session)

  const profile = await portalRepository.getPlayer(identity.playerId)
  if (!profile) return null

  return { identity, profile }
})
