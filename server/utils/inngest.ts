/**
 * The one Inngest client (standard single-client pattern). Keep this module free of side effects: `/api/inngest` imports it at module-eval.
 *
 * `isDev`: inngest v4 defaults to cloud mode and refuses to serve without INNGEST_SIGNING_KEY. Under `nuxt dev` we want the
 * local dev server (`npm run dev:inngest`, :8288) with no real keys, so dev mode is pinned to Nuxt's own dev flag; outside
 * dev it is left undefined so the SDK's detection (INNGEST_DEV, or the signing/event keys from Vercel) decides.
 */
import { Inngest } from 'inngest'

export const inngest = new Inngest({
  id: 'gpe',
  isDev: import.meta.dev || undefined
})
