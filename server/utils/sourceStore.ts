// Where a paper's fetched or uploaded files go: LaTeX text → `sources` (what the pipeline reads), everything else the
// compiler needs → `source_assets` rows over content-addressed blobs.
import { posix } from 'node:path'
import { eq } from 'drizzle-orm'
import { useDb } from '../db'
import { sourceAssets, sources } from '../db/schema'
import { capAssets, fileBytes } from '../pipeline/sources/main'
import type { SourceFile } from '../pipeline/sources/main'
import { blobStore } from './blobs'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.pdf': 'application/pdf',
  '.eps': 'application/postscript', '.ps': 'application/postscript', '.svg': 'image/svg+xml'
}
export const mimeFor = (path: string) => MIME[posix.extname(path).toLowerCase()] ?? 'application/octet-stream'

/** Replaces a paper's binary assets. Returns the paths skipped for size. */
export async function replaceAssets(paperId: string, assets: SourceFile[]): Promise<{ stored: number, bytes: number, skipped: string[] }> {
  const { kept, skipped } = capAssets(assets.filter(a => a.data))
  const rows: { paperId: string, path: string, blobSha: string, bytes: number }[] = []
  for (const a of kept) {
    rows.push({ paperId, path: a.path, blobSha: await blobStore.put(a.data!, mimeFor(a.path)), bytes: fileBytes(a) })
  }
  const db = await useDb()
  await db.transaction(async (tx) => {
    await tx.delete(sourceAssets).where(eq(sourceAssets.paperId, paperId))
    if (rows.length) {
      await tx.insert(sourceAssets).values(rows)
    }
  })
  return { stored: rows.length, bytes: rows.reduce((n, r) => n + r.bytes, 0), skipped }
}

/** Text sources + assets for a fresh fetch or upload; replaces whatever an earlier run stored. */
export async function storeSources(paperId: string, files: SourceFile[]) {
  const text = files.filter(f => !f.data)
  const db = await useDb()
  await db.transaction(async (tx) => {
    await tx.delete(sources).where(eq(sources.paperId, paperId))
    if (text.length) {
      await tx.insert(sources).values(text.map(f => ({ paperId, path: f.path, content: f.content, bytes: fileBytes(f) })))
    }
  })
  return replaceAssets(paperId, files.filter(f => f.data))
}

/** A paper's assets with their bytes (for the render sandbox). */
export async function loadAssets(paperId: string): Promise<SourceFile[]> {
  const db = await useDb()
  const rows = await db.select({ path: sourceAssets.path, sha: sourceAssets.blobSha }).from(sourceAssets).where(eq(sourceAssets.paperId, paperId))
  const out: SourceFile[] = []
  for (const r of rows) {
    const blob = await blobStore.get(r.sha)
    if (blob) {
      out.push({ path: r.path, content: '', data: blob.data })
    }
  }
  return out
}
