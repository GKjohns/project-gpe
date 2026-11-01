// Loads one papers:export file (.data/export/<slug>.json + blobs/<sha>) into Supabase, UUIDs kept. No transaction:
// every write is by primary key with ignoreDuplicates, in FK order (blob objects → blobs meta → papers → runs →
// stage_outputs → sources → source_assets), so re-running finishes a partial import and a complete one is a no-op.
// Every blob's sha256 and size are checked before anything is written. Run via the papers:import task.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BlobMeta, DbInsert, PaperRow, RunRow, SourceAssetRow, SourceRow, StageOutputRow } from './rows'
import { sha256, storageKeyExists } from './blobs'
import { BLOB_BUCKET, must, useSupabase } from './supabase'

export const EXPORT_VERSION = 1

/** Dates in the row types arrive as ISO strings: the file is JSON.stringify of the Drizzle-era selects. */
type Json<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] }

export interface PaperExport {
  version: typeof EXPORT_VERSION
  exportedAt: string
  slug: string
  papers: Json<PaperRow>[]
  /** The digest's run first, then any ancestors followed for chunk/outline; agent_token always null. */
  runs: Json<RunRow>[]
  stageOutputs: Json<StageOutputRow>[]
  sources: SourceRow[]
  sourceAssets: SourceAssetRow[]
  blobs: Json<BlobMeta>[]
}

export type ImportResult
  = | { slug: string, status: 'imported' | 'unchanged', counts: Record<string, string> }
    | { slug: string, status: 'skipped', reason: string }

/** `n` of `of` rows written (the rest already there); ignoreDuplicates upserts return only the inserted rows. */
const tally = (written: number, of: number) => `${written}/${of}`

export async function importPaper(path: string, blobDir: string): Promise<ImportResult> {
  const file = JSON.parse(await readFile(path, 'utf8')) as PaperExport
  if (file.version !== EXPORT_VERSION) {
    throw new Error(`${path}: export version ${file.version}, expected ${EXPORT_VERSION}`)
  }
  const paper = file.papers[0]
  if (!paper || file.papers.length !== 1) {
    throw new Error(`${path}: expected exactly one paper row`)
  }

  // Verify every blob before any write: a corrupt file writes nothing.
  const blobs = await Promise.all(file.blobs.map(async (meta) => {
    const data = new Uint8Array(await readFile(join(blobDir, meta.sha)))
    const actual = sha256(data)
    if (actual !== meta.sha || data.byteLength !== meta.size) {
      throw new Error(`${path}: blobs/${meta.sha} is corrupt (sha256 ${actual}, ${data.byteLength} bytes; expected ${meta.size}). Nothing from this file was written.`)
    }
    return { meta, data }
  }))

  const supa = useSupabase()
  const existing = must(await supa.from('papers').select('id').eq('slug', file.slug).maybeSingle())
  if (existing && existing.id !== paper.id) {
    return { slug: file.slug, status: 'skipped', reason: `slug exists under another id (${existing.id})` }
  }

  const counts: Record<string, string> = {}

  let uploaded = 0
  for (const { meta, data } of blobs) {
    const { error } = await supa.storage.from(BLOB_BUCKET).upload(meta.sha, data, { contentType: meta.contentType, upsert: false, cacheControl: '31536000' })
    if (error && !storageKeyExists(error as never)) {
      must({ data: null, error })
    }
    uploaded += error ? 0 : 1
  }
  counts.objects = tally(uploaded, blobs.length)

  const blobRows: DbInsert<'blobs'>[] = file.blobs.map(b => ({ sha: b.sha, content_type: b.contentType, size: b.size, created_at: b.createdAt }))
  counts.blobs = tally(blobRows.length ? (must(await supa.from('blobs').upsert(blobRows, { onConflict: 'sha', ignoreDuplicates: true }).select('sha')) ?? []).length : 0, blobRows.length)

  const paperRow: DbInsert<'papers'> = {
    id: paper.id, slug: paper.slug, title: paper.title, authors: paper.authors, source_kind: paper.sourceKind,
    source_ref: paper.sourceRef, tier: paper.tier, digest: paper.digest as never, latest_run_id: paper.latestRunId,
    public: paper.public, manuscript_dir: paper.manuscriptDir, created_at: paper.createdAt, updated_at: paper.updatedAt
  }
  counts.papers = tally((must(await supa.from('papers').upsert(paperRow, { onConflict: 'id', ignoreDuplicates: true }).select('id')) ?? []).length, 1)

  // Ancestors first; parent_run_id has no FK, but the order reads naturally in the target.
  const runRows: DbInsert<'runs'>[] = [...file.runs].reverse().map(r => ({
    id: r.id, paper_id: r.paperId, parent_run_id: r.parentRunId, status: r.status, stage: r.stage, profile: r.profile,
    structure_method: r.structureMethod, progress: r.progress as never, metrics: r.metrics as never, budget_usd: r.budgetUsd,
    cost_usd: r.costUsd, error: r.error, agent_token: null, started_at: r.startedAt, finished_at: r.finishedAt
  }))
  counts.runs = tally((must(await supa.from('runs').upsert(runRows, { onConflict: 'id', ignoreDuplicates: true }).select('id')) ?? []).length, runRows.length)

  // One stage output per request: payloads run to ~1 MB each, so a batch would be one multi-MB body.
  let outputs = 0
  for (const o of file.stageOutputs) {
    const row: DbInsert<'stage_outputs'> = { run_id: o.runId, stage: o.stage, payload: o.payload as never, created_at: o.createdAt }
    outputs += (must(await supa.from('stage_outputs').upsert(row, { onConflict: 'run_id,stage', ignoreDuplicates: true }).select('run_id')) ?? []).length
  }
  counts.stage_outputs = tally(outputs, file.stageOutputs.length)

  const sourceRows: DbInsert<'sources'>[] = file.sources.map(s => ({ id: s.id, paper_id: s.paperId, path: s.path, content: s.content, bytes: s.bytes }))
  counts.sources = tally(sourceRows.length ? (must(await supa.from('sources').upsert(sourceRows, { onConflict: 'id', ignoreDuplicates: true }).select('id')) ?? []).length : 0, sourceRows.length)

  const assetRows: DbInsert<'source_assets'>[] = file.sourceAssets.map(a => ({ id: a.id, paper_id: a.paperId, path: a.path, blob_sha: a.blobSha, bytes: a.bytes }))
  counts.source_assets = tally(assetRows.length ? (must(await supa.from('source_assets').upsert(assetRows, { onConflict: 'id', ignoreDuplicates: true }).select('id')) ?? []).length : 0, assetRows.length)

  const wrote = Object.values(counts).some(c => !c.startsWith('0/'))
  return { slug: file.slug, status: wrote ? 'imported' : 'unchanged', counts }
}
