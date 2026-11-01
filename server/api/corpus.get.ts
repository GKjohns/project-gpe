import type { CorpusResponse, CorpusRow, CorpusRun } from '#shared/corpus'
import { corpusPaperSlugs } from '#shared/corpus'
import type { StructureMethod } from '#shared/types'
import { ACTIVE_RUN_STATUSES } from '#shared/runs'
import { runRow } from '../utils/rows'
import type { RunRow } from '../utils/rows'
import { must, selectAll, useSupabase } from '../utils/supabase'
import { defaultMethodFor, defaultProfileFor } from '../utils/aiModels'
import { corpusManifest } from '../utils/corpus'

const METHODS: StructureMethod[] = ['pipeline', 'agent']

/**
 * Which run represents an entry × method: the newest active run; else the newest finished run that made
 * model calls (a $0 finalize-only re-run or a pre-Sprint-4 stub doesn't speak for the method); else the newest
 * failed/cancelled run.
 */
function pickRun(candidates: RunRow[]): RunRow | undefined {
  return candidates.find(r => ACTIVE_RUN_STATUSES.includes(r.status))
    ?? candidates.find(r => (r.status === 'complete' || r.status === 'structure_partial') && (r.metrics?.calls ?? 0) > 0)
    ?? candidates.find(r => r.status === 'failed' || r.status === 'cancelled')
}

/** Manifest joined with the representative run per entry and method. */
export default defineEventHandler(async (): Promise<CorpusResponse> => {
  const supa = useSupabase()
  const slugs = corpusManifest.entries.flatMap(e => METHODS.flatMap(m => corpusPaperSlugs(e, m)))
  // has_digest from the stats view, so no digest is downloaded.
  const paperRows = (must(await supa.from('paper_digest_stats').select('id, slug, has_digest').in('slug', slugs)))
    .map(p => ({ id: p.id!, slug: p.slug!, hasDigest: !!p.has_digest }))
  const bySlug = new Map(paperRows.map(p => [p.slug, p]))
  const paperIds = paperRows.map(p => p.id)
  const runRows = paperRows.length
    ? (await selectAll((from, to) => supa.from('runs').select('*').in('paper_id', paperIds)
        .order('started_at', { ascending: false }).order('id').range(from, to))).map(runRow)
    : []
  const byId = new Map(runRows.map(r => [r.id, r]))

  const lineageCost = (r: RunRow) => {
    let sum = 0
    for (let cur: RunRow | undefined = r, n = 0; cur && n < 50; cur = cur.parentRunId ? byId.get(cur.parentRunId) : undefined, n++) {
      sum += cur.costUsd
    }
    return sum
  }

  const rows: CorpusRow[] = corpusManifest.entries.map((entry) => {
    const result = {} as Record<StructureMethod, CorpusRun | null>
    for (const method of METHODS) {
      const ids = new Set(corpusPaperSlugs(entry, method).map(s => bySlug.get(s)?.id).filter(Boolean))
      const r = pickRun(runRows.filter(x => ids.has(x.paperId) && x.structureMethod === method))
      const paper = r ? paperRows.find(p => p.id === r.paperId) : undefined
      result[method] = r && paper
        ? {
            paperSlug: paper.slug,
            runId: r.id,
            status: r.status,
            stage: r.stage,
            profile: r.profile,
            costUsd: r.costUsd,
            lineageCostUsd: Math.round(lineageCost(r) * 1e6) / 1e6,
            startedAt: r.startedAt.toISOString(),
            finishedAt: r.finishedAt?.toISOString() ?? null,
            error: r.error,
            hasDigest: !!paper.hasDigest,
            metrics: r.metrics ?? null,
            turns: typeof r.progress?.agent_turns === 'number' ? r.progress.agent_turns : null,
            progress: Object.fromEntries(Object.entries(r.progress ?? {}).filter(([, v]) => typeof v === 'number')) as Record<string, number>
          }
        : null
    }
    const tokens = entry.estTokens ?? (entry.pages ?? 0) * 1000
    return {
      entry,
      defaultMethod: defaultMethodFor(tokens),
      defaultProfile: defaultProfileFor(tokens, entry.pages ?? undefined),
      runs: result
    }
  })

  const spendUsd = Math.round(runRows.reduce((s, r) => s + r.costUsd, 0) * 1e4) / 1e4
  return { rows, spendUsd }
})
