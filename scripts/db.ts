// Opens the app's database for an operator script: Postgres when DATABASE_URL is set (the npm scripts load .env),
// otherwise the dev PGlite in .data/pg. PGlite is single-process, so it refuses while `npm run dev` holds it.
// SCRIPT_PGLITE_DIR=<dir> points a script at another PGlite directory (created and migrated on first open), e.g. a
// throwaway target for testing papers:import. Only scripts read it; the app always uses .data/pg.
import { createDb } from '../server/db'
import type { Db } from '../server/db'

export async function openDb(): Promise<{ db: Db, close: () => Promise<void> }> {
  const url = process.env.DATABASE_URL
  const dir = url ? undefined : process.env.SCRIPT_PGLITE_DIR
  if (!url && !dir) {
    const port = process.env.PORT || process.env.NUXT_PORT || '3120'
    const devUp = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(800) }).then(() => true, () => false)
    if (devUp) {
      console.error(`The dev server on :${port} has .data/pg open (PGlite is single-process). Stop it first, or set DATABASE_URL.`)
      process.exit(1)
    }
  }
  const { db } = await createDb({ url, dir })
  const client = (db as unknown as { $client?: { end?: () => Promise<void>, close?: () => Promise<void> } }).$client
  return { db, close: async () => await (client?.end ?? client?.close)?.call(client) }
}
