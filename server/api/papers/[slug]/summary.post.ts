import type { Json } from '#supabase/database'
import type { PaperDigest } from '#shared/types'
import { loadSummaryCatalog, runSummary } from '../../../pipeline/summary'
import { invalidateCatalog } from '../../../utils/agentApi'
import { PROFILES } from '../../../utils/aiModels'
import { appendEvent, getRun } from '../../../utils/runs'
import { must, useSupabase } from '../../../utils/supabase'

/**
 * (Re)writes digest.summary for a digested paper: backfill for digests finalized before the summary existed, or to
 * redo one. The same single call finalize makes, on the digest's run profile's summary model; cost is recorded on
 * the digest's run. Patches papers.digest in place. Operator-only (every non-GET /api write is).
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const supa = useSupabase()
  const row = must(await supa.from('papers').select('id, digest, manuscript_dir').eq('slug', slug).maybeSingle())
  if (!row?.digest) {
    throw createError({ statusCode: 404, statusMessage: row ? `"${slug}" has no digest yet` : `No paper "${slug}"` })
  }
  const digest = row.digest as unknown as PaperDigest
  const run = /^[0-9a-f-]{36}$/i.test(digest.run_id) ? await getRun(digest.run_id) : undefined
  const model = PROFILES[run?.profile ?? 'careful'].summary
  const { summary, cost_usd } = await runSummary(digest, { model, catalog: await loadSummaryCatalog(row.manuscript_dir), runId: run?.id })
  digest.summary = summary
  must(await supa.from('papers').update({ digest: digest as unknown as Json, updated_at: new Date().toISOString() }).eq('id', row.id))
  // The catalog cache carries each digest's headline (cards, rails).
  invalidateCatalog()
  if (run) {
    await appendEvent(run.id, 'finalize', 'info', `summary written · $${cost_usd.toFixed(3)} · ${model}`)
  }
  return { summary, cost_usd, model }
})
