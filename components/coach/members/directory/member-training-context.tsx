"use client"

import { createContext, useContext, type ReactNode } from "react"

import type { MemberTrainingSummaries } from "@/lib/training/member-summaries"

/*
 * Each player's scheduled change and fee summary, loaded once for the whole
 * directory on the server and read by the expanded record. A context rather
 * than props, because the record sits several components below the page and
 * the directory's own props are already player-shaped.
 */
const MemberTrainingContext = createContext<MemberTrainingSummaries | null>(null)

export function MemberTrainingProvider({
  children,
  value,
}: {
  children: ReactNode
  value: MemberTrainingSummaries
}) {
  return <MemberTrainingContext.Provider value={value}>{children}</MemberTrainingContext.Provider>
}

export function useMemberTraining() {
  return useContext(MemberTrainingContext)
}
