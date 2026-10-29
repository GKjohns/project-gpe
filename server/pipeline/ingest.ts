import { RUN_STAGES } from '#shared/pipeline'
import type { PipelineFn, RunContext, StepRunner } from './runner'
import { STAGES } from './stages'
import { critiqueReviewStage } from './stages/critique'
import { AGENT_PENDING, outlineAgentCollect, pollAgent } from './stages/outline-agent'
import type { AgentPoll } from './stages/outline-agent'

const REVIEW_TIMEOUT_MS = 24 * 60 * 60 * 1000

/**
 * Method B's wait, at the top level like the review wait: short quiet poll steps (trace → run_events, timeout
 * extension) alternate with slices of waitForEvent('structure/agent.finished'), which the callback route or a poll
 * that sees the agent exit ends early. The ceiling lives in the poll step (progress.agent_deadline), so replays agree.
 */
async function awaitAgent(ctx: RunContext, step: StepRunner): Promise<AgentPoll['state']> {
  for (let i = 0; ; i++) {
    const poll = await step.run(`outline:poll-${i}`, () => pollAgent(ctx), { quiet: true })
    if (poll.state !== 'running') {
      return poll.state
    }
    await step.waitForEvent('structure/agent.finished', { match: { 'data.runId': ctx.runId }, timeoutMs: poll.waitMs })
  }
}

/**
 * The whole pipeline, identical under LocalRunner and InngestRunner.
 * Nothing at this level may touch the DB, call a model, or mint ids/timestamps:
 * under Inngest this body replays from the top on every step.
 */
export const ingestPaper: PipelineFn = async (ctx, step) => {
  for (const stage of RUN_STAGES) {
    const n = await step.run(stage, () => STAGES[stage](ctx))
    // The agent outline returns AGENT_PENDING once its sandbox is running; the wait lives here, outside any step.
    if (stage === 'outline' && n === AGENT_PENDING) {
      const end = await awaitAgent(ctx, step)
      await step.run('outline:collect', () => outlineAgentCollect(ctx, end))
    }
    // critique returns how many fixes wait on a human; the wait lives here, outside any step.
    if (stage === 'critique' && n > 0) {
      const decided = await step.waitForEvent('review/decided', { match: { 'data.runId': ctx.runId }, timeoutMs: REVIEW_TIMEOUT_MS })
      await step.run('critique:review', () => critiqueReviewStage(ctx, decided !== null))
    }
  }
}
