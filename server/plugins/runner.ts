import { runnerMode } from '../utils/dispatch'

// Announces the runner at boot. There is no boot sweep or drain: dev shares production's `runs`, so a dev server must
// never fail or start runs it didn't begin. A run orphaned by a dev restart is cancelled (or retried) from its run page.
export default defineNitroPlugin(() => {
  if (import.meta.dev) {
    runnerMode()
  }
})
