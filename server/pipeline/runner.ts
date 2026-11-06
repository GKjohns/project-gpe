// Contract: docs/20261029_digest_v1/implementation_plan.md § Step runner. Change the plan first.
import type { Profile, RunStage, StructureMethod } from '#shared/types'
import { RUN_STAGES } from '#shared/pipeline'
import type { RunProgress } from '#shared/pipeline'
import { appendEvent, getRun, setStatus } from '../utils/runs'
import { must, useSupabase } from '../utils/supabase'
import type { EventStage } from '../utils/runs'

export interface StepRunner {
  // plain; stages persist their own outputs to stage_outputs. quiet: no started/finished events (Method B's 10-s poll steps)
  run<T>(name: string, fn: () => Promise<T>, opts?: { quiet?: boolean }): Promise<T>
  waitForEvent<T>(name: string, opts: { match: Record<string, unknown>, timeoutMs: number }): Promise<T | null>
  sleep(ms: number): Promise<void>
}
export interface RunContext { runId: string, paperId: string, profile: Profile, method: StructureMethod, budgetUsd: number }
export type PipelineFn = (ctx: RunContext, step: StepRunner) => Promise<void>

export class BudgetExceeded extends Error {
  constructor(public costUsd: number, public budgetUsd: number) {
    super(`budget exceeded: $${costUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}`)
    this.name = 'BudgetExceeded'
  }
}

export class RunCancelled extends Error {
  constructor() {
    super('run cancelled')
    this.name = 'RunCancelled'
  }
}

// Routes set these progress flags (server/utils/dispatch.ts signalRun); under Inngest it also sends the event.
export const EVENT_FLAGS = {
  'review/decided': 'review_done',
  'structure/agent.finished': 'agent_finished'
} as const satisfies Record<string, keyof RunProgress>

/** The progress flag a signal sets, or undefined for an unknown name. */
export function eventFlag(name: string): keyof RunProgress | undefined {
  return (EVENT_FLAGS as Record<string, keyof RunProgress>)[name]
}

const STAGE_NAMES = new Set<string>(RUN_STAGES)

/** 'extract:claim-3' → 'extract'; anything that isn't a stage logs under 'run'. */
export function stageOf(name: string): EventStage {
  const head = name.split(':')[0]!
  return STAGE_NAMES.has(head) ? head as RunStage : 'run'
}

/**
 * Cancellation and budget, checked at step boundaries by the runner and between batches by long fan-out
 * stages (annotate, classify), so a 90-call step can't run far past the budget.
 */
export async function checkpoint(runId: string) {
  const run = await getRun(runId)
  if (!run || run.status === 'cancelled') {
    throw new RunCancelled()
  }
  if (run.costUsd > run.budgetUsd) {
    throw new BudgetExceeded(run.costUsd, run.budgetUsd)
  }
}

export class LocalRunner implements StepRunner {
  constructor(private runId: string, private opts: { pollMs?: number } = {}) {
    if (!import.meta.dev && !process.env.INNGEST_EVENT_KEY && !process.env.VITEST) {
      console.warn('[proofmap] LocalRunner outside dev with no INNGEST_EVENT_KEY: runs will not survive a cold start')
    }
  }

  /** Every step boundary; fan-out stages also call checkpoint() between batches. */
  private checkBoundary() {
    return checkpoint(this.runId)
  }

  async run<T>(name: string, fn: () => Promise<T>, opts: { quiet?: boolean } = {}): Promise<T> {
    await this.checkBoundary()
    if (opts.quiet) {
      return fn()
    }
    const stage = stageOf(name)
    await appendEvent(this.runId, stage, 'info', `${name} started`)
    const t0 = Date.now()
    const result = await fn()
    await appendEvent(this.runId, stage, 'info', `${name} finished`, { ms: Date.now() - t0 })
    return result
  }

  async waitForEvent<T>(name: string, opts: { match: Record<string, unknown>, timeoutMs: number }): Promise<T | null> {
    const flag = eventFlag(name)
    if (!flag) {
      throw new Error(`LocalRunner cannot wait for unknown event '${name}'`)
    }
    const deadline = Date.now() + opts.timeoutMs
    const pollMs = this.opts.pollMs ?? 2000
    while (Date.now() < deadline) {
      const run = await getRun(this.runId)
      if (!run || run.status === 'cancelled') {
        throw new RunCancelled()
      }
      if (run.progress[flag]) {
        return { name, data: opts.match } as T
      }
      await this.sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
    }
    return null
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// --- Local run lifecycle: one run at a time per process, the rest wait as `queued`. ---
// Per process, not per database: dev shares production's `runs`, so a dev server must never queue behind, steal or
// drain a run it didn't start (Inngest's, or another dev server's). Both sets live only in this process.
const active = new Set<string>()
const waiting: string[] = []

let lock: Promise<unknown> = Promise.resolve()
// Serializes check-then-claim so two starts can't both see "nothing running".
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn)
  lock = next.catch(() => {})
  return next
}

export type StartResult = 'started' | 'queued' | 'skipped'

/** queued → running in one conditional update, so only one claimer wins. */
async function claimRow(runId: string): Promise<boolean> {
  const rows = must(await useSupabase().from('runs').update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', runId).eq('status', 'queued').select('id'))
  return rows.length > 0
}

async function claim(runId: string): Promise<'claimed' | 'queued' | 'skipped'> {
  if ([...active].some(id => id !== runId)) {
    if (!waiting.includes(runId)) {
      waiting.push(runId)
    }
    return 'queued'
  }
  if (!await claimRow(runId)) {
    return 'skipped'
  }
  active.add(runId)
  return 'claimed'
}

/**
 * Starts a queued run in-process. Resolves once the run is claimed (not when it finishes);
 * `done` resolves when the run and any runs drained after it have finished.
 */
async function start(runId: string, opts: { pipeline?: PipelineFn, pollMs?: number } = {}): Promise<{ result: StartResult, done: Promise<void> }> {
  const outcome = await exclusive(() => claim(runId))
  if (outcome !== 'claimed') {
    return { result: outcome === 'queued' ? 'queued' : 'skipped', done: Promise.resolve() }
  }
  const done = execute(runId, opts)
    .then(() => drain(opts))
    .catch(err => console.error('[proofmap] queue drain failed', err))
  return { result: 'started', done }
}

async function execute(runId: string, opts: { pipeline?: PipelineFn, pollMs?: number }) {
  try {
    // Dynamic so runner.ts and the stages don't import each other at load time.
    const pipeline = opts.pipeline ?? (await import('./ingest')).ingestPaper
    const ctx = await beginRun(runId)
    if (!ctx) {
      return
    }
    await pipeline(ctx, new LocalRunner(runId, { pollMs: opts.pollMs }))
    await finishRun(runId)
  } catch (err) {
    await failRun(runId, err)
  } finally {
    active.delete(runId)
  }
}

// --- Run lifecycle shared by LocalRunner's execute() and the Inngest function (each call is one step there). ---

/** Inngest's claim: queued → running with no one-at-a-time check (the function's concurrency key does that per paper). */
export function claimQueued(runId: string): Promise<boolean> {
  return claimRow(runId)
}

/** Reads the run into a RunContext and logs 'run started'. Null if the row is gone. */
export async function beginRun(runId: string): Promise<RunContext | null> {
  const run = await getRun(runId)
  if (!run) {
    return null
  }
  const ctx: RunContext = {
    runId,
    paperId: run.paperId,
    profile: run.profile,
    method: run.structureMethod,
    budgetUsd: run.budgetUsd
  }
  await appendEvent(runId, 'run', 'info', 'run started', { profile: ctx.profile, method: ctx.method })
  return ctx
}

/**
 * Only a still-running run gets a terminal status here: structure_partial when the agent outline ended early
 * (progress.structure_partial, so the run page keeps polling while later stages run), else complete.
 */
export async function finishRun(runId: string) {
  const after = await getRun(runId)
  if (after?.status === 'running') {
    await setStatus(runId, after.progress.structure_partial ? 'structure_partial' : 'complete')
  }
  await appendEvent(runId, 'run', 'info', 'run finished')
}

/**
 * Records how a run ended badly. Under Inngest `err` is a StepError wrapping the original, so the
 * run row (status, cost vs budget) decides cancelled/budget as well as the error class.
 */
export async function failRun(runId: string, err: unknown) {
  const run = await getRun(runId).catch(() => undefined)
  // A failed or cancelled agent run must not leave its sandbox running (its own timeout is only the backstop).
  if (run?.progress.agent_sandbox && !run.progress.agent_stopped) {
    const { stopAgentSandbox } = await import('./stages/outline-agent')
    await stopAgentSandbox(runId, 'run ended').catch(() => {})
  }
  if (run?.progress.render_sandbox && !run.progress.render_sandbox_stopped) {
    const { stopRenderSandbox } = await import('./stages/render')
    await stopRenderSandbox(runId).catch(() => {})
  }
  if (err instanceof RunCancelled || run?.status === 'cancelled') {
    await appendEvent(runId, 'run', 'warn', 'run cancelled').catch(() => {})
    return
  }
  const overBudget = err instanceof BudgetExceeded ? err : run && run.costUsd > run.budgetUsd ? new BudgetExceeded(run.costUsd, run.budgetUsd) : null
  const message = overBudget ? 'budget' : errorText(err)
  await setStatus(runId, 'failed', message).catch(() => {})
  await appendEvent(runId, 'run', 'error', overBudget ? overBudget.message : `run failed: ${message}`).catch(() => {})
}

/** The error's message, capped: a run row's `error` is shown on the run page, not a log dump. */
export function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.length > 2000 ? `${message.slice(0, 2000)}…` : message
}

/** Starts the next run this process queued, if it isn't running one. Runs queued elsewhere are never touched. */
async function drain(opts: { pipeline?: PipelineFn, pollMs?: number } = {}): Promise<void> {
  while (!active.size && waiting.length) {
    const { result, done } = await start(waiting.shift()!, opts)
    if (result === 'started') {
      await done
      return
    }
  }
}

export const runner = { start, drain }
