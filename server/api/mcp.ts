/**
 * /api/mcp — the public, read-only MCP endpoint (streamable HTTP, stateless). Tools: server/utils/mcpTools.ts.
 *
 * No model calls and no runs, so a request costs a database read. Rate limiting is a Vercel Firewall rule on
 * /api/mcp and /api/v1, not code. Each tools/call (and initialize) is logged to agent_requests after the response.
 */
import { createMcpHandler } from '@modelcontextprotocol/server'
import { agentApiDeps } from '../utils/agentApi'
import { agentEntry, hasLoggedCalls, mcpCalls, parseRpc, recordAgentRequests, requestInfo } from '../utils/agentLog'
import { createDigestMcpServer } from '../utils/mcpTools'

const handler = createMcpHandler(() => createDigestMcpServer(agentApiDeps()), {
  // Tool results are single JSON bodies; nothing streams.
  responseMode: 'json',
  onerror: err => console.warn('[mcp]', err.message)
})

export default defineEventHandler(async (event) => {
  const started = Date.now()
  const request = toWebRequest(event)
  const body = request.method === 'POST' ? request.clone().text().catch(() => '') : null
  const response = await handler.fetch(request)
  const ms = Date.now() - started
  // The handler has read the body by now, so this await is free. Only tools/call and initialize are logged; their
  // replies are finite (one JSON body or one SSE message), so cloning one never buffers an open stream.
  const messages = body ? parseRpc(await body) : []
  if (hasLoggedCalls(messages)) {
    const info = requestInfo(event)
    const reply = response.clone().text().catch(() => '')
    // Off the response path: the client streams the original while this reads the clone, inside one waitUntil.
    event.waitUntil?.(reply
      .then(r => recordAgentRequests(mcpCalls(messages, parseRpc(r), response.status).map(c => agentEntry(info, { ...c, ms }))))
      .catch(err => console.warn('[agent-log]', (err as Error).message)))
  }
  return response
})
