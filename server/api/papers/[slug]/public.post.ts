import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../db'
import { papers } from '../../../db/schema'

/**
 * Sets papers.public, the flag that lists a paper on the agent API (/llms.txt, /api/v1, /api/mcp). The HTTP twin of
 * `npm run paper:public`, which can't run while the dev server holds PGlite. Operator-only via the /api write guard.
 * The agent API caches per instance for a minute, so a flip shows up within that.
 */
const bodySchema = z.object({ public: z.boolean() })

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = await useDb()
  const [row] = await db.update(papers).set({ public: body.public }).where(eq(papers.slug, slug)).returning({ slug: papers.slug, public: papers.public })
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: `No paper "${slug}"` })
  }
  return row
})
