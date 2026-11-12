type ReadableDatabase = {
  prepare(sql: string): {
    all(...parameters: unknown[]): Array<Record<string, unknown>>
  }
  transaction<T>(read: () => T): () => T
}

export const PLATFORM_OWNER_ACADEMY_ID: string

export const soleOwnerQuery: string

export function readConsistently<T>(database: ReadableDatabase, read: () => T): T

export function ownerSignInDetails(database: ReadableDatabase, ownerId: string): string
