import { z } from 'zod'
import { corpusPaperSlugs } from '#shared/corpus'
import { ACTIVE_RUN_STATUSES } from '#shared/runs'
import { sourceRef } from '../../../pipeline/sources'
import { corpusEntry } from '../../../utils/corpus'
import { startRun } from '../../../utils/dispatch'
import { appendEvent, createRun } from '../../../utils/runs'
import { must, useSupabase } from '../../../utils/supabase'

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

  const supa = useSupabase()
  const existing = must(await supa.from('papers').select('id').eq('slug', paperSlug).maybeSingle())
  let paperId: string
  if (existing) {
    const active = must(await supa.from('runs').select('id').eq('paper_id', existing.id).in('status', ACTIVE_RUN_STATUSES).limit(1))
    if (active.length) {
      throw createError({ statusCode: 409, statusMessage: `"${paperSlug}" already has a run in progress` })
    }
    must(await supa.from('papers').update({ tier: entry.tier, source_kind: source.kind, source_ref: ref, updated_at: new Date().toISOString() }).eq('id', existing.id))
    paperId = existing.id
  } else {
    try {
      paperId = must(await supa.from('papers').insert({
        slug: paperSlug,
        title: entry.title,
        authors: entry.authors,
        source_kind: source.kind,
        source_ref: ref,
        tier: entry.tier
      }).select('id').single()).id
    } catch (err) {
      // Two first ingests of the same entry at once: the slug is unique, so the second is today's 409.
      if ((err as { code?: string }).code === '23505') {
        throw createError({ statusCode: 409, statusMessage: `"${paperSlug}" already has a run in progress` })
      }
      throw err
    }
  }

  const runId = await createRun({ paperId, profile, method, budgetUsd })
  must(await supa.from('papers').update({ latest_run_id: runId, updated_at: new Date().toISOString() }).eq('id', paperId))
  await appendEvent(runId, 'run', 'info', `queued · corpus ${entry.slug} (${entry.tier}) · ${source.kind} ${ref} · ${profile} · ${method} · budget $${budgetUsd}`)

  await startRun(runId, paperId)
  setResponseStatus(event, 201)
  return { paperId, runId, slug: paperSlug }
})
