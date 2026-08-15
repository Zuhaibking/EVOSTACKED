import type { PoolConfig } from 'pg'

export function createPgPoolConfig(
  connectionString = process.env.DATABASE_URL,
): PoolConfig {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required')
  }

  return {
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  }
}
