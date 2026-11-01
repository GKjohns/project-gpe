// Where a paper's fetched or uploaded files go: LaTeX text → `sources` (what the pipeline reads), everything else the
// compiler needs → `source_assets` rows over content-addressed blobs.
import { posix } from 'node:path'
import { capAssets, fileBytes } from '../pipeline/sources/main'
import type { SourceFile } from '../pipeline/sources/main'
import { blobStore } from './blobs'
import { must, selectAll, useSupabase } from './supabase'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.pdf': 'application/pdf',
  '.eps': 'application/postscript', '.ps': 'application/postscript', '.svg': 'image/svg+xml'
}
export const mimeFor = (path: string) => MIME[posix.extname(path).toLowerCase()] ?? 'application/octet-stream'

/**
 * No transactions over PostgREST: insert the new rows, then delete the rows the paper had before. There's never a
 * moment with zero sources, and a crash in between leaves extra rows that the next fetch removes.
 */
async function replaceRows(table: 'sources' | 'source_assets', paperId: string, rows: Record<string, unknown>[]) {
  const supa = useSupabase()
  const old = (await selectAll(async (from, to) => await supa.from(table).select('id').eq('paper_id', paperId).order('id').range(from, to))).map(r => r.id)
  if (rows.length) {
    must(await supa.from(table).insert(rows as never))
  }
  // Chunked so the id list stays well inside PostgREST's URL limit.
  for (let i = 0; i < old.length; i += 200) {
    must(await supa.from(table).delete().in('id', old.slice(i, i + 200)))
  }
}

/** Replaces a paper's binary assets. Returns the paths skipped for size. */
export async function replaceAssets(paperId: string, assets: SourceFile[]): Promise<{ stored: number, bytes: number, skipped: string[] }> {
  const { kept, skipped } = capAssets(assets.filter(a => a.data))
  const rows: { paper_id: string, path: string, blob_sha: string, bytes: number }[] = []
  for (const a of kept) {
    rows.push({ paper_id: paperId, path: a.path, blob_sha: await blobStore.put(a.data!, mimeFor(a.path)), bytes: fileBytes(a) })
  }
  await replaceRows('source_assets', paperId, rows)
  return { stored: rows.length, bytes: rows.reduce((n, r) => n + r.bytes, 0), skipped }
}

/** Text sources + assets for a fresh fetch or upload; replaces whatever an earlier run stored. */
export async function storeSources(paperId: string, files: SourceFile[]) {
  const text = files.filter(f => !f.data)
  await replaceRows('sources', paperId, text.map(f => ({ paper_id: paperId, path: f.path, content: f.content, bytes: fileBytes(f) })))
  return replaceAssets(paperId, files.filter(f => f.data))
}

/** A paper's LaTeX text files, by path (what chunk, outline, extract, resolve, critique, render and finalize read). */
export async function loadSourceText(paperId: string): Promise<{ path: string, content: string }[]> {
  return selectAll(async (from, to) => await useSupabase().from('sources').select('path, content').eq('paper_id', paperId).order('path').order('id').range(from, to))
}

/** A paper's assets with their bytes (for the render sandbox). */
export async function loadAssets(paperId: string): Promise<SourceFile[]> {
  const rows = must(await useSupabase().from('source_assets').select('path, blob_sha').eq('paper_id', paperId).order('path'))
  const out: SourceFile[] = []
  for (const r of rows) {
    const blob = await blobStore.get(r.blob_sha)
    if (blob) {
      out.push({ path: r.path, content: '', data: blob.data })
    }
  }
  return out
}
