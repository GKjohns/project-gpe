import { desc } from 'drizzle-orm'
import type { PaperListItem } from '#shared/api'
import type { PaperDigest } from '#shared/types'
import { useDb } from '../db'
import { papers, runs } from '../db/schema'
import { toyDigest } from '../fixtures/toy-digest'

function countsOf(digest: PaperDigest | null): PaperListItem['counts'] {
  if (!digest) {
    return null
  }
  return {
    nodes: digest.nodes.length,
    sections: digest.sections.length,
    novel: digest.nodes.filter(n => n.classification === 'novel').length,
    friction: digest.nodes.reduce((sum, n) => sum + n.friction.length, 0)
  }
}

// Library list: every paper with its most recent run. Small enough to join in memory for v1.
export default defineEventHandler(async (): Promise<PaperListItem[]> => {
  const db = await useDb()
  const rows = await db.select().from(papers).orderBy(desc(papers.createdAt))
  const runRows = await db.select({
    id: runs.id,
    paperId: runs.paperId,
    status: runs.status,
    stage: runs.stage,
    profile: runs.profile,
    structureMethod: runs.structureMethod,
    costUsd: runs.costUsd,
    startedAt: runs.startedAt,
    finishedAt: runs.finishedAt,
    error: runs.error,
    progress: runs.progress,
    metrics: runs.metrics
  }).from(runs).orderBy(desc(runs.startedAt))

  const latest = new Map<string, (typeof runRows)[number]>()
  for (const r of runRows) {
    if (!latest.has(r.paperId)) {
      latest.set(r.paperId, r)
    }
  }

  const items: PaperListItem[] = rows.map((p) => {
    const r = latest.get(p.id)
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      authors: p.authors,
      sourceKind: p.sourceKind,
      sourceRef: p.sourceRef,
      tier: p.tier,
      createdAt: p.createdAt.toISOString(),
      counts: countsOf(p.digest ?? null),
      run: r
        ? {
            id: r.id,
            status: r.status,
            stage: r.stage,
            profile: r.profile,
            structureMethod: r.structureMethod,
            costUsd: r.costUsd,
            startedAt: r.startedAt.toISOString(),
            finishedAt: r.finishedAt?.toISOString() ?? null,
            error: r.error,
            progress: Object.fromEntries(Object.entries(r.progress ?? {}).filter(([, v]) => typeof v === 'number')) as Record<string, number>,
            metrics: r.metrics ? { cost_usd: r.metrics.cost_usd, wallclock_ms: r.metrics.wallclock_ms, calls: r.metrics.calls } : null
          }
        : null
    }
  })

  // Dev: the toy fixture stands in as a digested paper until a real `toy` row exists.
  if (import.meta.dev && !rows.some(p => p.slug === 'toy')) {
    items.push({
      id: null,
      slug: toyDigest.slug,
      title: toyDigest.title,
      authors: toyDigest.authors ?? [],
      sourceKind: toyDigest.source.kind,
      sourceRef: toyDigest.source.ref,
      tier: 'fixture',
      createdAt: toyDigest.generated_at,
      counts: countsOf(toyDigest),
      run: null,
      fixture: true
    })
  }
  return items
})
