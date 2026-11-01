// POST /api/admin/catalog/sync — re-reads the openai/math index at main's current commit (the HTTP twin of
// `npm run catalog:sync`). Operator-only via the /api write guard.
import { z } from 'zod'
import { CatalogInvalidError, syncCatalog } from '../../../catalog/sync'
import { invalidateCatalog } from '../../../utils/agentApi'

const bodySchema = z.object({ force: z.boolean().optional() }).optional()

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  try {
    const report = await syncCatalog({ force: body?.force })
    invalidateCatalog()
    return report
  } catch (err) {
    if (err instanceof CatalogInvalidError) {
      throw createError({ statusCode: 422, statusMessage: 'openai/math index failed validation', data: { problems: err.problems } })
    }
    throw err
  }
})
