import { eq } from 'drizzle-orm'
import type { PaperResponse } from '#shared/api'
import { useDb } from '../../db'
import { papers } from '../../db/schema'

// `toy` is served by the static papers/toy.get.ts in dev, which wins over this dynamic route.
export default defineEventHandler(async (event): Promise<PaperResponse> => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const db = await useDb()
  const [row] = await db.select().from(papers).where(eq(papers.slug, slug))
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
