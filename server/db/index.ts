// The only file that knows which Postgres driver is in use.
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema'

export { schema }
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
export type DbDriver = 'pglite' | 'postgres'

const MIGRATIONS = resolve(process.cwd(), 'server/db/migrations')
const PGLITE_DIR = resolve(process.cwd(), '.data/pg')

let current: Promise<Db> | null = null
let currentDriver: DbDriver = process.env.DATABASE_URL ? 'postgres' : 'pglite'

/** Builds a migrated database. `memory` gives a throwaway PGlite for tests. */
export async function createDb(opts: { url?: string, memory?: boolean } = {}): Promise<{ db: Db, driver: DbDriver }> {
  if (opts.url) {
    const db = drizzlePostgres(postgres(opts.url, { max: 5 }), { schema })
    // Prod migrations are a deploy step; dev against a real Postgres still migrates on first use.
    if (import.meta.dev) {
      await migratePostgres(db, { migrationsFolder: MIGRATIONS })
    }
    return { db: db as unknown as Db, driver: 'postgres' }
  }
  if (!opts.memory) {
    mkdirSync(PGLITE_DIR, { recursive: true })
  }
  const client = opts.memory ? new PGlite() : new PGlite(PGLITE_DIR)
  const db = drizzlePglite(client, { schema })
  await migratePglite(db, { migrationsFolder: MIGRATIONS })
  return { db: db as unknown as Db, driver: 'pglite' }
}

/** Lazy singleton; migrations run on the first call rather than at import so nothing needs top-level await. */
export function useDb(): Promise<Db> {
  if (!current) {
    current = createDb({ url: process.env.DATABASE_URL }).then(({ db, driver }) => {
      currentDriver = driver
      return db
    })
    // A failed open must not be cached forever.
    current.catch(() => {
      current = null
    })
  }
  return current
}

export function dbDriver(): DbDriver {
  return currentDriver
}

/** Tests inject an in-memory database; everything that calls useDb() then uses it. */
export function setDb(db: Db, driver: DbDriver = 'pglite') {
  current = Promise.resolve(db)
  currentDriver = driver
}

export async function appliedMigrations(db: Db): Promise<number> {
  try {
    const rows = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)
    // pglite returns { rows }, postgres-js returns the array itself.
    const list = (Array.isArray(rows) ? rows : (rows as unknown as { rows: { n: number }[] }).rows)
    return Number(list[0]?.n ?? 0)
  } catch {
    return 0
  }
}
