import type { PaperResponse } from '#shared/api'
import { toyDigest } from '../../fixtures/toy-digest'
import { manuscriptEntry } from '../../catalog/query'
import { canSeePaper, loadCatalog } from '../../utils/agentApi'
import { paperRow } from '../../utils/rows'
import { must, useSupabase } from '../../utils/supabase'

// A static papers/toy.* route would shadow every /api/papers/toy/* path (no router backtracking), so the
// dev toy fixture lives here: a real `toy` row (e.g. from the corpus) still wins.
export default defineEventHandler(async (event): Promise<PaperResponse> => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const found = must(await useSupabase().from('papers').select('*').eq('slug', slug).maybeSingle())
  const row = found ? paperRow(found) : null
  if (!row && import.meta.dev && slug === 'toy') {
    return {
      paper: {
        id: null,
        slug: toyDigest.slug,
        title: toyDigest.title,
        authors: toyDigest.authors ?? [],
        sourceKind: toyDigest.source.kind,
        sourceRef: toyDigest.source.ref,
        tier: null,
        latestRunId: null
      },
      digest: toyDigest
    }
  }
  // A private paper is the same 404 as a missing one unless the operator asks.
  if (!row || !(await canSeePaper(event, row))) {
    throw createError({ statusCode: 404, statusMessage: `No paper "${slug}"` })
  }
  return {
    paper: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      authors: row.authors,
      sourceKind: row.sourceKind,
      sourceRef: row.sourceRef,
      tier: row.tier,
      latestRunId: row.latestRunId
    },
    digest: row.digest ?? null,
    catalog: row.manuscriptDir ? manuscriptEntry(await loadCatalog(), row.manuscriptDir) : null
  }
})
