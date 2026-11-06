import { authMode } from '../utils/operator'

// Required outside dev; a missing one is named at boot (never its value) instead of surfacing as a runtime failure.
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_SECRET_KEY', 'OPERATOR_TOKEN', 'AI_GATEWAY_API_KEY', 'INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY', 'AGENT_LOG_SALT', 'NUXT_PUBLIC_APP_URL']

// Says once, at boot, how the operator guard is configured and which production env vars are missing.
export default defineNitroPlugin(() => {
  const mode = authMode()
  if (mode === 'open') {
    console.info('[proofmap] operator auth: off (dev, no OPERATOR_TOKEN) · every control is open')
  } else if (mode === 'closed') {
    console.error('[proofmap] OPERATOR_TOKEN is not set: operator routes (ingest, retry, cancel, review, corpus) are DENIED until it is')
  } else {
    console.info('[proofmap] operator auth: on (OPERATOR_TOKEN)')
  }
  if (!import.meta.dev) {
    for (const name of REQUIRED_ENV.filter(n => !process.env[n])) {
      console.error(`[proofmap] env: ${name} is not set`)
    }
  }
})
