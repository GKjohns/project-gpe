// npm run papers:export -- eth logspace intmult unit-distance noncoordinate
// npm run papers:export -- --all     every paper with a digest (the archive); a paper that fails a check is skipped
// Writes .data/export/<slug>.json (papers row, the digest's run with agent_token nulled, its stage_outputs, sources,
// source_assets, blob metadata) and .data/export/blobs/<sha> (raw bytes) for the papers:import task. Stop the dev server first.
// Skips run_events and review_items. Fails unless chunk and outline outputs exist for the digest's run or, failing
// that, an ancestor reached through parent_run_id (whose run and outputs are then exported too).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { blobs, papers, runs, sourceAssets, sources, stageOutputs } from '../server/db/schema'
import type { PaperExport } from '../server/utils/paperImport'
import { openDb } from './db'

const OUT = '.data/export'
const EXPORT_VERSION = 1 // server/utils/paperImport.ts (not imported: it resolves #supabase/server)
const BLOB_URL = /\/api\/blobs\/([0-9a-f]{64})/g
const SHA = /^[0-9a-f]{64}$/

const all = process.argv.includes('--all')
const argSlugs = process.argv.slice(2).filter(a => !a.startsWith('--'))
if (!argSlugs.length && !all) {
  console.log('usage: npm run papers:export -- <slug> [<slug> …] | --all')
  process.exit(1)
}

/** Every `/api/blobs/<sha>` string and every 64-hex value under a key ending in `sha` / `_sha`. */
function blobRefs(value: unknown, into: Set<string>, key = ''): Set<string> {
  if (typeof value === 'string') {
    for (const m of value.matchAll(BLOB_URL)) {
      into.add(m[1]!)
    }
    if (/(^|_)sha$/i.test(key) && SHA.test(value)) {
      into.add(value)
    }
  } else if (Array.isArray(value)) {
    value.forEach(v => blobRefs(v, into, key))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      blobRefs(v, into, k)
    }
  }
  return into
}

const mb = (n: number) => (n / 1048576).toFixed(2)

const { db, close } = await openDb()
try {
  mkdirSync(join(OUT, 'blobs'), { recursive: true })
  const slugs = all
    ? (await db.select({ slug: papers.slug }).from(papers).where(isNotNull(papers.digest)).orderBy(asc(papers.slug))).map(r => r.slug)
    : argSlugs
  let written = 0
  let totalBytes = 0
  for (const slug of slugs) {
    try {
      const [paper] = await db.select().from(papers).where(eq(papers.slug, slug))
      if (!paper) {
        throw new Error(`${slug}: no such paper`)
      }
      const runId = paper.digest?.run_id
      if (!runId) {
        throw new Error(`${slug}: no digest (or digest.run_id) to export`)
      }

      // Walk up parent_run_id until chunk and outline are both covered.
      const runRows: typeof runs.$inferSelect[] = []
      const outputRows: typeof stageOutputs.$inferSelect[] = []
      const need = new Set(['chunk', 'outline'])
      for (let id: string | null = runId; id && need.size;) {
        const [run] = await db.select().from(runs).where(eq(runs.id, id))
        if (!run) {
          throw new Error(`${slug}: run ${id} is missing`)
        }
        if (run.paperId !== paper.id) {
          throw new Error(`${slug}: run ${id} belongs to another paper`)
        }
        const outs = await db.select().from(stageOutputs).where(eq(stageOutputs.runId, id))
        runRows.push({ ...run, agentToken: null })
        outputRows.push(...outs)
        outs.forEach(o => need.delete(o.stage))
        id = run.parentRunId
      }
      if (need.size) {
        throw new Error(`${slug}: no ${[...need].join(' / ')} stage output on run ${runId} or any parent; the explorer can't be served without them`)
      }

      const srcRows = await db.select().from(sources).where(eq(sources.paperId, paper.id))
      const assetRows = await db.select().from(sourceAssets).where(eq(sourceAssets.paperId, paper.id))
      const shas = blobRefs(paper.digest, new Set(assetRows.map(a => a.blobSha)))
      outputRows.forEach(o => blobRefs(o.payload, shas))
      const blobRows = shas.size ? await db.select().from(blobs).where(inArray(blobs.sha, [...shas])) : []
      const missing = [...shas].filter(s => !blobRows.some(b => b.sha === s))
      if (missing.length) {
        throw new Error(`${slug}: referenced blobs not in the blobs table: ${missing.join(', ')}`)
      }

      let blobBytes = 0
      for (const b of blobRows) {
        writeFileSync(join(OUT, 'blobs', b.sha), b.data)
        blobBytes += b.data.byteLength
      }
      const file = {
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        slug,
        papers: [paper],
        runs: runRows,
        stageOutputs: outputRows,
        sources: srcRows,
        sourceAssets: assetRows,
        blobs: blobRows.map(({ data: _data, ...meta }) => meta)
      } as unknown as PaperExport // Dates become the ISO strings PaperExport declares once stringified
      const json = JSON.stringify(file)
      writeFileSync(join(OUT, `${slug}.json`), json)
      console.log(`${slug.padEnd(14)} papers 1, runs ${runRows.length}, stage_outputs ${outputRows.length}, sources ${srcRows.length}, source_assets ${assetRows.length}, blobs ${blobRows.length}  ·  json ${mb(Buffer.byteLength(json))} MB + blobs ${mb(blobBytes)} MB`)
      written++
      totalBytes += Buffer.byteLength(json) + blobBytes
    } catch (err) {
    // --all archives what it can; a named slug that fails still fails the command.
      if (!all) {
        throw err
      }
      console.warn(`skipped ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log(`wrote ${written}/${slugs.length} papers to ${OUT}/ (${mb(totalBytes)} MB, blobs shared by sha counted per paper)`)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await close()
}
