// The public agent API: read-only tools over papers that are already digested, so other people's agents can browse a
// proof map with their own model. One tool table, served over MCP (/api/mcp) and as GET JSON (/api/v1), and described
// in plain markdown at /llms.txt. Nothing here calls a model or starts a run; every tool is a database
// read plus the pure functions in chatTools.ts. Output sizes are capped (pages, READ_NODE_CHARS) so a careless agent
// can't pull a whole paper per call. Loaders are injected so tests/mcp.test.ts runs it against fixtures.
import { McpServer } from '@modelcontextprotocol/server'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { ChatToolNode } from '#shared/api'
import type { FamilySummary, ManuscriptItem } from '#shared/catalog'
import type { FrictionKind, NodeKind, PaperDigest, ProofNode } from '#shared/types'
import type { ChatSources, FigureImageLoader } from './chatTools'
import { depClosure, READ_SOURCE_LINES, readNode, readSource, resolveFigure, resolveNodeId, searchPaper, traceDeps, viewFigure } from './chatTools'

/**
 * Overview section rows. `from` is the heading's line; `to` is the line before the next section heading in the same file
 * (omitted for a file's last section, whose end read_source reports as `file_lines`). Sections with `nodes: 0` are the
 * ones the map does not reach.
 */
function sectionRows(digest: PaperDigest, bySection: Map<string, number>) {
  const ordered = [...digest.sections].sort((a, b) => a.order - b.order)
  return ordered.map((s) => {
    if (!s.file) {
      return { id: s.id, title: s.title, level: s.level, nodes: bySection.get(s.id) ?? 0 }
    }
    const next = ordered.filter(o => o.file === s.file && o.line > s.line).sort((a, b) => a.line - b.line)[0]
    return { id: s.id, title: s.title, level: s.level, file: s.file, from: s.line, line: s.line, ...(next ? { to: next.line - 1 } : {}), nodes: bySection.get(s.id) ?? 0 }
  })
}

const LIST_NODES_DEFAULT = 50
const LIST_NODES_MAX = 200
const FRICTION_MAX = 100
const CAPTION_CHARS = 160

export interface McpPaperRow {
  slug: string
  title: string
  authors: string[]
  source: string
  nodes: number
  /** The openai/math result family the paper belongs to, when it is a catalogued manuscript. */
  family?: { number: number, code: string, title: string, discipline: string }
  pdf_url?: string
  has_lean?: boolean
  headline?: string
}

/** A paper's place in the openai/math catalog (GET /api/papers/:slug's `catalog`). */
export interface CatalogEntry { family: FamilySummary, manuscript: ManuscriptItem }

export interface McpDeps {
  listPapers: () => Promise<McpPaperRow[]>
  loadDigest: (slug: string) => Promise<PaperDigest | null>
  loadSources: (slug: string, digest: PaperDigest) => Promise<ChatSources | null>
  loadFigureImage?: FigureImageLoader
  /** The family and manuscript a public paper digests; absent or null → get_overview has no `catalog`. */
  loadCatalogEntry?: (slug: string) => Promise<CatalogEntry | null>
  /** Public origin for the links in tool output, no trailing slash. */
  appUrl: string
}

const brief = (n: ProofNode): ChatToolNode => ({ id: n.id, kind: n.kind, name: n.name, ...(n.headline ? { headline: n.headline } : {}) })
const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n - 1)}…` : s

/** `get_overview`: what the paper proves and how it is laid out, without the per-node bodies. */
export function paperOverview(digest: PaperDigest, appUrl: string, catalog?: CatalogEntry | null) {
  const bySection = new Map<string, number>()
  const byKind: Partial<Record<NodeKind, number>> = {}
  for (const n of digest.nodes) {
    bySection.set(n.paper_ref.section, (bySection.get(n.paper_ref.section) ?? 0) + 1)
    byKind[n.kind] = (byKind[n.kind] ?? 0) + 1
  }
  const byId = new Map(digest.nodes.map(n => [n.id, n]))
  return {
    slug: digest.slug,
    title: digest.title,
    authors: digest.authors ?? [],
    source: digest.source,
    url: `${appUrl}/${digest.slug}`,
    ...(digest.summary ? { summary: { headline: digest.summary.headline, proves: digest.summary.proves } } : {}),
    ...(catalog
      ? {
          catalog: {
            family: {
              number: catalog.family.number,
              code: catalog.family.code,
              title: catalog.family.title,
              description: catalog.family.description,
              discipline: catalog.family.discipline,
              members: catalog.family.members,
              has_lean: catalog.family.hasLean,
              url: `${appUrl}/papers/${catalog.family.code}`
            },
            manuscript: {
              dir: catalog.manuscript.dir,
              title: catalog.manuscript.title,
              abstract: catalog.manuscript.abstract,
              ...(catalog.manuscript.publishedOn ? { published_on: catalog.manuscript.publishedOn } : {}),
              pdf_url: catalog.manuscript.pdfUrl,
              source_url: catalog.manuscript.sourceUrl,
              has_lean: catalog.manuscript.hasLean
            }
          }
        }
      : {}),
    main_results: digest.root_ids.map(id => byId.get(id)).filter(n => !!n)
      .map(n => ({ ...brief(n), statement_plain: n.statement_plain })),
    sections: sectionRows(digest, bySection),
    counts: {
      nodes: digest.nodes.length,
      by_kind: byKind,
      novel: digest.nodes.filter(n => n.classification === 'novel').length,
      friction: digest.nodes.reduce((sum, n) => sum + n.friction.length, 0),
      figures: digest.figures?.length ?? 0
    },
    figures: (digest.figures ?? []).map(f => ({
      id: f.id,
      ...(f.number ? { number: f.number } : {}),
      kind: f.kind,
      caption: clip(f.caption, CAPTION_CHARS)
    })),
    generated_at: digest.generated_at
  }
}

/** `list_nodes`: one line per node in paper order, filtered and paged. */
export function listNodes(digest: PaperDigest, opts: { section?: string, kind?: NodeKind, offset?: number, limit?: number }) {
  const all = digest.nodes.filter(n => (!opts.section || n.paper_ref.section === opts.section) && (!opts.kind || n.kind === opts.kind))
  const offset = opts.offset ?? 0
  const limit = Math.min(opts.limit ?? LIST_NODES_DEFAULT, LIST_NODES_MAX)
  const page = all.slice(offset, offset + limit)
  return {
    total: all.length,
    offset,
    nodes: page.map(n => ({ ...brief(n), section: n.paper_ref.section, classification: n.classification })),
    ...(offset + limit < all.length ? { next_offset: offset + limit } : {})
  }
}

/** `get_node`: the annotated node (plain statement, explanation, classification, friction) and its direct edges. */
export function getNode(digest: PaperDigest, rawId: string, appUrl: string) {
  const n = resolveNodeId(digest, rawId)
  const byId = new Map(digest.nodes.map(x => [x.id, x]))
  const uses = [...new Set([...n.deps_paper, ...n.deps_inferred])].map(id => byId.get(id)).filter(x => !!x)
    .map(x => ({ ...brief(x), ...(n.deps_paper.includes(x.id) ? {} : { inferred: true }) }))
  const usedBy = digest.nodes.filter(x => x.deps_paper.includes(n.id) || x.deps_inferred.includes(n.id)).map(brief)
  return {
    ...brief(n),
    url: `${appUrl}/${digest.slug}/${n.id}`,
    ...(n.paper_ref.label ? { label: n.paper_ref.label } : {}),
    section: n.paper_ref.section,
    ...(n.role ? { role: n.role } : {}),
    statement_paper: n.statement_paper,
    statement_plain: n.statement_plain,
    explanation: n.explanation,
    classification: n.classification,
    ...(n.classification_cite ? { classification_cite: n.classification_cite } : {}),
    ...(n.parent_id && byId.get(n.parent_id) ? { parent: brief(byId.get(n.parent_id)!) } : {}),
    uses,
    used_by: usedBy,
    friction: n.friction
  }
}

/** `get_friction`: every paper-internal friction item, worst first. */
export function paperFriction(digest: PaperDigest, opts: { severity?: 'info' | 'warn' | 'high', kind?: FrictionKind }) {
  const rank = { high: 0, warn: 1, info: 2 }
  const items = digest.nodes.flatMap(n => n.friction.map(f => ({ node: n.id, name: n.name, ...f })))
    .filter(f => (!opts.severity || f.severity === opts.severity) && (!opts.kind || f.kind === opts.kind))
    .sort((a, b) => rank[a.severity] - rank[b.severity])
  return { total: items.length, items: items.slice(0, FRICTION_MAX), ...(items.length > FRICTION_MAX ? { truncated: true } : {}) }
}

// --- the tool table: one definition per tool, served over MCP (/api/mcp) and as GET JSON (/api/v1) ---

interface ToolCtx { slug: string, digest: PaperDigest, appUrl: string, sources: () => Promise<ChatSources | null>, catalog: () => Promise<CatalogEntry | null> }
interface PaperTool {
  title: string
  description: string
  /** Arguments besides `paper`. */
  input: z.ZodObject
  run: (ctx: ToolCtx, args: never) => unknown
}
const paperTool = <S extends z.ZodObject>(t: { title: string, description: string, input: S, run: (ctx: ToolCtx, args: z.infer<S>) => unknown }) => t as unknown as PaperTool

const nodeId = z.string().describe('Node id, e.g. lem-greedy-hashes, or a LaTeX label like lem:greedy-hashes')

export const PAPER_TOOLS: Record<string, PaperTool> = {
  get_overview: paperTool({
    title: 'Paper overview',
    description: 'A paper\'s summary and main results (with plain-English statements), its openai/math family and manuscript (PDF, Lean status), its sections with node counts, counts by kind, and its figures. Start here.',
    input: z.object({}),
    run: async ({ digest, appUrl, catalog }) => paperOverview(digest, appUrl, await catalog())
  }),
  list_nodes: paperTool({
    title: 'List nodes',
    description: `One line per node (id, kind, name, headline, section, classification) in paper order. Filter by section id or kind; pages of ${LIST_NODES_DEFAULT} by default (max ${LIST_NODES_MAX}), follow next_offset for more.`,
    input: z.object({
      section: z.string().optional().describe('Section id from get_overview'),
      kind: z.enum(['definition', 'lemma', 'proposition', 'theorem', 'corollary', 'claim', 'remark']).optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(LIST_NODES_MAX).optional()
    }),
    run: ({ digest }, args) => listNodes(digest, args)
  }),
  get_node: paperTool({
    title: 'Get node',
    description: 'One node as the map explains it: plain-English statement, why it is in the paper, standard/routine/novel classification with its reason, friction notes, what it uses and what uses it, and a link.',
    input: z.object({ id: nodeId }),
    run: ({ digest, appUrl }, { id }) => getNode(digest, id, appUrl)
  }),
  read_node: paperTool({
    title: 'Read node source',
    description: 'One node\'s verbatim LaTeX statement and proof (or claim span) from the paper\'s source with file and line numbers, plus the equations it references. Use it to quote a proof or check an exact step or constant.',
    input: z.object({ id: nodeId }),
    run: async ({ digest, sources }, { id }) => readNode(digest, id, await sources())
  }),
  read_source: paperTool({
    title: 'Read source lines',
    description: `A line range of one LaTeX source file, numbered and comment-stripped like read_node's proof text, by file+from/to or by section id, with the nodes and equations that fall in it. Prefer it over search_paper when the text you need is contiguous prose outside any node (a search hit with no \`node\`), a proof's second environment, or a section get_overview shows with 0 nodes. At most ${READ_SOURCE_LINES} lines per call; follow next_from for the rest.`,
    input: z.object({
      file: z.string().optional().describe('Source file, as in a search hit or get_overview section (e.g. main.tex); required unless section is given'),
      from: z.number().int().min(1).optional().describe('First line, 1-based inclusive (default 1)'),
      to: z.number().int().min(1).optional().describe('Last line, inclusive; past the end of the file clamps'),
      section: z.string().optional().describe('Section id from get_overview (e.g. D.4.5): its heading up to the next heading in the same file'),
      offset: z.number().int().min(0).optional().describe('Lines to skip from the start of the span, for paging')
    }),
    run: async ({ digest, appUrl, slug, sources }, args) => {
      const out = readSource(digest, await sources(), args)
      return { ...out, nodes_in_range: out.nodes_in_range.map(n => ({ ...n, url: `${appUrl}/${slug}/${n.id}` })) }
    }
  }),
  search_paper: paperTool({
    title: 'Search paper source',
    description: 'Case-insensitive search over the paper\'s LaTeX source, ignoring LaTeX punctuation (\\sqrt{\\log n} matches "sqrt log n"). Returns file:line, section, the node containing the line, and ±2 lines of context.',
    input: z.object({
      query: z.string().min(1).describe('Words or a LaTeX fragment'),
      max: z.number().int().min(1).max(15).optional().describe('Hits to return (default 10, max 15)')
    }),
    run: async ({ digest, sources }, { query, max }) => searchPaper(digest, await sources(), query, max)
  }),
  trace: paperTool({
    title: 'Trace dependencies',
    description: 'Up to 3 shortest dependency paths from a supporting node to a result that rests on it. Use it for "how does X lead to Y"; says when no path exists and whether the reverse holds.',
    input: z.object({ from: z.string().describe('The supporting node'), to: z.string().describe('The result') }),
    run: ({ digest }, { from, to }) => traceDeps(digest, from, to)
  }),
  ancestors: paperTool({
    title: 'Dependency closure',
    description: 'Everything a node rests on (direction "supported_by") or everything that rests on it ("supports"), grouped by distance.',
    input: z.object({
      id: nodeId,
      direction: z.enum(['supports', 'supported_by']),
      depth: z.number().int().min(1).max(6).optional().describe('Levels to follow (default 3)')
    }),
    run: ({ digest }, { id, direction, depth }) => depClosure(digest, id, direction, depth)
  }),
  view_figure: paperTool({
    title: 'View figure',
    description: 'One figure: LaTeX caption, description, data summary for charts, page, section, the nodes it supports, and a link to the figure image when one was rendered (over MCP the image itself is attached).',
    input: z.object({ ref: z.string().describe('Figure id or label from get_overview, "Figure 2", or 2') }),
    run: ({ digest, appUrl }, { ref }) => {
      const fig = resolveFigure(digest, ref)
      return { ...viewFigure(digest, ref, !!fig.image_url), ...(fig.image_url ? { image_url: `${appUrl}${fig.image_url}` } : {}) }
    }
  }),
  get_friction: paperTool({
    title: 'Friction',
    description: `Places where the map is uncertain about the paper: dependencies inferred from prose rather than cited, unresolved references, structure the pipeline was unsure of. Worst first, at most ${FRICTION_MAX}.`,
    input: z.object({
      severity: z.enum(['info', 'warn', 'high']).optional(),
      kind: z.enum(['inferred_dep', 'unresolved_ref', 'structure_uncertain']).optional()
    }),
    run: ({ digest }, args) => paperFriction(digest, args)
  })
}

const LIST_PAPERS_DESCRIPTION = 'Every paper that has a proof map: slug, title, authors, source, node count and link; for openai/math manuscripts also `family` (number, code, title, discipline), `pdf_url`, `has_lean` and a one-line `headline` when the map has a summary.'

/** A mistake in the request (status 400) or something it names that doesn't exist (404); the message is for the agent. */
export class ToolError extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message)
  }
}

/**
 * Runs one paper tool by name, validating `args`. Throws ToolError for anything the caller got wrong (unknown tool,
 * paper or node, with suggestions); other errors (the database) propagate.
 */
export async function runPaperTool(deps: McpDeps, name: string, slug: string, args: unknown, digests = new Map<string, Promise<PaperDigest | null>>()) {
  const tool = Object.hasOwn(PAPER_TOOLS, name) ? PAPER_TOOLS[name]! : null
  if (!tool) {
    throw new ToolError(`No tool "${name}". Tools: ${Object.keys(PAPER_TOOLS).join(', ')}.`, 404)
  }
  const parsed = tool.input.safeParse(args)
  if (!parsed.success) {
    throw new ToolError(`Bad arguments for ${name}: ${z.prettifyError(parsed.error)}`, 400)
  }
  const digest = await (digests.get(slug) ?? digests.set(slug, deps.loadDigest(slug)).get(slug)!)
  if (!digest) {
    throw new ToolError(`No digested paper "${slug}". Call list_papers for the available slugs.`, 404)
  }
  let sources: Promise<ChatSources | null> | null = null
  const ctx: ToolCtx = {
    slug,
    digest,
    appUrl: deps.appUrl,
    sources: () => sources ??= deps.loadSources(slug, digest).catch(() => null),
    catalog: () => deps.loadCatalogEntry?.(slug).catch(() => null) ?? Promise.resolve(null)
  }
  try {
    return { digest, output: await tool.run(ctx, parsed.data as never) }
  } catch (err) {
    // chatTools throws plain Errors for unknown ids ("No node …", "No figure …") and bad input ("Empty query.").
    const message = (err as Error).message
    throw new ToolError(message, message.startsWith('No ') ? 404 : 400)
  }
}

export async function listPaperRows(deps: McpDeps) {
  return (await deps.listPapers()).map(p => ({ ...p, url: `${deps.appUrl}/${p.slug}` }))
}

// --- MCP ---

const json = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })
const fail = (err: unknown): CallToolResult => ({ isError: true, content: [{ type: 'text', text: (err as Error).message }] })
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

const INSTRUCTIONS = `Proof maps of math papers: every definition, lemma and theorem, plus the major claims inside long proofs, with plain-English explanations and dependency edges. Start with list_papers, then get_overview for a paper's main results and sections. get_node gives one node's explanation and direct edges; read_node gives its verbatim LaTeX statement and proof. Use trace for "how does X lead to Y" (the edges on a node are only direct uses), ancestors for everything a node rests on or supports, search_paper to find where something is defined or used. When the text you need is outside any node (a search hit without a node, a section with 0 nodes, a proof's second environment), read_source reads a file line range or a whole section in one call. Node ids look like lem-greedy-hashes; LaTeX labels (lem:greedy-hashes) also work. Every node has a url you can give the user.`

export function createDigestMcpServer(deps: McpDeps) {
  const server = new McpServer({ name: 'proofmap', title: 'Proofmap: proof maps', version: '1.0.0' }, { instructions: INSTRUCTIONS })
  // Per server instance (one per request): a digest loaded once serves every tool in the call.
  const digests = new Map<string, Promise<PaperDigest | null>>()

  server.registerTool('list_papers', { title: 'List papers', description: LIST_PAPERS_DESCRIPTION, annotations: readOnly },
    () => listPaperRows(deps).then(json, fail))

  for (const [name, tool] of Object.entries(PAPER_TOOLS)) {
    server.registerTool(name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input.extend({ paper: z.string().describe('Paper slug from list_papers') }),
      annotations: readOnly
    }, async ({ paper, ...args }) => {
      try {
        const { digest, output } = await runPaperTool(deps, name, String(paper), args, digests)
        const result = json(output)
        // MCP clients can look at images, so view_figure attaches the PNG as well as linking it.
        if (name === 'view_figure' && deps.loadFigureImage && (output as { image_url?: string }).image_url) {
          const img = await deps.loadFigureImage(resolveFigure(digest, (args as { ref: string }).ref)).catch(() => null)
          if (img) {
            result.content.push({ type: 'image', data: Buffer.from(img.data).toString('base64'), mimeType: img.mediaType })
          }
        }
        return result
      } catch (err) {
        return fail(err)
      }
    })
  }
  return server
}

// --- the agent guide (/llms.txt): plain markdown an agent can fetch to learn the API ---

function argLines(input: z.ZodObject) {
  const schema = z.toJSONSchema(input) as { properties?: Record<string, { type?: string, enum?: string[], description?: string, maximum?: number }>, required?: string[] }
  return Object.entries(schema.properties ?? {}).map(([key, p]) => {
    const type = p.enum ? p.enum.map(v => `\`${v}\``).join(' \\| ') : p.type ?? 'string'
    const required = schema.required?.includes(key) ? 'required' : 'optional'
    return `  - \`${key}\` (${type}, ${required})${p.description ? `: ${p.description}` : ''}`
  })
}

export function agentGuide(papers: (McpPaperRow & { url: string })[], appUrl: string, catalog?: { families: number, manuscripts: number, digested: number }) {
  const api = `${appUrl}/api/v1`
  const example = papers[0]?.slug ?? 'eth'
  const tools = Object.entries(PAPER_TOOLS).map(([name, t]) => [
    `### ${name}`,
    '',
    `\`GET ${api}/papers/<slug>/${name}${argLines(t.input).length ? '?…' : ''}\``,
    '',
    t.description,
    ...(argLines(t.input).length ? ['', ...argLines(t.input)] : [])
  ].join('\n'))
  // The papers listed below, not catalog.digested (families with a map): a mapped paper not yet linked to its family
  // would otherwise make the header disagree with the list.
  const mapped = `${papers.length} ${papers.length === 1 ? 'paper' : 'papers'} mapped`
  const scale = catalog ? `${catalog.families} families catalogued, ${mapped}` : mapped
  const ex = `${api}/papers/${example}`
  const endpoints = [
    ['Papers with a map', `${api}/papers`],
    [`Overview of \`${example}\``, `${ex}/get_overview`],
    [`Nodes of \`${example}\`, first page of 20`, `${ex}/list_nodes?limit=20`],
    [`Nodes of \`${example}\`, second page`, `${ex}/list_nodes?limit=20&offset=20`],
    [`Section 1 of \`${example}\` as numbered source`, `${ex}/read_source?section=1`],
    [`Friction in \`${example}\``, `${ex}/get_friction`],
    ['Catalog search', `${api}/families?q=exponential`],
    ['One family', `${api}/families/${papers.find(p => p.family)?.family?.code ?? '049'}`],
    ['Disciplines and totals', `${api}/disciplines`],
    ['MCP endpoint (POST JSON-RPC; GET explains)', `${appUrl}/api/mcp`]
  ].map(([label, url]) => `- ${label}: [${url}](${url})`).join('\n')
  const perPaper = papers.map(p => `- \`${p.slug}\`: [${api}/papers/${p.slug}/get_overview](${api}/papers/${p.slug}/get_overview)`).join('\n')
  return `# Proofmap: proof maps of OpenAI's openai/math papers (${scale})

[openai/math](https://github.com/openai/math) is a collection of ${catalog?.manuscripts ?? 'several hundred'} machine-written math manuscripts in ${catalog?.families ?? 'a few hundred'} result
families. Proofmap catalogues all of them (title, abstract, discipline, PDF, Lean status) and turns some into
browsable proof maps: every definition, lemma and theorem, plus the major claims inside long proofs, each with a
plain-English statement, an explanation of why it is in the paper, a standard/routine/novel classification, and the
dependency edges between them. This page tells an agent how to read the catalog and the maps. Everything is read-only,
needs no key, and returns JSON.

Two ways in, same tools and same answers:

- **HTTP GET** (works with any fetch or curl): \`${api}\`, described below.
- **MCP** (streamable HTTP): \`${appUrl}/api/mcp\`. Add it as a remote MCP server; the tools are the ones below, each
  with an extra \`paper\` argument (the slug). The catalog endpoints are HTTP only.

## Endpoints

Every link below is a live GET that returns JSON.

${endpoints}

Each paper's overview:

${perPaper || 'None yet.'}

## MCP

\`${appUrl}/api/mcp\` speaks MCP over streamable HTTP (stateless, JSON responses): POST JSON-RPC \`initialize\`, then
\`tools/list\` and \`tools/call\`. The tools are the ones under Tools below; each paper tool takes an extra \`paper\`
argument (the slug). A plain GET of the endpoint returns a short explainer.

## How to use it

1. \`GET ${api}/papers\` lists the papers with a map. Pick a slug. (To find a result that has no map yet, search the
   catalog: \`GET ${api}/families?q=…\`.)
2. \`GET ${api}/papers/<slug>/get_overview\` gives the summary, main results and the section layout.
3. Drill in with \`get_node\` (the explanation and direct edges) and \`read_node\` (the verbatim LaTeX statement and proof).
4. When the text you need is outside any node, or a \`search_paper\` hit has no \`node\`, call \`read_source\` on its
   \`file\`/\`line\` range (or on a \`section\` id from the overview; sections with \`nodes: 0\` are the ones the map
   does not cover). One call reads up to ${READ_SOURCE_LINES} lines; \`next_from\` says where to continue and \`file_lines\` is the file's
   last line. Overview sections carry \`from\`/\`to\` (the heading to the line before the next heading in that file).
5. For "how does X lead to Y", call \`trace\`; a node's own edges are only its direct uses, so don't assemble chains by
   hand. \`ancestors\` gives everything a node rests on or supports.
6. Answer from what the tools return, and cite nodes with their \`url\` so the user can open them in the map.

Node ids look like \`lem-greedy-hashes\`; the paper's LaTeX labels (\`lem:greedy-hashes\`) work too. An unknown id comes back
as an error that lists close matches. Errors are \`{ "error": "…" }\` with status 400 (bad arguments) or 404 (unknown
paper, node, figure, section or family).

Things that cost agents a call before they knew them:

- \`headline\` on a node is optional; older maps have none.
- \`search_paper\` covers the LaTeX source only (not the catalog abstract), every hit carries \`file\` and \`line\`, the
  context is ±2 lines, and at most 15 hits come back in file order. LaTeX labels are plain searchable strings
  (\`eq:main-bound\`). In a query string \`+\` must be written \`%2B\`.
- \`read_node\`'s \`statement\` is a string and its \`proof\` an object (\`location\`, \`text\`, \`source\`) covering the first
  proof environment after the statement; a proof given elsewhere shows up as a \`proof_note\`, and \`read_source\` reads it.
- Most friction notes are \`info\`; \`warn\` is the useful tier, and many papers have no \`high\` note at all.

Example: \`GET ${api}/papers/${example}/trace?from=<node>&to=<node>\`

## Catalog

Every openai/math result family, built from the repository's own index (no model involved). A family has a 3-digit
code (\`049\`), a title and description, a discipline, its manuscripts, Lean status, and \`digested\`: the maps
made from its manuscripts (slug and counts), \`[]\` when none is mapped yet.

### list_families

\`GET ${api}/families?…\`

Families, filtered and paged. Each has number, code, title, description, discipline, members, has Lean, reasoning-trace
PDF (when there is one), and \`digested\`.

  - \`q\` (string, optional): case-insensitive text match against family titles and descriptions and manuscript titles and abstracts
  - \`discipline\` (string, optional): a discipline slug from list_disciplines, e.g. \`combinatorics\`
  - \`digested\` (\`1\` \\| \`0\`, optional): only families with (or without) a map
  - \`lean\` (\`1\` \\| \`0\`, optional): only families with (or without) a Lean formalization
  - \`sort\` (\`flagship\` \\| \`number\` \\| \`title\` \\| \`members\`, optional): default \`flagship\` (featured families first, then mapped, then by number)
  - \`limit\` (integer, optional): default 50, max 400
  - \`offset\` (integer, optional)

### get_family

\`GET ${api}/families/<code>\`

One family (\`049\` or \`49\`) with every manuscript: title, abstract, publication date, PDF, source and README links,
Lean status, and the map's slug when one exists.

### list_disciplines

\`GET ${api}/disciplines\`

Catalog totals (families, manuscripts, disciplines, digested, Lean, the indexed commit) and each discipline's slug, name,
family count and digested count.

## Papers

${papers.length ? papers.map(p => `- \`${p.slug}\`: ${p.title}${p.authors.length ? ` (${p.authors.join(', ')})` : ''}, ${p.nodes} nodes${p.family ? `, family ${p.family.code} (${p.family.discipline})` : ''}. ${p.url}`).join('\n') : 'None yet.'}

## Tools

### list_papers

\`GET ${api}/papers\`

${LIST_PAPERS_DESCRIPTION}

${tools.join('\n\n')}
`
}
