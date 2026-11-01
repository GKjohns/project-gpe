// GET /api/v1/families?q&discipline&digested&lean&sort&limit&offset — the openai/math catalog, for the site's pages
// and for agents (see /llms.txt). Built from the repo index, no model calls.
import { z } from 'zod'
import { LIMIT_MAX, queryFamilies } from '../../catalog/query'
import { loadCatalog } from '../../utils/agentApi'
import { logAgentRequest } from '../../utils/agentLog'

const querySchema = z.object({
  q: z.string().optional(),
  discipline: z.string().optional(),
  digested: z.enum(['1', '0']).optional(),
  lean: z.enum(['1', '0']).optional(),
  sort: z.enum(['flagship', 'number', 'title', 'members']).optional(),
  limit: z.coerce.number().int().min(1).max(LIMIT_MAX).optional(),
  offset: z.coerce.number().int().min(0).optional()
})

export default defineEventHandler(async (event) => {
  const started = Date.now()
  let status = 500
  try {
    const parsed = querySchema.safeParse(getQuery(event))
    if (!parsed.success) {
      status = 400
      setResponseStatus(event, 400)
      return { error: `Bad query: ${z.prettifyError(parsed.error)}` }
    }
    const res = queryFamilies(await loadCatalog(), parsed.data)
    setResponseHeader(event, 'cache-control', 'public, max-age=300')
    status = 200
    return res
  } finally {
    logAgentRequest(event, { surface: 'v1', tool: 'list_families', status, ms: Date.now() - started })
  }
})
