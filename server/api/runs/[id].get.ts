import { getRunView } from '../../utils/runs'
import { must, useSupabase } from '../../utils/supabase'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Run row + last 200 events + pending review items, plus enough of the paper for the run page header. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const view = UUID.test(id) ? await getRunView(id) : null
  if (!view) {
    throw createError({ statusCode: 404, statusMessage: 'No such run' })
  }
  const supa = useSupabase()
  // has_digest comes from the stats view so the (1–2 MB) digest itself isn't downloaded.
  const [row, stats] = await Promise.all([
    supa.from('papers').select('slug, title, source_kind, source_ref, latest_run_id').eq('id', view.run.paperId).maybeSingle().then(must),
    supa.from('paper_digest_stats').select('has_digest').eq('id', view.run.paperId).maybeSingle().then(must)
  ])
  const paper = row
    ? { slug: row.slug, title: row.title, sourceKind: row.source_kind, sourceRef: row.source_ref, latestRunId: row.latest_run_id, hasDigest: !!stats?.has_digest }
    : null
  // The agent's bearer token never leaves the server.
  const { agentToken: _token, ...run } = view.run
  return { run, events: view.events, reviewItems: view.reviewItems, paper }
})
