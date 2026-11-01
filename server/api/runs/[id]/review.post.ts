import { z } from 'zod'
import { signalRun } from '../../../utils/dispatch'
import { reviewItemRow } from '../../../utils/rows'
import { appendEvent, getRun } from '../../../utils/runs'
import { must, useSupabase } from '../../../utils/supabase'

const bodySchema = z.object({ itemId: z.string().uuid(), decision: z.enum(['accept', 'reject']) })

/** Records one decision; when nothing is left pending, sets progress.review_done so the run resumes. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const run = /^[0-9a-f-]{36}$/i.test(id) ? await getRun(id) : undefined
  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'No such run' })
  }
  if (run.status !== 'waiting_review') {
    throw createError({ statusCode: 409, statusMessage: `Run is ${run.status}, not waiting for review` })
  }
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Body must be { itemId, decision: "accept" | "reject" }' })
  }
  const { itemId, decision } = parsed.data
  const supa = useSupabase()
  // Conditional on still-pending: a double click decides once.
  const updated = must(await supa.from('review_items')
    .update({ decision, decided_at: new Date().toISOString() })
    .eq('id', itemId).eq('run_id', id).is('decision', null)
    .select('*'))
  const item = updated[0] ? reviewItemRow(updated[0]) : undefined
  if (!item) {
    throw createError({ statusCode: 409, statusMessage: 'No pending review item with that id on this run' })
  }
  await appendEvent(id, 'critique', 'info', `review · ${decision === 'accept' ? 'accepted' : 'rejected'} ${item.kind} [${item.payload.target.join(', ')}]`)

  const left = must(await supa.from('review_items').select('id').eq('run_id', id).is('decision', null))
  if (!left.length) {
    // Sets progress.review_done (LocalRunner polls it); under Inngest also sends 'review/decided'.
    await signalRun(id, 'review/decided')
    await appendEvent(id, 'critique', 'info', 'review · all items decided; resuming')
  }
  return { ok: true, pending: left.length }
})
