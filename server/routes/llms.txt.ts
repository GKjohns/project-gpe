// GET /llms.txt (also /agents.md) — the URL to hand an agent: plain markdown naming the API, the public papers and
// every tool.
import { catalogStats } from '../catalog/query'
import { agentApiDeps, loadCatalog } from '../utils/agentApi'
import { logAgentRequest } from '../utils/agentLog'
import { agentGuide, listPaperRows } from '../utils/mcpTools'

export default defineEventHandler(async (event) => {
  const started = Date.now()
  let status = 500
  try {
    const deps = agentApiDeps()
    const [rows, catalog] = await Promise.all([listPaperRows(deps), loadCatalog()])
    const stats = catalogStats(catalog)
    const guide = agentGuide(rows, deps.appUrl, stats.families ? stats : undefined)
    setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8')
    setResponseHeader(event, 'cache-control', 'public, max-age=300')
    status = 200
    return guide
  } finally {
    logAgentRequest(event, { surface: 'llms', status, ms: Date.now() - started })
  }
})
