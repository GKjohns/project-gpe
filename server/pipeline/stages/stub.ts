import type { RunStage } from '#shared/types'
import { appendEvent, setStage } from '../../utils/runs'
import type { RunContext } from '../runner'

/** What every stage looks like from ingestPaper: do the work, return a small count. */
export type StageFn = (ctx: RunContext) => Promise<number>

// Sprint 1 placeholder; each stage file replaces this with real work in its sprint.
export function stubStage(stage: RunStage): StageFn {
  return async (ctx) => {
    await setStage(ctx.runId, stage)
    await appendEvent(ctx.runId, stage, 'info', `${stage}: stub (not implemented yet)`)
    return 0
  }
}
