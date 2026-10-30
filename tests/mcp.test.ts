import { readFileSync } from 'node:fs'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import type { PaperDigest } from '#shared/types'
import { chunkLatex } from '../server/pipeline/latex/chunk'
import { toyDigest } from '../server/fixtures/toy-digest'
import { buildChatSources } from '../server/utils/chatTools'
import type { McpDeps } from '../server/utils/mcpTools'
import { agentGuide, createDigestMcpServer, getNode, listNodes, PAPER_TOOLS, paperFriction, paperOverview, runPaperTool, ToolError } from '../server/utils/mcpTools'

const APP = 'https://gpe.example'
const dir = new URL('./fixtures/latex/toy/', import.meta.url)
const files = ['main.tex', 'sections/prelim.tex'].map(path => ({ path, content: readFileSync(new URL(path, dir), 'utf8') }))
const { skeleton } = chunkLatex(files, { mainFile: 'main.tex' })

const deps: McpDeps = {
  listPapers: async () => [{ slug: 'toy', title: toyDigest.title, authors: [], source: toyDigest.source.ref, nodes: toyDigest.nodes.length }],
  loadDigest: async slug => slug === 'toy' ? toyDigest : null,
  loadSources: async () => buildChatSources(files, skeleton, null),
  appUrl: APP
}

describe('agent api tools', () => {
  it('overview has the main results, sections with node counts, and a link', () => {
    const out = paperOverview(toyDigest, APP)
    expect(out.url).toBe(`${APP}/toy`)
    expect(out.main_results.map(n => n.id)).toEqual(toyDigest.root_ids)
    expect(out.sections.reduce((a, s) => a + s.nodes, 0)).toBe(toyDigest.nodes.length)
    expect(out.counts.nodes).toBe(toyDigest.nodes.length)
  })

  it('list_nodes pages and filters', () => {
    const first = listNodes(toyDigest, { limit: 2 })
    expect(first.nodes).toHaveLength(2)
    expect(first.next_offset).toBe(2)
    const rest = listNodes(toyDigest, { offset: 2, limit: 200 })
    expect(rest.next_offset).toBeUndefined()
    expect(first.total).toBe(toyDigest.nodes.length)
    expect(listNodes(toyDigest, { kind: 'theorem' }).nodes.every(n => n.kind === 'theorem')).toBe(true)
  })

  it('get_node resolves labels and returns edges both ways', () => {
    const thm = toyDigest.nodes.find(n => n.id === toyDigest.root_ids[0])!
    const out = getNode(toyDigest, thm.paper_ref.label ?? thm.id, APP)
    expect(out.id).toBe(thm.id)
    expect(out.url).toBe(`${APP}/toy/${thm.id}`)
    expect(out.uses.map(n => n.id).sort()).toEqual([...new Set([...thm.deps_paper, ...thm.deps_inferred])].sort())
  })

  it('friction is worst first and filterable', () => {
    const all = paperFriction(toyDigest, {})
    expect(all.total).toBe(toyDigest.nodes.reduce((a, n) => a + n.friction.length, 0))
    expect(paperFriction(toyDigest, { severity: 'high' }).items.every(f => f.severity === 'high')).toBe(true)
  })

  it('runPaperTool validates input and maps unknowns to 404', async () => {
    await expect(runPaperTool(deps, 'nope', 'toy', {})).rejects.toMatchObject({ status: 404 })
    await expect(runPaperTool(deps, 'get_overview', 'missing', {})).rejects.toMatchObject({ status: 404 })
    await expect(runPaperTool(deps, 'get_node', 'toy', {})).rejects.toMatchObject({ status: 400 })
    const err = await runPaperTool(deps, 'get_node', 'toy', { id: 'lem-nothing-here' }).catch(e => e)
    expect(err).toBeInstanceOf(ToolError)
    expect(err.status).toBe(404)
  })

  it('the guide names both entry points, every tool and the papers', () => {
    const md = agentGuide([{ slug: 'toy', title: 'Toy', authors: [], source: 'x', nodes: 3, url: `${APP}/toy` }], APP)
    expect(md).toContain(`${APP}/api/v1/papers`)
    expect(md).toContain(`${APP}/api/mcp`)
    expect(md).toContain('`toy`: Toy, 3 nodes.')
    for (const name of Object.keys(PAPER_TOOLS)) {
      expect(md).toContain(`### ${name}`)
    }
    expect(md).toContain('`direction` (`supports` \\| `supported_by`, required)')
  })
})

describe('mcp endpoint', () => {
  async function connect(d: McpDeps = deps) {
    const handler = createMcpHandler(() => createDigestMcpServer(d), { responseMode: 'json' })
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${APP}/api/mcp`), { fetch: (url, init) => handler.fetch(new Request(url, init)) }))
    return client
  }

  it('lists every tool as read-only, with a paper argument', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name).sort()).toEqual(['list_papers', ...Object.keys(PAPER_TOOLS)].sort())
    expect(tools.every(t => t.annotations?.readOnlyHint)).toBe(true)
    const node = tools.find(t => t.name === 'get_node')!
    expect(node.inputSchema.required).toEqual(expect.arrayContaining(['paper', 'id']))
  })

  it('calls a tool and returns JSON text', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'trace', arguments: { paper: 'toy', from: toyDigest.nodes[0]!.id, to: toyDigest.root_ids[0]! } })
    expect(res.isError).toBeFalsy()
    const out = JSON.parse((res.content as { text: string }[])[0]!.text)
    expect(out).toHaveProperty('paths')
  })

  it('reads source through the injected loader', async () => {
    const fixture: PaperDigest = { ...toyDigest, slug: 'toy' }
    const client = await connect({ ...deps, loadDigest: async () => fixture })
    const res = await client.callTool({ name: 'search_paper', arguments: { paper: 'toy', query: 'Induct' } })
    expect(res.isError).toBeFalsy()
  })

  it('returns unknown papers as tool errors, not protocol errors', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'get_overview', arguments: { paper: 'missing' } })
    expect(res.isError).toBe(true)
    expect((res.content as { text: string }[])[0]!.text).toContain('list_papers')
  })
})
