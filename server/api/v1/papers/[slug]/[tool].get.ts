// GET /api/v1/papers/:slug/:tool?… — the MCP tools as plain GET JSON, for agents that only have fetch or curl.
// Query parameters are the tool's arguments; numeric ones are coerced. See /llms.txt.
import { z } from 'zod'
import { agentApiDeps } from '../../../../utils/agentApi'
import { PAPER_TOOLS, runPaperTool, ToolError } from '../../../../utils/mcpTools'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const name = getRouterParam(event, 'tool') ?? ''
  const shape = Object.hasOwn(PAPER_TOOLS, name) ? PAPER_TOOLS[name]!.input.shape : {}
  const args: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    const value = Array.isArray(raw) ? raw[0] : raw
    const field = shape[key]
    const inner = field instanceof z.ZodOptional ? field.unwrap() : field
    args[key] = inner instanceof z.ZodNumber && typeof value === 'string' && value !== '' ? Number(value) : value
  }
  try {
    return (await runPaperTool(agentApiDeps(), name, slug, args)).output
  } catch (err) {
    if (err instanceof ToolError) {
      setResponseStatus(event, err.status)
      return { error: err.message }
    }
    throw err
  }
})
