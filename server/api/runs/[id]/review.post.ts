import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../db'
import { reviewItems } from '../../../db/schema'
import { signalRun } from '../../../utils/dispatch'
import { appendEvent, getRun } from '../../../utils/runs'

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
  const db = await useDb()
  const [item] = await db.update(reviewItems)
    .set({ decision, decidedAt: new Date() })
    .where(and(eq(reviewItems.id, itemId), eq(reviewItems.runId, id), isNull(reviewItems.decision)))
    .returning()
  if (!item) {
    throw createError({ statusCode: 409, statusMessage: 'No pending review item with that id on this run' })
  }
  await appendEvent(id, 'critique', 'info', `review · ${decision === 'accept' ? 'accepted' : 'rejected'} ${item.kind} [${item.payload.target.join(', ')}]`)

  const left = await db.select({ id: reviewItems.id }).from(reviewItems)
    .where(and(eq(reviewItems.runId, id), isNull(reviewItems.decision)))
  if (!left.length) {
    // Sets progress.review_done (LocalRunner polls it); under Inngest also sends 'review/decided'.
    await signalRun(id, 'review/decided')
    await appendEvent(id, 'critique', 'info', 'review · all items decided; resuming')
  }
  return { ok: true, pending: left.length }
})
