import { z } from 'zod'
import { invalidateCatalog } from '../../../utils/agentApi'
import { must, useSupabase } from '../../../utils/supabase'

/**
 * Sets papers.public, the flag that lists a paper on the agent API (/llms.txt, /api/v1, /api/mcp). The HTTP twin of
 * `npm run paper:public`. Operator-only via the /api write guard.
 * The agent API caches per instance for a minute, so a flip shows up within that.
 */
const bodySchema = z.object({ public: z.boolean() })

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const body = await readValidatedBody(event, bodySchema.parse)
  const row = must(await useSupabase().from('papers').update({ public: body.public }).eq('slug', slug).select('slug, public').maybeSingle())
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: `No paper "${slug}"` })
  }
  // A family's "digested" list counts public papers only.
  invalidateCatalog()
  return row
})
