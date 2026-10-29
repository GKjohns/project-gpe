import { eq } from 'drizzle-orm'
import type { PaperResponse } from '#shared/api'
import { useDb } from '../../db'
import { papers } from '../../db/schema'
import { toyDigest } from '../../fixtures/toy-digest'

// A static papers/toy.* route would shadow every /api/papers/toy/* path (no router backtracking), so the
// dev toy fixture lives here: a real `toy` row (e.g. from the corpus) still wins.
export default defineEventHandler(async (event): Promise<PaperResponse> => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const db = await useDb()
  const [row] = await db.select().from(papers).where(eq(papers.slug, slug))
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
  if (!row) {
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
    digest: row.digest ?? null
  }
})
