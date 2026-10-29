import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { RUN_STAGES } from '#shared/pipeline'
import type { RunStage } from '#shared/types'
import { useDb } from '../../../db'
import { papers } from '../../../db/schema'
import { startRun } from '../../../utils/dispatch'
import { appendEvent, createRun, getRun, patchProgress } from '../../../utils/runs'
import { stageOutputs } from '../../../utils/stageOutputs'

// forceReview (dev only): critique adds a low-confidence test item if the model asks nothing, so the review queue can be exercised.
const bodySchema = z.object({ fromStage: z.enum(RUN_STAGES as [RunStage, ...RunStage[]]), forceReview: z.boolean().optional() })

/** New run with parent_run_id; stage_outputs before `fromStage` are copied so those stages skip their work. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const parent = /^[0-9a-f-]{36}$/i.test(id) ? await getRun(id) : undefined
  if (!parent) {
    throw createError({ statusCode: 404, statusMessage: 'No such run' })
  }
  if (parent.status === 'running' || parent.status === 'queued') {
    throw createError({ statusCode: 409, statusMessage: 'Cancel the run before re-running it' })
  }
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: `fromStage must be one of ${RUN_STAGES.join(', ')}` })
  }
  const { fromStage, forceReview } = parsed.data

  const runId = await createRun({
    paperId: parent.paperId,
    profile: parent.profile,
    method: parent.structureMethod,
    budgetUsd: parent.budgetUsd,
    parentRunId: parent.id
  })
  const copied = await stageOutputs.copyForward(parent.id, runId, fromStage)
  if (forceReview && import.meta.dev) {
    await patchProgress(runId, { force_review: true })
  }
  const db = await useDb()
  await db.update(papers).set({ latestRunId: runId, updatedAt: new Date() }).where(eq(papers.id, parent.paperId))
  await appendEvent(runId, 'run', 'info', `re-run of ${parent.id.slice(0, 8)} from ${fromStage}${copied.length ? ` · reused stage_outputs.${copied.join(', ')}` : ''}`)

  await startRun(runId, parent.paperId)
  return { runId }
})
