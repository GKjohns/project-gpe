/**
 * Where runs go: Inngest when INNGEST_EVENT_KEY is set or outside dev, else the in-process LocalRunner.
 * Every route that starts or signals a run goes through here (papers.post, runs/:id/{retry,review};
 * Sprint 8's corpus ingest route calls startRun, Sprint 4b's agent callback calls signalRun).
 */
import { EVENT_FLAGS, runner } from '../pipeline/runner'
import { inngest } from './inngest'
import { appendEvent, patchProgress, setStatus } from './runs'

export type RunnerMode = 'inngest' | 'local'
export type RunSignal = keyof typeof EVENT_FLAGS

let announced = false

export function runnerMode(): RunnerMode {
  const mode: RunnerMode = process.env.INNGEST_EVENT_KEY || (!import.meta.dev && !process.env.VITEST) ? 'inngest' : 'local'
  if (!announced) {
    announced = true
    console.info(`[gpe] runner: ${mode === 'inngest' ? 'Inngest (INNGEST_EVENT_KEY set or not dev)' : 'LocalRunner (dev, no INNGEST_EVENT_KEY)'}`)
  }
  return mode
}

/** Starts a queued run. Inngest: one event (id = runId, so a double submit dedupes). Local: in-process, not awaited. */
export async function startRun(runId: string, paperId: string): Promise<RunnerMode> {
  const mode = runnerMode()
  if (mode === 'local') {
    void runner.start(runId)
    return mode
  }
  try {
    await inngest.send({ id: `ingest-${runId}`, name: 'paper/ingest.requested', data: { runId, paperId } })
    await appendEvent(runId, 'run', 'info', 'sent to Inngest')
  } catch (err) {
    const message = `could not reach Inngest: ${err instanceof Error ? err.message : String(err)}`
    await setStatus(runId, 'failed', message)
    await appendEvent(runId, 'run', 'error', `run failed: ${message}`)
    throw createError({ statusCode: 503, statusMessage: message })
  }
  return mode
}

/**
 * Sets the progress flag LocalRunner polls and, under Inngest, sends the event the waiting function resumes on.
 * The flag is set either way: InngestRunner re-checks it, which covers a signal sent before the wait registered.
 */
export async function signalRun(runId: string, name: RunSignal) {
  await patchProgress(runId, { [EVENT_FLAGS[name]]: true })
  if (runnerMode() === 'inngest') {
    await inngest.send({ name, data: { runId } })
  }
}
