/**
 * ingest-paper: the production runner for `ingestPaper` (dev uses LocalRunner; see server/utils/dispatch.ts).
 *
 * The handler body replays from the top on every step, so it only sequences steps: claiming the run, the pipeline
 * (each stage is one `step.run` via InngestRunner), and the terminal status write are all steps.
 * MODULE-LEVEL SAFETY: no env reads or side effects at import; a throw here 500s /api/inngest for every function.
 */
import { NonRetriableError } from 'inngest'
import { inngest } from '../../utils/inngest'
import { ingestPaper } from '../../pipeline/ingest'
import { beginRun, claimQueued, failRun, finishRun } from '../../pipeline/runner'
import { InngestRunner } from '../../pipeline/runners/inngest'

export interface IngestRequested { runId: string, paperId: string }

export const ingestPaperFn = inngest.createFunction(
  {
    id: 'ingest-paper',
    triggers: [{ event: 'paper/ingest.requested' }],
    // One run per paper at a time (a retry while the parent still runs waits); different papers run in parallel.
    concurrency: { key: 'event.data.paperId', limit: 1 },
    // Model calls already retry schema failures; one more attempt covers a gateway or DB blip without re-spending much.
    // No cancelOn: cancel is a status write that the next step boundary (or wait slice) turns into RunCancelled, so the
    // run log ends with 'run cancelled' exactly as under LocalRunner; an Inngest-side cancel would drop that last step.
    retries: 1
  },
  async ({ event, step }) => {
    const { runId } = event.data as IngestRequested
    const ctx = await step.run('run:claim', async () => (await claimQueued(runId)) ? beginRun(runId) : null)
    if (!ctx) {
      return { runId, skipped: true }
    }
    try {
      await ingestPaper(ctx, new InngestRunner(step, runId))
    } catch (err) {
      await step.run('run:failed', () => failRun(runId, err))
      // Surface it as a failed Inngest run too, without retrying a pipeline that already recorded its failure.
      throw new NonRetriableError(err instanceof Error ? err.message : String(err), { cause: err })
    }
    await step.run('run:finish', () => finishRun(runId))
    return { runId }
  }
)

// Sprint 4b hook ('structure/agent.finished'): no extra function. A wait can't live inside a step, and the outline
// stage is one, so the agent method splits like critique does: step 'outline' boots the sandbox and returns; ingestPaper
// (top level, when ctx.method === 'agent') calls step.waitForEvent('structure/agent.finished', { match: { 'data.runId': ctx.runId },
// timeoutMs }); step 'outline:collect' reads outline.json and stops the sandbox. The callback route calls
// signalRun(runId, 'structure/agent.finished') from server/utils/dispatch.ts. Under Inngest the trace must arrive by the HTTP
// callback: a step can't poll the sandbox for 90 min inside Vercel's maxDuration.
