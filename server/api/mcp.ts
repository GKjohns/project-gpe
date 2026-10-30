/**
 * /api/mcp — the public, read-only MCP endpoint (streamable HTTP, stateless). Tools: server/utils/mcpTools.ts.
 *
 * No model calls and no runs, so a request costs a database read. Rate limiting is a Vercel Firewall rule on
 * /api/mcp and /api/v1, not code.
 */
import { createMcpHandler } from '@modelcontextprotocol/server'
import { agentApiDeps } from '../utils/agentApi'
import { createDigestMcpServer } from '../utils/mcpTools'

const handler = createMcpHandler(() => createDigestMcpServer(agentApiDeps()), {
  // Tool results are single JSON bodies; nothing streams.
  responseMode: 'json',
  onerror: err => console.warn('[mcp]', err.message)
})

export default defineEventHandler(event => handler.fetch(toWebRequest(event)))
