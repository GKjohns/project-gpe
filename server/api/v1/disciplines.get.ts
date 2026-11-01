// GET /api/v1/disciplines — catalog totals and the 17 disciplines with family and digested counts.
import type { DisciplinesResponse } from '#shared/catalog'
import { catalogStats, disciplineList } from '../../catalog/query'
import { loadCatalog } from '../../utils/agentApi'
import { logAgentRequest } from '../../utils/agentLog'

export default defineEventHandler(async (event): Promise<DisciplinesResponse> => {
  const started = Date.now()
  let status = 500
  try {
    const catalog = await loadCatalog()
    setResponseHeader(event, 'cache-control', 'public, max-age=300')
    status = 200
    return { stats: catalogStats(catalog), disciplines: disciplineList(catalog) }
  } finally {
    logAgentRequest(event, { surface: 'v1', tool: 'list_disciplines', status, ms: Date.now() - started })
  }
})
