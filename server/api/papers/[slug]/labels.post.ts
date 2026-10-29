import { eq } from 'drizzle-orm'
import { useDb } from '../../../db'
import { papers } from '../../../db/schema'
import { runGraphLabels } from '../../../pipeline/graphLabels'
import { PROFILES } from '../../../utils/aiModels'
import { appendEvent, getRun } from '../../../utils/runs'

/**
 * Regenerates the graph cards' headline + role for a digested paper (backfill for digests made before the
 * annotate stage wrote them, or to redo them): the same single pass annotate runs, on the digest's run profile's
 * annotate model; cost is recorded on the digest's run. Patches papers.digest in place.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const db = await useDb()
  const [row] = await db.select({ id: papers.id, digest: papers.digest }).from(papers).where(eq(papers.slug, slug))
  if (!row?.digest) {
    throw createError({ statusCode: 404, statusMessage: row ? `"${slug}" has no digest yet` : `No paper "${slug}"` })
  }
  const digest = structuredClone(row.digest)
  const run = /^[0-9a-f-]{36}$/i.test(digest.run_id) ? await getRun(digest.run_id) : undefined
  const model = PROFILES[run?.profile ?? 'careful'].annotate
  const result = await runGraphLabels(digest.nodes, { title: digest.title, model, runId: run?.id })
  if (!result.labeled) {
    throw createError({ statusCode: 502, statusMessage: 'The model returned no usable labels' })
  }
  await db.update(papers).set({ digest, updatedAt: new Date() }).where(eq(papers.id, row.id))
  if (run) {
    await appendEvent(run.id, 'annotate', 'info', `graph labels regenerated: ${result.labeled}/${digest.nodes.length} nodes · $${result.cost_usd.toFixed(3)} · ${model}${result.missing.length ? ` · missing ${result.missing.join(', ')}` : ''}`)
  }
  return { labeled: result.labeled, total: digest.nodes.length, missing: result.missing, long: result.long, cost_usd: result.cost_usd, calls: result.calls, model }
})
