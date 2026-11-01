import { NonRetriableError } from 'inngest'
import { beforeEach, describe, expect, it } from 'vitest'
import { InngestRunner } from '../server/pipeline/runners/inngest'
import { createRun, patchProgress, setStatus } from '../server/utils/runs'
import { setSupabase } from '../server/utils/supabase'
import { createFakeSupabase } from './helpers/fakeSupabase'

let supa: ReturnType<typeof createFakeSupabase>
const paperId = '00000000-0000-4000-8000-000000000002'

beforeEach(() => {
  supa = createFakeSupabase({ papers: [{ id: paperId, slug: 'inngest', title: 'Inngest', source_kind: 'upload', source_ref: 'x.tex', authors: [], tier: null, digest: null, latest_run_id: null, public: false, manuscript_dir: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' }] })
  setSupabase(supa.client)
})

/** Stand-in for Inngest's step tools: runs steps inline (memoizing by id like a replay would) and records waits. */
function fakeStep(waitResults: (unknown | null)[] = []) {
  const memo = new Map<string, unknown>()
  const ids: string[] = []
  const waits: { id: string, opts: Record<string, unknown> }[] = []
  return {
    ids,
    waits,
    step: {
      run: async (id: string, fn: () => Promise<unknown>) => {
        ids.push(id)
        if (!memo.has(id)) {
          memo.set(id, await fn())
        }
        return memo.get(id)
      },
      waitForEvent: async (id: string, opts: Record<string, unknown>) => {
        ids.push(id)
        waits.push({ id, opts })
        return waitResults.shift() ?? null
      },
      sleep: async (id: string) => {
        ids.push(id)
      }
    }
  }
}

const newRun = (budgetUsd = 10) => createRun({ paperId, profile: 'standard', method: 'pipeline', budgetUsd })

describe('InngestRunner', () => {
  it('logs started/finished inside the step, like LocalRunner', async () => {
    const runId = await newRun()
    const fake = fakeStep()
    const step = new InngestRunner(fake.step as never, runId)
    expect(await step.run('fetch', async () => 3)).toBe(3)
    const events = supa.tables.run_events!.filter(e => e.run_id === runId).sort((a, b) => Number(a.id) - Number(b.id))
    expect(events.map(e => e.message)).toEqual(['fetch started', 'fetch finished'])
    expect(fake.ids).toEqual(['fetch'])
  })

  it('turns a cancel at the step boundary into a NonRetriableError', async () => {
    const runId = await newRun()
    await setStatus(runId, 'cancelled')
    const step = new InngestRunner(fakeStep().step as never, runId)
    await expect(step.run('chunk', async () => 1)).rejects.toBeInstanceOf(NonRetriableError)
  })

  it('returns at once when the flag was set before the wait registered', async () => {
    const runId = await newRun()
    await patchProgress(runId, { review_done: true })
    const fake = fakeStep()
    const step = new InngestRunner(fake.step as never, runId)
    const out = await step.waitForEvent('review/decided', { match: { 'data.runId': runId }, timeoutMs: 60_000 })
    expect(out).not.toBeNull()
    expect(fake.waits).toHaveLength(0)
  })

  it('waits in slices with an `if` on the run id and resolves on the event', async () => {
    const runId = await newRun()
    const event = { name: 'review/decided', data: { runId } }
    const fake = fakeStep([null, event])
    const step = new InngestRunner(fake.step as never, runId)
    const out = await step.waitForEvent('review/decided', { match: { 'data.runId': runId }, timeoutMs: 24 * 3600_000 })
    expect(out).toEqual(event)
    expect(fake.waits.map(w => w.id)).toEqual(['review/decided:wait-0', 'review/decided:wait-1'])
    expect(fake.waits[0]!.opts).toMatchObject({ event: 'review/decided', if: `async.data.runId == "${runId}"`, timeout: 15 * 60_000 })
  })

  it('times out to null once the memoized deadline passes', async () => {
    const runId = await newRun()
    const fake = fakeStep()
    const step = new InngestRunner(fake.step as never, runId)
    expect(await step.waitForEvent('review/decided', { match: { 'data.runId': runId }, timeoutMs: 0 })).toBeNull()
  })
  it('gives repeated waits on one event their own step ids (Method B polls in slices)', async () => {
    const runId = await newRun()
    const fake = fakeStep([{ name: 'structure/agent.finished' }, { name: 'structure/agent.finished' }])
    const step = new InngestRunner(fake.step as never, runId)
    await step.waitForEvent('structure/agent.finished', { match: { 'data.runId': runId }, timeoutMs: 10_000 })
    await step.waitForEvent('structure/agent.finished', { match: { 'data.runId': runId }, timeoutMs: 10_000 })
    expect(fake.waits.map(w => w.id)).toEqual(['structure/agent.finished:wait-0', 'structure/agent.finished#1:wait-0'])
    expect(new Set(fake.ids).size).toBe(fake.ids.length)
  })
})
