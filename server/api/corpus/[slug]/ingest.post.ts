import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { corpusPaperSlugs } from '#shared/corpus'
import { ACTIVE_RUN_STATUSES } from '#shared/runs'
import { useDb } from '../../../db'
import { papers, runs } from '../../../db/schema'
import { sourceRef } from '../../../pipeline/sources'
import { corpusEntry } from '../../../utils/corpus'
import { startRun } from '../../../utils/dispatch'
import { appendEvent, createRun } from '../../../utils/runs'

const bodySchema = z.object({
  method: z.enum(['pipeline', 'agent']),
  profile: z.enum(['careful', 'standard', 'quick']),
  budgetUsd: z.number().positive().max(500).default(15)
})

/**
 * `{ method, profile, budgetUsd? }` → a run of a manifest entry, as POST /api/papers would make it.
 * The paper row (entry slug, or `<slug>-agent`; see corpusPaperSlugs) is created on first ingest and reused after,
 * so a re-ingest is a fresh run on the same row (fetch replaces its sources).
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const entry = corpusEntry(slug)
  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: `No corpus entry "${slug}"` })
  }
  if (entry.source.kind === 'none') {
    throw createError({ statusCode: 422, statusMessage: `"${slug}" has no source yet` })
  }
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') })
  }
  const { method, profile, budgetUsd } = parsed.data
  const source = entry.source
  const ref = sourceRef(source)
  const paperSlug = corpusPaperSlugs(entry, method)[0]!

  const db = await useDb()
  let [paper] = await db.select({ id: papers.id }).from(papers).where(eq(papers.slug, paperSlug))
  if (paper) {
    const [active] = await db.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.paperId, paper.id), inArray(runs.status, ACTIVE_RUN_STATUSES)))
    if (active) {
      throw createError({ statusCode: 409, statusMessage: `"${paperSlug}" already has a run in progress` })
    }
    await db.update(papers).set({ tier: entry.tier, sourceKind: source.kind, sourceRef: ref, updatedAt: new Date() }).where(eq(papers.id, paper.id))
  } else {
    [paper] = await db.insert(papers).values({
      slug: paperSlug,
      title: entry.title,
      authors: entry.authors,
      sourceKind: source.kind,
      sourceRef: ref,
      tier: entry.tier
    }).returning({ id: papers.id })
  }
  const paperId = paper!.id

  const runId = await createRun({ paperId, profile, method, budgetUsd })
  await db.update(papers).set({ latestRunId: runId, updatedAt: new Date() }).where(eq(papers.id, paperId))
  await appendEvent(runId, 'run', 'info', `queued · corpus ${entry.slug} (${entry.tier}) · ${source.kind} ${ref} · ${profile} · ${method} · budget $${budgetUsd}`)

  await startRun(runId, paperId)
  setResponseStatus(event, 201)
  return { paperId, runId, slug: paperSlug }
})
