import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createDb, setDb } from '../server/db'
import type { Db } from '../server/db'
import { papers, runEvents, runs, sources } from '../server/db/schema'
import { BudgetExceeded, LocalRunner, runner } from '../server/pipeline/runner'
import type { PipelineFn } from '../server/pipeline/runner'
import { addCost, createRun, getRun, getRunView, patchProgress, setStatus } from '../server/utils/runs'
import { stageOutputs } from '../server/utils/stageOutputs'

// Outline/extract/resolve call models since Sprint 3; the end-to-end case gets an empty outline.
vi.mock('../server/pipeline/llm', () => ({
  // One object that satisfies every stage's schema (outline, critique, annotate, classify).
  callObject: vi.fn(async () => ({ object: { claims: [], flags: [], fixes: [], ok: true, deps: [], name: 'A lemma', statement_plain: 'x holds.', explanation: 'Base case.', classification: 'routine', classification_cite: 'A direct check.' }, usage: { model: 'm', tokens_in: 0, tokens_out: 0, tokens_cached: 0, cost_usd: 0, cost_source: 'gateway', ms: 0, retried: false } }))
}))

let db: Db
let paperId: string

beforeAll(async () => {
  ({ db } = await createDb({ memory: true }))
  setDb(db)
  const [row] = await db.insert(papers).values({ slug: 'test', title: 'Test', sourceKind: 'upload', sourceRef: 'x.tex' }).returning()
  paperId = row!.id
})

const newRun = (budgetUsd = 10) => createRun({ paperId, profile: 'standard', method: 'pipeline', budgetUsd })

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('LocalRunner', () => {
  it('runs three steps in order and records six events', async () => {
    const runId = await newRun()
    const step = new LocalRunner(runId)
    const order: string[] = []
    for (const name of ['fetch', 'chunk', 'outline']) {
      const out = await step.run(name, async () => {
        order.push(name)
        return name.length
      })
      expect(out).toBe(name.length)
    }
    expect(order).toEqual(['fetch', 'chunk', 'outline'])
    const events = await db.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(runEvents.id)
    expect(events).toHaveLength(6)
    expect(events.map(e => e.message)).toEqual([
      'fetch started', 'fetch finished', 'chunk started', 'chunk finished', 'outline started', 'outline finished'
    ])
    expect(events[1]!.stage).toBe('fetch')
  })

  it('throws BudgetExceeded at the next step boundary once cost passes budget', async () => {
    const runId = await newRun(1)
    const step = new LocalRunner(runId)
    await step.run('outline', () => addCost(runId, 1.5))
    let ran = false
    await expect(step.run('extract', async () => {
      ran = true
    })).rejects.toBeInstanceOf(BudgetExceeded)
    expect(ran).toBe(false)
  })

  it('waitForEvent resolves on the progress flag and times out to null', async () => {
    const runId = await newRun()
    const step = new LocalRunner(runId, { pollMs: 20 })
    expect(await step.waitForEvent('review/decided', { match: {}, timeoutMs: 60 })).toBeNull()
    setTimeout(() => void patchProgress(runId, { review_done: true }), 30)
    expect(await step.waitForEvent('review/decided', { match: { runId }, timeoutMs: 2000 })).not.toBeNull()
  })
})

describe('runner lifecycle', () => {
  it('leaves a second run queued while one is running, then drains it', async () => {
    const gate = deferred()
    const seen: string[] = []
    const pipeline: PipelineFn = async (ctx, step) => {
      seen.push(ctx.runId)
      await step.run('fetch', async () => {
        if (seen.length === 1) {
          await gate.promise
        }
      })
    }
    const a = await newRun()
    const b = await newRun()

    const startA = await runner.start(a, { pipeline })
    expect(startA.result).toBe('started')
    const startB = await runner.start(b, { pipeline })
    expect(startB.result).toBe('queued')
    expect((await getRun(a))!.status).toBe('running')
    expect((await getRun(b))!.status).toBe('queued')

    gate.resolve()
    await startA.done
    expect((await getRun(a))!.status).toBe('complete')
    expect((await getRun(b))!.status).toBe('complete')
    // Earlier tests leave queued runs behind; the drainer picks those up too, oldest first.
    expect(seen[0]).toBe(a)
    expect(seen).toContain(b)
  })

  it('marks a run failed with error "budget" when the budget is blown', async () => {
    const runId = await newRun(0.5)
    const pipeline: PipelineFn = async (ctx, step) => {
      await step.run('outline', () => addCost(ctx.runId, 1))
      await step.run('extract', async () => {})
    }
    const { done } = await runner.start(runId, { pipeline })
    await done
    const run = await getRun(runId)
    expect(run!.status).toBe('failed')
    expect(run!.error).toBe('budget')
  })

  it('stops at the next boundary after cancel', async () => {
    const runId = await newRun()
    const pipeline: PipelineFn = async (ctx, step) => {
      await step.run('fetch', () => setStatus(ctx.runId, 'cancelled'))
      await step.run('chunk', async () => {
        throw new Error('should not run')
      })
    }
    const { done } = await runner.start(runId, { pipeline })
    await done
    const view = await getRunView(runId)
    expect(view!.run.status).toBe('cancelled')
    expect(view!.events.some(e => e.message === 'run cancelled')).toBe(true)
  })

  it('runs the ingest pipeline end to end with a mocked model and writes the digest', async () => {
    // The test paper is an upload, so fetch re-reads stored sources instead of hitting the network.
    const content = '\\documentclass{article}\n\\begin{document}\n\\section{A}\n\\begin{lemma}\\label{lem:a}x\\end{lemma}\n\\end{document}\n'
    await db.insert(sources).values({ paperId, path: 'x.tex', content, bytes: content.length })
    const runId = await newRun()
    const { done } = await runner.start(runId)
    await done
    const view = await getRunView(runId)
    expect(view!.run.status).toBe('complete')
    expect(view!.run.stage).toBe('finalize')
    expect(view!.run.progress).toMatchObject({ files: 1, sections: 1, statements: 1 })
    expect(await stageOutputs.get(runId, 'chunk')).toMatchObject({ mainFile: 'x.tex' })
    expect(view!.run.progress).toMatchObject({ claims: 0, statements_extracted: 1, refs_mechanical: 0, refs_inferred: 0 })
    expect(view!.run.progress).toMatchObject({ critique_findings: 0, annotated: 1, classified: 1, digest_nodes: 1 })
    expect(view!.run.metrics).toMatchObject({ statements_in_source: 1, claims: 0 })
    const [paper] = await db.select().from(papers).where(eq(papers.id, paperId))
    expect(paper!.digest).toMatchObject({ root_ids: ['lem-a'], nodes: [{ id: 'lem-a', name: 'A lemma', classification: 'routine' }] })
    expect(paper!.latestRunId).toBe(runId)
  })

  it('boot sweep fails runs left running', async () => {
    const runId = await newRun()
    await db.update(runs).set({ status: 'running' }).where(eq(runs.id, runId))
    expect(await runner.sweep()).toBe(1)
    const run = await getRun(runId)
    expect(run!.status).toBe('failed')
    expect(run!.error).toBe('dev server restarted')
  })
})

describe('stageOutputs', () => {
  it('copyForward copies only stages before fromStage', async () => {
    const parent = await newRun()
    const child = await newRun()
    await stageOutputs.put(parent, 'chunk', { n: 1 })
    await stageOutputs.put(parent, 'outline', { n: 2 })
    await stageOutputs.put(parent, 'extract', { n: 3 })
    await stageOutputs.put(parent, 'resolve', { n: 4 })

    const copied = await stageOutputs.copyForward(parent, child, 'extract')
    expect(copied.sort()).toEqual(['chunk', 'outline'])
    expect(await stageOutputs.get(child, 'chunk')).toEqual({ n: 1 })
    expect(await stageOutputs.get(child, 'outline')).toEqual({ n: 2 })
    expect(await stageOutputs.get(child, 'extract')).toBeNull()
    expect(await stageOutputs.get(child, 'resolve')).toBeNull()
  })

  it('put overwrites an existing row', async () => {
    const runId = await newRun()
    await stageOutputs.put(runId, 'chunk', { v: 1 })
    await stageOutputs.put(runId, 'chunk', { v: 2 })
    expect(await stageOutputs.get(runId, 'chunk')).toEqual({ v: 2 })
  })
})

describe('Sprint 8 hardening', () => {
  it('jsonbSafe strips NULs and lone surrogates', async () => {
    const { jsonbSafe } = await import('../server/utils/stageOutputs')
    expect(jsonbSafe({ a: ['x\u0000y', 'ok 𝐀', 'bad \uD835 z'] })).toEqual({ a: ['xy', 'ok 𝐀', 'bad � z'] })
  })

  it('errorText leads with the driver error and drops the params', async () => {
    const { errorText } = await import('../server/pipeline/runner')
    const err = new Error('Failed query: insert into "stage_outputs" values ($1)\nparams: ' + 'x'.repeat(5000), { cause: new Error('unsupported Unicode escape sequence') })
    const text = errorText(err)
    expect(text.startsWith('unsupported Unicode escape sequence (Failed query: insert')).toBe(true)
    expect(text.length).toBeLessThan(300)
  })
})
