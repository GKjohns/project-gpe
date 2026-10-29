/**
 * Inngest serve endpoint (`/api/inngest`). Uses the Web-standard `inngest/edge` adapter, not `inngest/nuxt`: that one
 * imports `send` from a bare 'h3', which resolves to the hoisted h3@2 (no `send`) instead of Nitro's h3@1 and 500s the server.
 * The Vercel ceiling for each step invocation is `nitro.vercel.functions.maxDuration` in nuxt.config.ts (Nitro builds
 * one function, so it is set there, not per route).
 */
import { serve } from 'inngest/edge'
import { inngest } from '../utils/inngest'
import { ingestPaperFn } from '../inngest/functions/ingest-paper'

const handler = serve({
  client: inngest,
  functions: [ingestPaperFn],
  servePath: '/api/inngest'
})

export default defineEventHandler(event => handler(toWebRequest(event)))
