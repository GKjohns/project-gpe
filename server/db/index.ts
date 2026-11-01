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

/**
 * `npm run dev` against a remote Postgres would migrate and sweep prod, so it refuses unless ALLOW_REMOTE_DEV_DB=1.
 * Scripts (tsx) call createDb outside Nuxt, where import.meta.dev is undefined, so they are unaffected.
 */
function assertDevDbIsLocal(url: string) {
  if (!import.meta.dev || process.env.ALLOW_REMOTE_DEV_DB === '1') {
    return
  }
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    // Unparseable: treat as remote.
  }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(`DATABASE_URL points at ${host || 'a non-local host'}; the dev server refuses a remote database. Unset it (PGlite) or set ALLOW_REMOTE_DEV_DB=1.`)
  }
}

/** Builds a migrated database. `memory` gives a throwaway PGlite for tests; `dir` another PGlite directory (scripts). */
export async function createDb(opts: { url?: string, memory?: boolean, dir?: string } = {}): Promise<{ db: Db, driver: DbDriver }> {
  if (opts.url) {
    assertDevDbIsLocal(opts.url)
    // prepare: false because Supavisor's transaction pooler (:6543) has no prepared statements; harmless elsewhere.
    const db = drizzlePostgres(postgres(opts.url, { max: 5, prepare: false }), { schema })
    // Prod migrations are a deploy step; dev against a real Postgres still migrates on first use.
    if (import.meta.dev) {
      await migratePostgres(db, { migrationsFolder: MIGRATIONS })
    }
    return { db: db as unknown as Db, driver: 'postgres' }
  }
  const dir = opts.dir ? resolve(opts.dir) : PGLITE_DIR
  if (!opts.memory) {
    mkdirSync(dir, { recursive: true })
  }
  const client = opts.memory ? new PGlite() : new PGlite(dir)
  const db = drizzlePglite(client, { schema })
  await migratePglite(db, { migrationsFolder: MIGRATIONS })
  return { db: db as unknown as Db, driver: 'pglite' }
}

/** Lazy singleton; migrations run on the first call rather than at import so nothing needs top-level await. */
export function useDb(): Promise<Db> {
  if (!current) {
    // On Vercel an unset DATABASE_URL would silently mean an ephemeral PGlite per instance.
    if (process.env.VERCEL && !process.env.DATABASE_URL) {
      return Promise.reject(new Error('DATABASE_URL is not set on this deployment'))
    }
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
