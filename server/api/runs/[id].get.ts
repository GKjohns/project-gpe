import { eq, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { papers } from '../../db/schema'
import { getRunView } from '../../utils/runs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Run row + last 200 events + pending review items, plus enough of the paper for the run page header. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const view = UUID.test(id) ? await getRunView(id) : null
  if (!view) {
    throw createError({ statusCode: 404, statusMessage: 'No such run' })
  }
  const db = await useDb()
  const [paper] = await db.select({
    slug: papers.slug,
    title: papers.title,
    sourceKind: papers.sourceKind,
    sourceRef: papers.sourceRef,
    latestRunId: papers.latestRunId,
    hasDigest: sql<boolean>`${papers.digest} is not null`
  }).from(papers).where(eq(papers.id, view.run.paperId))
  // The agent's bearer token never leaves the server.
  const { agentToken: _token, ...run } = view.run
  return { run, events: view.events, reviewItems: view.reviewItems, paper: paper ?? null }
})
