// GET /api/v1/families/:code — one family with its manuscripts. `49` and `049` are the same family.
import { familyDetail } from '../../../catalog/query'
import { loadCatalog } from '../../../utils/agentApi'
import { logAgentRequest } from '../../../utils/agentLog'

export default defineEventHandler(async (event) => {
  const started = Date.now()
  const code = getRouterParam(event, 'code') ?? ''
  let status = 500
  try {
    const family = /^\d{1,3}$/.test(code) ? familyDetail(await loadCatalog(), Number(code)) : null
    if (!family) {
      status = 404
      setResponseStatus(event, 404)
      return { error: `No family "${code}". GET /api/v1/families lists them.` }
    }
    setResponseHeader(event, 'cache-control', 'public, max-age=300')
    status = 200
    return family
  } finally {
    logAgentRequest(event, { surface: 'v1', tool: 'get_family', status, ms: Date.now() - started })
  }
})
