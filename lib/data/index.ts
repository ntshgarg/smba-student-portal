import { DatabaseSessionProvider } from "@/lib/auth/session"
import { SqlitePortalRepository } from "@/lib/data/sqlite-portal-repository"
import type { PortalRepository } from "@/lib/data/portal-repository"

export const portalRepository: PortalRepository = new SqlitePortalRepository()
export const sessionProvider = new DatabaseSessionProvider()
