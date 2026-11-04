import type {
  DashboardSnapshot,
  PlayerProfile,
  ProgressJourney,
} from "@/lib/types"

export interface PortalRepository {
  getPlayer(playerId: string): Promise<PlayerProfile | null>
  getDashboard(playerId: string): Promise<DashboardSnapshot | null>
  getProgress(playerId: string): Promise<ProgressJourney | null>
}
