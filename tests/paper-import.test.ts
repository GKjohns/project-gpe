import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sha256 } from '../server/utils/blobs'
import { importPaper } from '../server/utils/paperImport'
import type { PaperExport } from '../server/utils/paperImport'
import { setSupabase } from '../server/utils/supabase'
import { createFakeSupabase } from './helpers/fakeSupabase'

const paperId = '00000000-0000-4000-8000-0000000000c1'
const runId = '00000000-0000-4000-8000-0000000000c2'
const ts = '2026-10-29T18:04:52.251Z'
const bytes = new Uint8Array([1, 2, 3, 4, 5])
const sha = sha256(bytes)

let fake: ReturnType<typeof createFakeSupabase>
let dir: string

function exportFile(over: Partial<PaperExport> = {}): string {
  const file: PaperExport = {
    version: 1,
    exportedAt: ts,
    slug: 'demo',
    papers: [{ id: paperId, slug: 'demo', title: 'Demo', authors: ['A'], sourceKind: 'arxiv', sourceRef: 'x', tier: null, digest: null, latestRunId: runId, public: true, manuscriptDir: null, createdAt: ts, updatedAt: ts }],
    runs: [{ id: runId, paperId, parentRunId: null, status: 'done', stage: null, profile: 'full', structureMethod: 'pipeline', progress: {}, metrics: null, budgetUsd: 5, costUsd: 0.5, error: null, agentToken: 'secret', startedAt: ts, finishedAt: ts }],
    stageOutputs: [{ runId, stage: 'chunk', payload: { n: 1 }, createdAt: ts }, { runId, stage: 'outline', payload: { n: 2 }, createdAt: ts }],
    sources: [{ id: '00000000-0000-4000-8000-0000000000c3', paperId, path: 'main.tex', content: 'x', bytes: 1 }],
    sourceAssets: [{ id: '00000000-0000-4000-8000-0000000000c4', paperId, path: 'fig.png', blobSha: sha, bytes: 5 }],
    blobs: [{ sha, contentType: 'image/png', size: 5, createdAt: ts }],
    ...over
  } as PaperExport
  const path = join(dir, `${file.slug}.json`)
  writeFileSync(path, JSON.stringify(file))
  return path
}

beforeEach(() => {
  fake = createFakeSupabase()
  setSupabase(fake.client)
  dir = mkdtempSync(join(tmpdir(), 'gpe-import-'))
  mkdirSync(join(dir, 'blobs'))
  writeFileSync(join(dir, 'blobs', sha), bytes)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('importPaper', () => {
  it('writes every table in snake_case, keeps ids and timestamps, nulls agent_token; a re-run writes nothing', async () => {
    const path = exportFile()
    const first = await importPaper(path, join(dir, 'blobs'))
    expect(first).toEqual({ slug: 'demo', status: 'imported', counts: { objects: '1/1', blobs: '1/1', papers: '1/1', runs: '1/1', stage_outputs: '2/2', sources: '1/1', source_assets: '1/1' } })
    expect(fake.tables.papers![0]).toMatchObject({ id: paperId, latest_run_id: runId, public: true, created_at: ts })
    expect(fake.tables.runs![0]).toMatchObject({ id: runId, agent_token: null, cost_usd: 0.5, structure_method: 'pipeline' })
    expect(fake.tables.source_assets![0]).toMatchObject({ blob_sha: sha })
    expect(fake.objects.get(`blobs/${sha}`)?.bytes).toEqual(bytes)

    const again = await importPaper(path, join(dir, 'blobs'))
    expect(again.status).toBe('unchanged')
    expect(fake.tables.stage_outputs).toHaveLength(2)
  })

  it('writes nothing when a blob is corrupt', async () => {
    writeFileSync(join(dir, 'blobs', sha), new Uint8Array([9, 9, 9, 9, 9]))
    await expect(importPaper(exportFile(), join(dir, 'blobs'))).rejects.toThrow(/corrupt/)
    expect(fake.tables.papers ?? []).toHaveLength(0)
    expect(fake.objects.size).toBe(0)
  })

  it('skips a slug that exists under another id', async () => {
    fake.tables.papers = [{ id: '00000000-0000-4000-8000-0000000000ff', slug: 'demo', title: 'Other', authors: [], source_kind: 'arxiv', source_ref: 'y', tier: null, digest: null, latest_run_id: null, public: false, manuscript_dir: null, created_at: ts, updated_at: ts }]
    const r = await importPaper(exportFile(), join(dir, 'blobs'))
    expect(r.status).toBe('skipped')
    expect(fake.tables.runs ?? []).toHaveLength(0)
  })
})
