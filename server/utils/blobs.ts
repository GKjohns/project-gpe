// Content-addressed binary storage in Postgres (bytea). Small (PDFs ~1 MB, figure PNGs ~100 KB), transactional with the
// rest of the data, and identical under PGlite and Postgres; /api/blobs/<sha> serves it with Range support.
import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { useDb } from '../db'
import { blobs } from '../db/schema'

export const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

/** Stores bytes once; returns their sha. */
async function put(data: Uint8Array, contentType: string): Promise<string> {
  const sha = sha256(data)
  const db = await useDb()
  await db.insert(blobs).values({ sha, contentType, size: data.byteLength, data }).onConflictDoNothing()
  return sha
}

async function meta(sha: string): Promise<{ contentType: string, size: number } | null> {
  const db = await useDb()
  const [row] = await db.select({ contentType: blobs.contentType, size: blobs.size }).from(blobs).where(eq(blobs.sha, sha))
  return row ?? null
}

async function get(sha: string): Promise<{ contentType: string, data: Uint8Array } | null> {
  const db = await useDb()
  const [row] = await db.select({ contentType: blobs.contentType, data: blobs.data }).from(blobs).where(eq(blobs.sha, sha))
  return row ? { contentType: row.contentType, data: new Uint8Array(row.data) } : null
}

/** Bytes start..end (inclusive), read with substring() so a range request never loads the whole PDF. */
async function range(sha: string, start: number, end: number): Promise<Uint8Array | null> {
  const db = await useDb()
  const [row] = await db.select({ data: sql<Uint8Array>`substring(${blobs.data} from ${start + 1} for ${end - start + 1})` })
    .from(blobs).where(eq(blobs.sha, sha))
  return row ? new Uint8Array(row.data) : null
}

export const blobUrl = (sha: string) => `/api/blobs/${sha}`

// A namespace object so Nitro's auto-import doesn't put bare `get` / `put` in global scope.
export const blobStore = { put, get, meta, range }
