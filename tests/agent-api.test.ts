import { randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { toyDigest } from '../server/fixtures/toy-digest'
import { invalidateCatalog, listPublicPapers, loadPublicDigest } from '../server/utils/agentApi'
import { agentEntry, attributionRef, classifyUserAgent, hashIp, hasLoggedCalls, mcpCalls, parseRpc, recordAgentRequests, setAgentLogSink } from '../server/utils/agentLog'
import { agentRequestStats, formatAgentStats } from '../server/utils/agentStats'
import type { McpDeps } from '../server/utils/mcpTools'
import { createDigestMcpServer } from '../server/utils/mcpTools'
import { setSupabase } from '../server/utils/supabase'
import { createFakeSupabase } from './helpers/fakeSupabase'

let fake: ReturnType<typeof createFakeSupabase>
const paper = (slug: string, isPublic: boolean, digest: unknown = { ...toyDigest, slug }) =>
  // Seed rows skip the fake's column defaults, so they carry id and timestamps themselves.
  ({ id: randomUUID(), slug, title: slug, authors: [], source_kind: 'arxiv', source_ref: slug, digest, public: isPublic, manuscript_dir: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
beforeAll(() => {
  fake = createFakeSupabase({ papers: [paper('eth', true), paper('eth-agent', false), paper('undigested', true, null)] })
  setSupabase(fake.client)
  invalidateCatalog()
})

describe('public flag', () => {
  it('lists only public, digested papers', async () => {
    expect((await listPublicPapers()).map(p => p.slug)).toEqual(['eth'])
  })

  it('a private slug loads like a missing one', async () => {
    expect((await loadPublicDigest('eth'))?.slug).toBe('eth')
    expect(await loadPublicDigest('eth-agent')).toBeNull()
    expect(await loadPublicDigest('nope')).toBeNull()
    // The toy fallback is dev-only.
    expect(await loadPublicDigest('toy')).toBeNull()
  })

  it('new papers start private', async () => {
    // Insert as the routes do: no `public`, so the column default applies.
    await fake.client.from('papers').insert({ slug: 'fresh', title: 'Fresh', source_kind: 'arxiv', source_ref: 'x', digest: toyDigest as never })
    expect((await listPublicPapers()).map(p => p.slug)).not.toContain('fresh')
  })
})

describe('user-agent classification', () => {
  it.each([
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)', 'Claude-User'],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', 'ChatGPT-User'],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot', 'OAI-SearchBot'],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', 'PerplexityBot'],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)', 'Perplexity-User'],
    ['curl/8.7.1', 'curl'],
    ['python-requests/2.32.3', 'python-requests'],
    ['python-httpx/0.27.0', 'python'],
    ['node', 'node'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'browser'],
    ['SomethingElse/1.0', 'other'],
    ['', 'other'],
    [undefined, 'other']
  ])('%s → %s', (ua, family) => {
    expect(classifyUserAgent(ua)).toBe(family)
  })
})

describe('log entries', () => {
  it('hashes the ip with the salt, truncates the user-agent and keeps the ref', () => {
    const e = agentEntry({ userAgent: `curl/8 ${'x'.repeat(500)}`, ip: '203.0.113.9', ref: 'blog' }, { surface: 'v1', tool: 'get_node', paper: 'eth', status: 200, ms: 12.4 })
    expect(e).toMatchObject({ surface: 'v1', tool: 'get_node', paper: 'eth', status: 200, ms: 12, client: 'curl', ref: 'blog' })
    expect(e.userAgent).toHaveLength(300)
    expect(e.ipHash).toBe(hashIp('203.0.113.9'))
    expect(e.ipHash).not.toContain('203.0.113.9')
    expect(hashIp('203.0.113.9', 'a')).not.toBe(hashIp('203.0.113.9', 'b'))
    expect(agentEntry({}, { surface: 'llms', status: 200, ms: 1 })).toMatchObject({ client: 'other', ipHash: null, ref: null, tool: null })
  })

  it('a tool that takes its own `ref` (view_figure) keeps it as an argument, not attribution', () => {
    expect(attributionRef({ ref: 'blog' }, ['id'])).toBe('blog')
    expect(attributionRef({ ref: '2' }, ['ref'])).toBeNull()
    expect(attributionRef({})).toBeNull()
  })

  it('a failing write is swallowed and still handed to waitUntil', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const prev = setAgentLogSink(async () => {
      throw new Error('db down')
    })
    const waited: Promise<unknown>[] = []
    await expect(recordAgentRequests([agentEntry({}, { surface: 'llms', status: 200, ms: 1 })], p => waited.push(p))).resolves.toBeUndefined()
    expect(waited).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith('[agent-log]', 'db down')
    setAgentLogSink(prev)
    warn.mockRestore()
  })

  it('the default sink inserts snake_case agent_requests rows', async () => {
    const info = { userAgent: 'curl/8', ip: '198.51.100.1', ref: 'blog' }
    await recordAgentRequests([
      agentEntry(info, { surface: 'v1', tool: 'get_overview', paper: 'eth', status: 200, ms: 5 }),
      agentEntry({ ip: '198.51.100.2' }, { surface: 'llms', status: 404, ms: 2 })
    ])
    expect(fake.tables.agent_requests).toHaveLength(2)
    expect(fake.tables.agent_requests![0]).toMatchObject({ surface: 'v1', tool: 'get_overview', paper: 'eth', status: 200, client: 'curl', user_agent: 'curl/8', ip_hash: hashIp('198.51.100.1'), ref: 'blog' })
  })

  it('reads the readout from RPC agent_request_stats', async () => {
    const empty = { key: 'total', requests: 0, callers: 0, errors: 0 }
    const calls: unknown[] = []
    fake.rpcs.agent_request_stats = (a) => {
      calls.push(a)
      return { since: '2026-10-02T12:00:00.5+00:00', total: empty, byDay: [], bySurface: [], byClient: [], byTool: [], byPaper: [], byRef: [] }
    }
    const stats = await agentRequestStats({ days: 30 })
    expect(calls).toEqual([{ p_days: 30 }])
    expect(stats.since.toISOString()).toBe('2026-10-02T12:00:00.500Z')
    expect(stats.total).toEqual(empty)
  })

  it('formats the readout (aggregated by RPC agent_request_stats)', () => {
    const row = (key: string, requests: number, callers: number, errors: number) => ({ key, requests, callers, errors })
    const text = formatAgentStats({
      since: new Date('2026-11-01T00:00:00Z'),
      total: row('total', 3, 2, 1),
      byDay: [row('2026-11-01', 3, 2, 1)],
      bySurface: [row('v1', 2, 1, 1), row('llms', 1, 1, 0)],
      byClient: [],
      byTool: [],
      byPaper: [],
      byRef: []
    })
    expect(text).toContain('Agent API since 2026-11-01: 3 requests, 2 unique callers, 1 errors')
    expect(text).toContain('client\n  (none)')
  })
})

describe('mcp call logging', () => {
  const deps: McpDeps = {
    listPapers: async () => [],
    loadDigest: async slug => slug === 'toy' ? toyDigest : null,
    loadSources: async () => null,
    appUrl: 'https://proofmap.example'
  }

  it('reads tool, paper, client and status off real MCP traffic', async () => {
    const handler = createMcpHandler(() => createDigestMcpServer(deps), { responseMode: 'json' })
    const calls: ReturnType<typeof mcpCalls> = []
    // What server/api/mcp.ts does, minus the event.
    const fetch = async (url: string | URL, init?: RequestInit) => {
      const req = new Request(url, init)
      const body = parseRpc(req.method === 'POST' ? await req.clone().text() : '')
      const res = await handler.fetch(req)
      if (hasLoggedCalls(body)) {
        calls.push(...mcpCalls(body, parseRpc(await res.clone().text()), res.status))
      }
      return res
    }
    const client = new Client({ name: 'test-agent', version: '9.1' })
    await client.connect(new StreamableHTTPClientTransport(new URL('https://proofmap.example/api/mcp'), { fetch }))
    await client.callTool({ name: 'get_overview', arguments: { paper: 'toy' } })
    await client.callTool({ name: 'get_overview', arguments: { paper: 'missing' } })
    await client.listTools()
    const toolCalls = calls.filter(c => c.tool)
    expect(toolCalls).toEqual([
      { surface: 'mcp', tool: 'get_overview', paper: 'toy', status: 200, client: expect.toBeOneOf(['test-agent/9.1', null]) },
      { surface: 'mcp', tool: 'get_overview', paper: 'missing', status: 404, client: expect.toBeOneOf(['test-agent/9.1', null]) }
    ])
    // The client names itself on initialize (legacy) or in every request's _meta (modern); either way it shows up.
    expect(calls.some(c => c.client === 'test-agent/9.1')).toBe(true)
    // Besides the two tool calls, only initialize is logged (not tools/list or notifications).
    expect(calls.filter(c => !c.tool).length).toBeLessThanOrEqual(1)
  })

  it('maps JSON-RPC errors and batches', () => {
    const body = [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_node', arguments: { paper: 'eth', id: 'x' }, _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'claude-ai', version: '0.1.0' } } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope', arguments: {} } },
      { jsonrpc: '2.0', method: 'notifications/initialized' }
    ]
    const reply = [{ jsonrpc: '2.0', id: 1, result: { content: [] } }, { jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'bad' } }]
    expect(mcpCalls(body, reply, 200)).toEqual([
      { surface: 'mcp', tool: 'get_node', paper: 'eth', status: 200, client: 'claude-ai/0.1.0' },
      { surface: 'mcp', tool: 'nope', paper: null, status: 400, client: null }
    ])
    expect(mcpCalls(null, null, 200)).toEqual([])
    expect(parseRpc('event: message\ndata: {"id":3,"result":{"isError":true,"content":[{"type":"text","text":"No node"}]}}\n\n')).toEqual([{ id: 3, result: { isError: true, content: [{ type: 'text', text: 'No node' }] } }])
  })
})
