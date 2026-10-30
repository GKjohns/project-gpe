// Chat tools (post-sprint): read a node's proof, search the LaTeX, trace dependency paths. The logic is pure
// (digest + optional sources in, JSON out) so tests/chat-tools.test.ts runs it without Nitro or a model.
import { tool } from 'ai'
import { z } from 'zod'
import type { AncestorsOutput, ChatToolNode, ReadNodeOutput, SearchPaperHit, SearchPaperOutput, TraceOutput } from '#shared/api'
import type { Outline, Skeleton } from '#shared/pipeline'
import type { PaperDigest, ProofNode } from '#shared/types'
import { prerequisites } from '../pipeline/dag'
import { stripComment } from '../pipeline/latex/chunk'
import { slugifyLabel, statementIds } from '../pipeline/nodes'
import type { SourceFile } from '../pipeline/sources/main'

/** Characters of statement + proof text read_node returns at most. */
export const READ_NODE_CHARS = 12_000
const SEARCH_DEFAULT = 10
const SEARCH_MAX = 15
const CLOSURE_CAP = 60

interface Span { file: string, start: number, end: number }

/** The paper's sources as the tools see them: comment-stripped lines per file, plus the run's chunk/outline spans. */
export interface ChatSources {
  files: Map<string, string[]>
  order: string[] // .tex files, main file first
  skeleton: Skeleton | null
  outline: Outline | null
  /** Main file's preamble ends here (lines before are skipped by search). */
  bodyStart: number
}

export function buildChatSources(files: SourceFile[], skeleton: Skeleton | null, outline: Outline | null): ChatSources {
  const tex = files.filter(f => /\.tex$/i.test(f.path))
  const map = new Map(tex.map(f => [f.path, f.content.split(/\r?\n/).map(stripComment)]))
  const main = skeleton?.mainFile && map.has(skeleton.mainFile) ? skeleton.mainFile : undefined
  const known = skeleton?.files.map(f => f.path).filter(p => map.has(p)) ?? []
  const order = [...new Set([...(main ? [main] : []), ...known, ...[...map.keys()].sort()])]
  const mainLines = main ? map.get(main)! : []
  const doc = mainLines.findIndex(l => /\\begin\s*\{document\}/.test(l))
  return { files: map, order, skeleton, outline, bodyStart: doc === -1 ? 1 : doc + 2 }
}

// --- ids and display ---

const brief = (n: ProofNode): ChatToolNode => ({ id: n.id, kind: n.kind, name: n.name, ...(n.headline ? { headline: n.headline } : {}) })

/** Accepts an id, `[[id]]`, or a LaTeX label (`lem:greedy-hashes`). Throws with suggestions otherwise. */
export function resolveNodeId(digest: PaperDigest, raw: string): ProofNode {
  const q = raw.trim().replace(/^\[\[|\]\]$/g, '')
  const hit = digest.nodes.find(n => n.id === q)
    ?? digest.nodes.find(n => n.paper_ref.label === q)
    ?? digest.nodes.find(n => n.id === slugifyLabel(q))
  if (hit) {
    return hit
  }
  const tokens = slugifyLabel(q).split('-').filter(t => t.length > 2)
  const near = digest.nodes.filter(n => tokens.some(t => n.id.includes(t))).slice(0, 6).map(n => n.id)
  throw new Error(`No node "${q}" in this digest.${near.length ? ` Close ids: ${near.join(', ')}.` : ''}`)
}

// --- spans (statement, proof, claim) ---

/** `\end{env}` matching the `\begin{env}` at `start`, counting nesting; null if not found within `limit` lines. */
function envEnd(lines: string[], start: number, env: string, limit = 2000): number | null {
  const open = new RegExp(`\\\\begin\\s*\\{${env.replace(/[*]/g, '\\*')}\\}`, 'g')
  const close = new RegExp(`\\\\end\\s*\\{${env.replace(/[*]/g, '\\*')}\\}`, 'g')
  let depth = 0
  for (let i = start; i <= Math.min(lines.length, start + limit); i++) {
    const l = lines[i - 1] ?? ''
    depth += (l.match(open)?.length ?? 0) - (l.match(close)?.length ?? 0)
    if (depth <= 0 && i > start - 1 && close.test(l)) {
      return i
    }
    close.lastIndex = 0
  }
  return null
}

/** Without a chunk output: the statement env at `line`, and a `\begin{proof}` within the next few lines. */
function scanSpans(lines: string[], file: string, line: number): { statement?: Span, proof?: Span } {
  const env = /\\begin\s*\{([^}]+)\}/.exec(lines[line - 1] ?? '')?.[1]
  if (!env) {
    return {}
  }
  const end = envEnd(lines, line, env)
  if (!end) {
    return {}
  }
  const statement = { file, start: line, end }
  for (let i = end + 1; i <= Math.min(lines.length, end + 6); i++) {
    const l = lines[i - 1] ?? ''
    if (/\\begin\s*\{proof\}/.test(l)) {
      const pEnd = envEnd(lines, i, 'proof')
      return { statement, proof: pEnd ? { file, start: i, end: pEnd } : undefined }
    }
    if (/\\begin\s*\{/.test(l) || /\\(sub)*section\b/.test(l)) {
      break
    }
  }
  return { statement }
}

interface NodeSpans { statement?: Span, proof?: Span, claim?: Span, source: 'chunk' | 'outline' | 'scan' }

/** Where each node lives in the sources: chunk output first, outline spans for claims, a scan as the fallback. */
export function nodeSpans(digest: PaperDigest, src: ChatSources): Map<string, NodeSpans> {
  const out = new Map<string, NodeSpans>()
  const byId = new Map<string, Skeleton['statements'][number]>()
  if (src.skeleton) {
    const ids = statementIds(src.skeleton.statements)
    for (const s of src.skeleton.statements) {
      byId.set(ids.get(s.label)!, s)
    }
  }
  const claimSpans = new Map((src.outline?.claims ?? []).map(c => [c.id, c.span]))
  for (const n of digest.nodes) {
    if (n.parent_id) {
      const span = claimSpans.get(n.id)
      if (span) {
        out.set(n.id, { claim: { file: span.file, start: span.startLine, end: span.endLine }, source: 'outline' })
      } else if (src.files.has(n.paper_ref.file)) {
        out.set(n.id, { claim: { file: n.paper_ref.file, start: n.paper_ref.line, end: n.paper_ref.line + 30 }, source: 'scan' })
      }
      continue
    }
    const s = byId.get(n.id) ?? src.skeleton?.statements.find(x => x.label === n.paper_ref.label)
    if (s) {
      out.set(n.id, {
        statement: { file: s.file, start: s.startLine, end: s.endLine },
        proof: s.proof ? { file: s.proof.file, start: s.proof.startLine, end: s.proof.endLine } : undefined,
        source: 'chunk'
      })
      continue
    }
    const lines = src.files.get(n.paper_ref.file)
    if (lines) {
      out.set(n.id, { ...scanSpans(lines, n.paper_ref.file, n.paper_ref.line), source: 'scan' })
    }
  }
  // Claims without a recorded end stop at their parent's proof end.
  for (const n of digest.nodes) {
    const sp = out.get(n.id)
    const parentProof = n.parent_id ? out.get(n.parent_id)?.proof : undefined
    if (sp?.claim && sp.source === 'scan' && parentProof && parentProof.file === sp.claim.file) {
      sp.claim.end = Math.min(sp.claim.end, parentProof.end)
    }
  }
  return out
}

/** Numbered, non-blank lines of a span. */
function spanText(src: ChatSources, s: Span): string {
  const lines = src.files.get(s.file) ?? []
  const out: string[] = []
  for (let i = Math.max(1, s.start); i <= Math.min(lines.length, s.end); i++) {
    const l = lines[i - 1]!
    if (l.trim()) {
      out.push(`${i}| ${l}`)
    }
  }
  return out.join('\n')
}

const where = (s: Span) => `${s.file}:${s.start}-${s.end}`

const REF_RE = /\\(?:eqref|ref|cref|Cref|autoref|label)\*?\s*\{([^}]*)\}/g

function equationsIn(digest: PaperDigest, text: string, cap = 12): ReadNodeOutput['equations'] {
  const eqs = digest.equations ?? {}
  const seen = new Set<string>()
  for (const m of text.matchAll(REF_RE)) {
    for (const label of m[1]!.split(',').map(x => x.trim())) {
      if (eqs[label]) {
        seen.add(label)
      }
    }
  }
  return [...seen].slice(0, cap).map(label => ({ label, ...(eqs[label]!.number ? { number: eqs[label]!.number } : {}), latex: eqs[label]!.latex }))
}

// --- read_node ---

export function readNode(digest: PaperDigest, rawId: string, src: ChatSources | null): ReadNodeOutput {
  const n = resolveNodeId(digest, rawId)
  const byId = new Map(digest.nodes.map(x => [x.id, x]))
  const usedBy = digest.nodes.filter(x => x.deps_paper.includes(n.id) || x.deps_inferred.includes(n.id))
  const section = digest.sections.find(s => s.id === n.paper_ref.section)
  const uses = [...new Set([...n.deps_paper, ...n.deps_inferred])].map(id => byId.get(id)).filter(x => !!x)
    .map(x => ({ ...brief(x), ...(n.deps_paper.includes(x.id) ? {} : { inferred: true }) }))
  const claims = digest.nodes.filter(x => x.parent_id === n.id).map(brief)
  const parent = n.parent_id ? byId.get(n.parent_id) : undefined

  let statement = n.statement_paper
  let proof: ReadNodeOutput['proof'] = null
  let proofNote: string | undefined
  let location: string | undefined
  let truncated: string | undefined
  const all = src ? nodeSpans(digest, src) : undefined
  const spans = all?.get(n.id)
  if (!src) {
    proofNote = 'The LaTeX source is not stored for this paper; only the digest\'s statement is available.'
  } else if (!spans) {
    proofNote = `Could not locate ${n.id} in the stored sources.`
  } else {
    let body = spans.claim ?? spans.proof
    let source = spans.source
    if (!body && claims.length) {
      // No proof environment after the statement (e.g. proved in a later section): its claims' spans say where.
      const cs = claims.map(c => all!.get(c.id)?.claim).filter(x => !!x)
      const file = cs[0]?.file
      const inFile = cs.filter(c => c.file === file)
      if (file && inFile.length) {
        body = { file, start: Math.min(...inFile.map(c => c.start)), end: Math.max(...inFile.map(c => c.end)) }
        source = all!.get(claims[0]!.id)!.source
        proofNote = 'No proof environment follows the statement; this is the span covered by the claims inside its proof.'
      }
    }
    if (spans.statement) {
      location = where(spans.statement)
    }
    if (body) {
      let text = spanText(src, body)
      const room = READ_NODE_CHARS - statement.length
      if (text.length > room) {
        const cut = text.lastIndexOf('\n', room)
        text = text.slice(0, cut > 0 ? cut : room)
        const lastLine = Number(/(\d+)\| [^\n]*$/.exec(text)?.[1] ?? body.start)
        truncated = `Proof text cut at line ${lastLine} of ${where(body)} (${READ_NODE_CHARS} char cap).${claims.length ? ' read_node a claim inside it for a later part.' : ' search_paper can locate a later step.'}`
      }
      proof = { location: where(body), text, source }
    } else {
      proofNote = n.kind === 'definition' ? 'Definitions have no proof.' : 'No proof environment follows this statement in the source (the proof may be elsewhere, e.g. an appendix; try search_paper).'
    }
  }
  if (statement.length > READ_NODE_CHARS) {
    statement = statement.slice(0, READ_NODE_CHARS)
    truncated = `Statement cut at ${READ_NODE_CHARS} chars.`
  }
  return {
    id: n.id,
    kind: n.kind,
    name: n.name,
    ...(n.paper_ref.label ? { label: n.paper_ref.label } : {}),
    ...(n.headline ? { headline: n.headline } : {}),
    ...(n.role ? { role: n.role } : {}),
    section: section ? `§${section.id} ${section.title}` : `§${n.paper_ref.section}`,
    ...(location ? { location } : {}),
    ...(parent ? { parent: brief(parent) } : {}),
    ...(claims.length ? { claims } : {}),
    uses,
    used_by: usedBy.map(brief),
    statement,
    proof,
    ...(proofNote ? { proof_note: proofNote } : {}),
    equations: equationsIn(digest, `${n.statement_paper}\n${proof?.text ?? ''}`),
    ...(truncated ? { truncated } : {})
  }
}

// --- search_paper ---

/** Lowercase, LaTeX punctuation to spaces, √ → sqrt: "\sqrt{\log n}" and "√log n" both become "sqrt log n". */
export function normalizeForSearch(s: string) {
  return s.toLowerCase().replace(/√/g, ' sqrt ').replace(/[\\{}$~^_()[\],;]/g, ' ').replace(/\s+/g, ' ').trim()
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function sectionFor(digest: PaperDigest, file: string, line: number) {
  let found: PaperDigest['sections'][number] | undefined
  for (const s of [...digest.sections].sort((a, b) => a.order - b.order)) {
    if (s.file === file && s.line <= line) {
      found = s
    }
  }
  return found ? `§${found.id} ${found.title}` : undefined
}

export function searchPaper(digest: PaperDigest, src: ChatSources | null, query: string, max = SEARCH_DEFAULT): SearchPaperOutput {
  const limit = Math.max(1, Math.min(SEARCH_MAX, Math.floor(max)))
  const q = query.trim()
  const nq = normalizeForSearch(q)
  if (!nq) {
    throw new Error('Empty query.')
  }
  const raw = q.toLowerCase()
  const tokens = [...new Set(nq.split(' '))]
  const words = tokens.map(t => new RegExp(`(?<![a-z])${escapeRe(t)}(?![a-z])`))
  const exact = (line: string) => line.toLowerCase().includes(raw) || normalizeForSearch(line).includes(nq)
  const allWords = (line: string) => {
    const n = normalizeForSearch(line)
    return words.every(re => re.test(n))
  }

  if (!src) {
    // No stored sources (the toy fixture): search the digest's verbatim statements instead.
    const hits: SearchPaperHit[] = []
    let total = 0
    for (const n of digest.nodes) {
      if (exact(n.statement_paper) || allWords(n.statement_paper)) {
        total++
        if (hits.length < limit) {
          hits.push({ file: n.paper_ref.file, line: n.paper_ref.line, section: sectionFor(digest, n.paper_ref.file, n.paper_ref.line), node: n.id, part: n.parent_id ? 'claim' : 'statement', context: n.statement_paper.slice(0, 400) })
        }
      }
    }
    return { query: q, scope: 'digest', total, hits, note: 'The LaTeX source is not stored for this paper; searched the digest\'s statements only.' }
  }

  const spans: { id: string, part: 'statement' | 'proof' | 'claim', span: Span }[] = []
  for (const [id, s] of nodeSpans(digest, src)) {
    for (const part of ['statement', 'proof', 'claim'] as const) {
      if (s[part]) {
        spans.push({ id, part, span: s[part]! })
      }
    }
  }
  const containing = (file: string, line: number) => spans
    .filter(s => s.span.file === file && s.span.start <= line && line <= s.span.end)
    .sort((a, b) => (a.span.end - a.span.start) - (b.span.end - b.span.start))[0]

  const strong: { file: string, line: number }[] = []
  const weak: { file: string, line: number }[] = []
  for (const file of src.order) {
    const lines = src.files.get(file)!
    const from = file === src.skeleton?.mainFile ? src.bodyStart : 1
    for (let i = from; i <= lines.length; i++) {
      const l = lines[i - 1]!
      if (!l.trim()) {
        continue
      }
      if (exact(l)) {
        strong.push({ file, line: i })
      } else if (tokens.length > 1 && allWords(l)) {
        weak.push({ file, line: i })
      }
    }
  }
  const all = [...strong, ...weak]
  const hits = all.slice(0, limit).map(({ file, line }): SearchPaperHit => {
    const lines = src.files.get(file)!
    const ctx: string[] = []
    for (let i = Math.max(1, line - 2); i <= Math.min(lines.length, line + 2); i++) {
      ctx.push(`${i}${i === line ? '>' : '|'} ${lines[i - 1]!.slice(0, 300)}`)
    }
    const c = containing(file, line)
    return { file, line, section: sectionFor(digest, file, line), ...(c ? { node: c.id, part: c.part } : {}), context: ctx.join('\n') }
  })
  return {
    query: q,
    scope: 'sources',
    total: all.length,
    hits,
    ...(all.length > limit ? { note: `${all.length - limit} more hits not shown; narrow the query.` } : {}),
    ...(!all.length ? { note: 'No hits. LaTeX spells math as macros (\\sqrt{\\log n}); try the words without symbols.' } : {})
  }
}

// --- trace / ancestors over deps_paper ∪ deps_inferred plus claim → parent ---

/** Edges "x feeds into y" (x supports y), from dag.ts's prerequisites. */
function feedsInto(digest: PaperDigest) {
  const pre = prerequisites(digest.nodes)
  const feeds = new Map<string, string[]>()
  for (const [user, deps] of pre) {
    for (const d of deps) {
      (feeds.get(d) ?? feeds.set(d, []).get(d)!).push(user)
    }
  }
  return { pre, feeds }
}

function linkKind(byId: Map<string, ProofNode>, from: string, to: string): TraceOutput['paths'][number]['links'][number] {
  const user = byId.get(to)!
  if (user.deps_paper.includes(from)) {
    return 'cited'
  }
  if (user.deps_inferred.includes(from)) {
    return 'inferred'
  }
  return 'claim of'
}

/** Up to `cap` shortest paths from → to over `adj`, or [] when there is none. */
export function shortestPaths(adj: Map<string, string[]>, from: string, to: string, cap = 3): string[][] {
  const dist = new Map([[from, 0]])
  const parents = new Map<string, string[]>()
  let frontier = [from]
  while (frontier.length && !dist.has(to)) {
    const next: string[] = []
    for (const u of frontier) {
      for (const v of adj.get(u) ?? []) {
        if (!dist.has(v)) {
          dist.set(v, dist.get(u)! + 1)
          next.push(v)
        }
        if (dist.get(v) === dist.get(u)! + 1) {
          (parents.get(v) ?? parents.set(v, []).get(v)!).push(u)
        }
      }
    }
    frontier = next
  }
  if (!dist.has(to)) {
    return []
  }
  const out: string[][] = []
  const walk = (id: string, suffix: string[]) => {
    if (out.length >= cap) {
      return
    }
    if (id === from) {
      out.push([from, ...suffix])
      return
    }
    for (const p of parents.get(id) ?? []) {
      walk(p, [id, ...suffix])
    }
  }
  walk(to, [])
  return out
}

export function traceDeps(digest: PaperDigest, fromRaw: string, toRaw: string): TraceOutput {
  const from = resolveNodeId(digest, fromRaw).id
  const to = resolveNodeId(digest, toRaw).id
  const byId = new Map(digest.nodes.map(n => [n.id, n]))
  const { feeds } = feedsInto(digest)
  const asPath = (ids: string[]) => ({ nodes: ids.map(id => brief(byId.get(id)!)), links: ids.slice(1).map((id, i) => linkKind(byId, ids[i]!, id)) })
  if (from === to) {
    return { from, to, found: true, steps: 0, paths: [asPath([from])] }
  }
  const paths = shortestPaths(feeds, from, to)
  if (paths.length) {
    return { from, to, found: true, steps: paths[0]!.length - 1, paths: paths.map(asPath) }
  }
  const reverse = shortestPaths(feeds, to, from)
  return {
    from,
    to,
    found: false,
    steps: 0,
    paths: reverse.map(asPath),
    note: reverse.length
      ? `No path from ${from} to ${to}; the reverse holds: ${to} feeds into ${from} (paths shown run ${to} → ${from}).`
      : `No dependency path between ${from} and ${to} in either direction.`
  }
}

export function depClosure(digest: PaperDigest, idRaw: string, direction: 'supports' | 'supported_by', depth = 3): AncestorsOutput {
  const id = resolveNodeId(digest, idRaw).id
  const maxDepth = Math.max(1, Math.min(6, Math.floor(depth)))
  const byId = new Map(digest.nodes.map(n => [n.id, n]))
  const { pre, feeds } = feedsInto(digest)
  const next = (x: string) => direction === 'supports' ? feeds.get(x) ?? [] : [...(pre.get(x) ?? [])]
  const seen = new Set([id])
  const levels: AncestorsOutput['levels'] = []
  let frontier = [id]
  let total = 0
  let truncated = false
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const level: string[] = []
    for (const u of frontier) {
      for (const v of next(u)) {
        if (!seen.has(v)) {
          seen.add(v)
          level.push(v)
        }
      }
    }
    if (!level.length) {
      break
    }
    total += level.length
    const room = CLOSURE_CAP - levels.reduce((s, l) => s + l.nodes.length, 0)
    if (room < level.length) {
      truncated = true
    }
    if (room > 0) {
      levels.push({ depth: d, nodes: level.slice(0, room).map(x => brief(byId.get(x)!)) })
    }
    frontier = level
  }
  return { id, direction, depth: maxDepth, total, levels, ...(truncated ? { truncated } : {}) }
}

// --- the tool set ---

/** Tools for one chat request. `getSources` is called only when a tool needs the LaTeX, and should cache. */
export function chatTools(digest: PaperDigest, getSources: () => Promise<ChatSources | null>) {
  return {
    read_node: tool({
      description: 'Read one node: its verbatim LaTeX statement, the proof (or claim span) text from the paper\'s source with line numbers, its headline/role, what it uses and is used by, and the equations it references. Use it to quote a proof or check an exact step.',
      inputSchema: z.object({ id: z.string().describe('Node id from the digest, e.g. lem-greedy-hashes (a LaTeX label like lem:greedy-hashes also works)') }),
      execute: async ({ id }) => readNode(digest, id, await getSources())
    }),
    search_paper: tool({
      description: 'Case-insensitive search over the paper\'s LaTeX source (comments stripped). Matches the phrase, ignoring LaTeX punctuation (\\sqrt{\\log n} matches "sqrt log n"), then lines containing every word. Returns file:line, section, the node whose statement/proof contains the line, and ±2 lines. Use it to locate where something is defined, chosen or used.',
      inputSchema: z.object({
        query: z.string().min(1).describe('Words or a LaTeX fragment, e.g. "sqrt log n" or "\\\\delta_0"'),
        max: z.number().int().min(1).max(SEARCH_MAX).optional().describe(`Hits to return (default ${SEARCH_DEFAULT}, max ${SEARCH_MAX})`)
      }),
      execute: async ({ query, max }) => searchPaper(digest, await getSources(), query, max)
    }),
    trace: tool({
      description: 'Shortest dependency paths (up to 3) from a supporting node to a result it feeds into, over cited and inferred dependencies plus claim → parent. Use for "how does X lead to Y". Says when no path exists (and whether the reverse holds).',
      inputSchema: z.object({ from: z.string().describe('The supporting node id'), to: z.string().describe('The result id') }),
      execute: async ({ from, to }) => traceDeps(digest, from, to)
    }),
    ancestors: tool({
      description: 'Transitive closure from one node by distance. direction "supported_by" = everything it rests on; "supports" = every result that rests on it.',
      inputSchema: z.object({
        id: z.string(),
        direction: z.enum(['supports', 'supported_by']),
        depth: z.number().int().min(1).max(6).optional().describe('Levels to follow (default 3)')
      }),
      execute: async ({ id, direction, depth }) => depClosure(digest, id, direction, depth)
    })
  }
}

export type ChatToolSet = ReturnType<typeof chatTools>
