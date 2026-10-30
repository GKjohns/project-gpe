// GET /api/v1/papers — list_papers for agents without MCP. See /llms.txt.
import { agentApiDeps } from '../../utils/agentApi'
import { listPaperRows } from '../../utils/mcpTools'

export default defineEventHandler(() => listPaperRows(agentApiDeps()))
