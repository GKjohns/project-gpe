// GET /api/v1/papers/:slug/:tool?… — the MCP tools as plain GET JSON, for agents that only have fetch or curl.
// Query parameters are the tool's arguments; numeric ones are coerced. `ref` (link attribution, ?ref=blog) is logged,
// not passed on, unless the tool takes a `ref` of its own (view_figure). See /llms.txt.
import { z } from 'zod'
import { agentApiDeps } from '../../../../utils/agentApi'
import { logAgentRequest } from '../../../../utils/agentLog'
import { PAPER_TOOLS, runPaperTool, ToolError } from '../../../../utils/mcpTools'

export default defineEventHandler(async (event) => {
  const started = Date.now()
  const slug = getRouterParam(event, 'slug') ?? ''
  const name = getRouterParam(event, 'tool') ?? ''
  const shape = Object.hasOwn(PAPER_TOOLS, name) ? PAPER_TOOLS[name]!.input.shape : {}
  const args: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (key === 'ref' && !(key in shape)) {
      continue
    }
    const value = Array.isArray(raw) ? raw[0] : raw
    const field = shape[key]
    const inner = field instanceof z.ZodOptional ? field.unwrap() : field
    args[key] = inner instanceof z.ZodNumber && typeof value === 'string' && value !== '' ? Number(value) : value
  }
  let status = 500
  try {
    const { output } = await runPaperTool(agentApiDeps(), name, slug, args)
    status = 200
    return output
  } catch (err) {
    if (err instanceof ToolError) {
      status = err.status
      setResponseStatus(event, err.status)
      return { error: err.message }
    }
    throw err
  } finally {
    logAgentRequest(event, { surface: 'v1', tool: name.slice(0, 64), paper: slug, status, ms: Date.now() - started }, Object.keys(shape))
  }
})
