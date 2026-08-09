import type {
  DashboardSnapshot,
  MonthlyReport,
  PlayerProfile,
  PlayerReportArchiveItem,
  ProgressJourney,
} from "@/lib/types"

export interface PortalRepository {
  getPlayer(playerId: string): Promise<PlayerProfile | null>
  getDashboard(playerId: string): Promise<DashboardSnapshot | null>
  getProgress(playerId: string): Promise<ProgressJourney | null>
  listReports(playerId: string): Promise<PlayerReportArchiveItem[]>
  getReport(playerId: string, reportId: string): Promise<MonthlyReport | null>
}
