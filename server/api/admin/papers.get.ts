import type { PaperListItem } from '#shared/api'
import { familyCode } from '#shared/catalog'
import type { PaperDigest } from '#shared/types'
import { toyDigest } from '../../fixtures/toy-digest'
import { runRow } from '../../utils/rows'
import type { PaperRow } from '../../utils/rows'
import { selectAll, useSupabase } from '../../utils/supabase'

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

// Operator library: every paper, public or not, with its most recent run and family. Small enough to join in memory.
// Digest counts come from the paper_digest_stats view, so no digest is downloaded. The public list is GET /api/papers.
export default defineEventHandler(async (): Promise<PaperListItem[]> => {
  const supa = useSupabase()
  const [paperRows, statRows, manuscriptRows, runRows] = await Promise.all([
    selectAll((from, to) => supa.from('papers')
      .select('id, slug, title, authors, source_kind, source_ref, tier, public, manuscript_dir, created_at')
      .order('created_at', { ascending: false }).order('id').range(from, to)),
    selectAll((from, to) => supa.from('paper_digest_stats').select('id, has_digest, nodes, sections, novel, friction').order('id').range(from, to)),
    selectAll((from, to) => supa.from('manuscripts').select('dir, family_number').order('dir').range(from, to)),
    selectAll((from, to) => supa.from('runs').select('*').order('started_at', { ascending: false }).order('id').range(from, to))
      .then(rs => rs.map(runRow))
  ])
  const statsOf = new Map(statRows.map(s => [s.id!, s]))
  const familyOf = new Map(manuscriptRows.map(m => [m.dir, m.family_number]))
  const rows = paperRows.map((p) => {
    const s = statsOf.get(p.id)
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      authors: p.authors,
      sourceKind: p.source_kind as PaperRow['sourceKind'],
      sourceRef: p.source_ref,
      tier: p.tier,
      public: p.public,
      manuscriptDir: p.manuscript_dir,
      createdAt: new Date(p.created_at),
      counts: s?.has_digest ? { nodes: s.nodes ?? 0, sections: s.sections ?? 0, novel: s.novel ?? 0, friction: s.friction ?? 0 } : null
    }
  })

  const latest = new Map<string, (typeof runRows)[number]>()
  for (const r of runRows) {
    if (!latest.has(r.paperId)) {
      latest.set(r.paperId, r)
    }
  }

  const items: PaperListItem[] = rows.map((p) => {
    const r = latest.get(p.id)
    const family = p.manuscriptDir ? familyOf.get(p.manuscriptDir) : undefined
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      authors: p.authors,
      sourceKind: p.sourceKind,
      sourceRef: p.sourceRef,
      tier: p.tier,
      createdAt: p.createdAt.toISOString(),
      counts: p.counts,
      public: p.public,
      ...(family ? { family: { number: family, code: familyCode(family) } } : {}),
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
      public: true,
      fixture: true
    })
  }
  return items
})
