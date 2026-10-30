import { authMode } from '../utils/operator'

// Says once, at boot, how the operator guard is configured.
export default defineNitroPlugin(() => {
  const mode = authMode()
  if (mode === 'open') {
    console.info('[gpe] operator auth: off (dev, no OPERATOR_TOKEN) · every control is open')
  } else if (mode === 'closed') {
    console.error('[gpe] OPERATOR_TOKEN is not set: operator routes (ingest, retry, cancel, review, corpus) are DENIED until it is')
  } else {
    console.info('[gpe] operator auth: on (OPERATOR_TOKEN)')
  }
})
