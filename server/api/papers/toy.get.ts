import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { papers } from '../../db/schema'
import { toyDigest } from '../../fixtures/toy-digest'

// Dev only: a real `toy` row (e.g. from the corpus) wins over the fixture.
export default defineEventHandler(async () => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  const db = await useDb()
  const [row] = await db.select().from(papers).where(eq(papers.slug, 'toy'))
  if (row) {
    return { paper: row, digest: row.digest }
  }
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
})
