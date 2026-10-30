// GET /llms.txt (also /agents.md) — the URL to hand an agent: plain markdown naming the API, the papers and every tool.
import { agentApiDeps } from '../utils/agentApi'
import { agentGuide, listPaperRows } from '../utils/mcpTools'

export default defineEventHandler(async (event) => {
  const deps = agentApiDeps()
  setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=300')
  return agentGuide(await listPaperRows(deps), deps.appUrl)
})
