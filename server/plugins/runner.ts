import { runner } from '../pipeline/runner'
import { runnerMode } from '../utils/dispatch'

// Dev only: Nitro restarts on any server/ edit, so in-flight runs can't survive; retry-from-stage makes that cheap.
export default defineNitroPlugin(() => {
  // Under Inngest nothing runs in-process: runs survive a restart and the queue is Inngest's.
  if (!import.meta.dev || runnerMode() === 'inngest') {
    return
  }
  void (async () => {
    try {
      const swept = await runner.sweep()
      if (swept) {
        console.info(`[gpe] marked ${swept} interrupted run(s) failed`)
      }
      await runner.drain()
    } catch (err) {
      console.error('[gpe] runner boot failed', err)
    }
  })()
})
