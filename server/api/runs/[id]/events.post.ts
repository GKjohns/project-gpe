import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { ingestTrace } from '../../../pipeline/stages/outline-agent'
import type { TraceEntry } from '../../../pipeline/stages/outline-agent'
import { signalRun } from '../../../utils/dispatch'
import { appendEvent, getRun } from '../../../utils/runs'

const traceEntry = z.object({
  seq: z.number().int().positive(),
  ts: z.string(),
  turn: z.number().int().nonnegative(),
  kind: z.enum(['start', 'tool', 'text', 'validate', 'error', 'result']),
  tool: z.string().optional(),
  summary: z.string().optional(),
  calls: z.number().nonnegative(),
  cost_usd: z.number().nonnegative(),
  tokens_in: z.number().nonnegative(),
  tokens_out: z.number().nonnegative()
})

const body = z.union([
  z.object({ finished: z.literal(true), outline: z.unknown().optional(), data: z.record(z.string(), z.unknown()).optional() }),
  z.object({ message: z.string().max(2000), data: z.record(z.string(), z.unknown()).optional() })
])

/**
 * Method B's callback (bearer runs.agent_token, minted per sandbox). A trace line goes through the same
 * de-duplicating ingestion as polling; `finished` sets the agent_finished flag (and sends the Inngest event).
 * The outline itself is read from the sandbox by the 'outline:collect' step, which also stops it, so the
 * file in the VM stays the one source of truth whichever transport arrives first.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const run = /^[0-9a-f-]{36}$/i.test(id) ? await getRun(id) : undefined
  const auth = getHeader(event, 'authorization') ?? ''
  const given = Buffer.from(auth.replace(/^Bearer\s+/i, ''))
  const expected = Buffer.from(run?.agentToken ?? '')
  if (!run || !expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  if (run.status !== 'running' || run.progress.agent_stopped) {
    throw createError({ statusCode: 409, statusMessage: `Run is ${run.status}; the agent is no longer awaited` })
  }
  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Bad body' })
  }
  const b = parsed.data
  if ('finished' in b) {
    await appendEvent(id, 'outline', 'info', `outline · agent finished (callback)${b.data?.subtype ? `: ${String(b.data.subtype)}` : ''}`)
    await signalRun(id, 'structure/agent.finished')
    return { ok: true }
  }
  const entry = traceEntry.safeParse(b.data)
  if (entry.success) {
    await ingestTrace(id, [entry.data as TraceEntry])
  } else {
    await appendEvent(id, 'outline', 'info', `agent · ${b.message}`, b.data ?? undefined)
  }
  return { ok: true }
})
