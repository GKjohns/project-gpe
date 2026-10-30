// GET /api/v1/papers — list_papers for agents without MCP (public papers only). See /llms.txt.
import { agentApiDeps } from '../../utils/agentApi'
import { logAgentRequest } from '../../utils/agentLog'
import { listPaperRows } from '../../utils/mcpTools'

export default defineEventHandler(async (event) => {
  const started = Date.now()
  let status = 500
  try {
    const rows = await listPaperRows(agentApiDeps())
    status = 200
    return rows
  } finally {
    logAgentRequest(event, { surface: 'v1', tool: 'list_papers', status, ms: Date.now() - started })
  }
})
