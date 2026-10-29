import { appendEvent, getRun, setStatus } from '../../../utils/runs'

const ACTIVE = ['queued', 'running', 'waiting_review']

/** Marks the run cancelled; the runner notices at the next step boundary (or while waiting on an event). */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const run = /^[0-9a-f-]{36}$/i.test(id) ? await getRun(id) : undefined
  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'No such run' })
  }
  if (!ACTIVE.includes(run.status)) {
    throw createError({ statusCode: 409, statusMessage: `Run is already ${run.status}` })
  }
  await setStatus(id, 'cancelled')
  await appendEvent(id, run.stage ?? 'run', 'warn', 'cancel requested; stopping at the next step')
  return { ok: true }
})
