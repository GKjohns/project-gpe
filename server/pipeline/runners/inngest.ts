// Contract: docs/20261029_digest_v1/implementation_plan.md § Step runner. Change the plan first.
import { NonRetriableError } from 'inngest'
import type { GetStepTools } from 'inngest'
import type { inngest } from '../../utils/inngest'
import { appendEvent, getRun } from '../../utils/runs'
import { BudgetExceeded, RunCancelled, checkpoint, eventFlag, stageOf } from '../runner'
import type { StepRunner } from '../runner'

type Step = GetStepTools<typeof inngest>

// Waits go in slices: each slice re-checks the progress flag (a signal sent before the wait registered is never lost)
// and the run status (cancel), and keeps the step count well under Inngest's limit for a 24 h review wait.
const WAIT_SLICE_MS = 15 * 60 * 1000

interface WaitCheck { state: 'set' | 'cancelled' | 'timeout' | 'wait', waitMs: number }

/**
 * StepRunner over Inngest's step tools. Everything with a side effect or a clock read happens inside `step.run`,
 * so the replayed function body stays deterministic: the 'started'/'finished' events and the cancel/budget
 * checkpoint run inside the step, exactly where LocalRunner does them.
 */
export class InngestRunner implements StepRunner {
  constructor(private step: Step, private runId: string) {}

  run<T>(name: string, fn: () => Promise<T>, opts: { quiet?: boolean } = {}): Promise<T> {
    const stage = stageOf(name)
    return this.step.run(name, async () => {
      try {
        await checkpoint(this.runId)
        if (opts.quiet) {
          return await fn()
        }
        await appendEvent(this.runId, stage, 'info', `${name} started`)
        const t0 = Date.now()
        const result = await fn()
        await appendEvent(this.runId, stage, 'info', `${name} finished`, { ms: Date.now() - t0 })
        return result
      } catch (err) {
        // A retry can't fix a cancel or an exhausted budget; don't spend three more attempts on it.
        if (err instanceof RunCancelled || err instanceof BudgetExceeded) {
          throw new NonRetriableError(err.message, { cause: err })
        }
        throw err
      }
    }) as Promise<T>
  }

  async waitForEvent<T>(name: string, opts: { match: Record<string, unknown>, timeoutMs: number }): Promise<T | null> {
    const flag = eventFlag(name)
    if (!flag) {
      throw new Error(`InngestRunner cannot wait for unknown event '${name}'`)
    }
    const runId = this.runId
    // Method B waits on the same event many times (one slice per poll); each call gets its own step ids. The counter
    // restarts on every replay and calls happen in the same order, so the ids are stable. The first call keeps the bare name.
    const k = this.waits.get(name) ?? 0
    this.waits.set(name, k + 1)
    const id = k ? `${name}#${k}` : name
    // Memoized by Inngest, so the deadline is fixed on first execution and identical on every replay.
    const deadline = await this.step.run(`${id}:deadline`, async () => Date.now() + opts.timeoutMs)
    const cond = Object.entries(opts.match).map(([path, v]) => `async.${path} == ${JSON.stringify(v)}`).join(' && ')
    for (let i = 0; ; i++) {
      const check = await this.step.run(`${id}:check-${i}`, async (): Promise<WaitCheck> => {
        const run = await getRun(runId)
        if (!run || run.status === 'cancelled') {
          return { state: 'cancelled', waitMs: 0 }
        }
        if (run.progress[flag]) {
          return { state: 'set', waitMs: 0 }
        }
        const left = deadline - Date.now()
        return left <= 0 ? { state: 'timeout', waitMs: 0 } : { state: 'wait', waitMs: Math.min(WAIT_SLICE_MS, left) }
      })
      if (check.state === 'cancelled') {
        throw new RunCancelled()
      }
      if (check.state === 'set') {
        return { name, data: opts.match } as T
      }
      if (check.state === 'timeout') {
        return null
      }
      const event = await this.step.waitForEvent(`${id}:wait-${i}`, { event: name, timeout: check.waitMs, if: cond })
      if (event) {
        return event as T
      }
    }
  }

  async sleep(ms: number): Promise<void> {
    // Durable sleeps need a stable id; callers that sleep more than once per name get a counter suffix.
    await this.step.sleep(`sleep-${this.sleeps++}`, ms)
  }

  private sleeps = 0
  private waits = new Map<string, number>()
}
