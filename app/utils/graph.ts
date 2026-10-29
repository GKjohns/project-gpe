// Pure graph logic for the dependency DAG (ProofGraph.vue): which nodes and edges show, the focus closure,
// and which edges light up. No Vue, no dagre, so tests/graph-layout.test.ts can run it on the toy digest.
import type { ProofNode } from '#shared/types'

export type GraphMode = 'all' | 'focus'
export type GraphColorBy = 'cls' | 'sec'

/** `from` uses `to`: drawn from the result above down to what it rests on. `contains` = parent statement → claim inside its proof. */
export interface GraphEdge { from: string, to: string, inferred: boolean, contains: boolean }

export interface GraphModel {
  nodes: ProofNode[]
  edges: GraphEdge[]
  /** The node focus is computed from: the selection, or a hidden claim's parent; null when neither is in the graph. */
  anchor: string | null
  down: Set<string>
  up: Set<string>
  /** anchor ∪ down ∪ up; every node when there is no anchor. */
  lit: Set<string>
}

/** Paper statements (no remarks), plus claims whose parent is shown when `showClaims`. */
export function graphNodes(all: ProofNode[], showClaims: boolean): ProofNode[] {
  const statements = all.filter(n => n.kind !== 'remark' && n.kind !== 'claim')
  if (!showClaims) {
    return statements
  }
  const shown = new Set(statements.map(n => n.id))
  return [...statements, ...all.filter(n => n.kind === 'claim' && n.parent_id && shown.has(n.parent_id))]
}

/** deps_paper ∪ deps_inferred among `nodes` (an edge in both counts as mechanical), plus parent → claim. */
export function graphEdges(nodes: ProofNode[]): GraphEdge[] {
  const ids = new Set(nodes.map(n => n.id))
  const edges: GraphEdge[] = []
  for (const n of nodes) {
    const seen = new Set<string>()
    for (const [deps, inferred] of [[n.deps_paper, false], [n.deps_inferred, true]] as const) {
      for (const to of deps) {
        if (to !== n.id && ids.has(to) && !seen.has(to)) {
          seen.add(to)
          edges.push({ from: n.id, to, inferred, contains: false })
        }
      }
    }
    if (n.parent_id && ids.has(n.parent_id) && !seen.has(n.parent_id)) {
      edges.push({ from: n.parent_id, to: n.id, inferred: false, contains: true })
    }
  }
  return edges
}

/** Transitive `uses` (down) and transitive `usedBy` (up) of `id` over `edges`; neither includes `id`. */
export function focusClosure(edges: GraphEdge[], id: string): { down: Set<string>, up: Set<string> } {
  const out = new Map<string, string[]>()
  const inc = new Map<string, string[]>()
  for (const e of edges) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
    (inc.get(e.to) ?? inc.set(e.to, []).get(e.to)!).push(e.from)
  }
  const walk = (adj: Map<string, string[]>) => {
    const seen = new Set<string>()
    const stack = [...(adj.get(id) ?? [])]
    while (stack.length) {
      const next = stack.pop()!
      if (next !== id && !seen.has(next)) {
        seen.add(next)
        stack.push(...(adj.get(next) ?? []))
      }
    }
    return seen
  }
  return { down: walk(out), up: walk(inc) }
}

export function buildGraph(all: ProofNode[], opts: { selectedId: string, mode: GraphMode, showClaims: boolean }): GraphModel {
  let nodes = graphNodes(all, opts.showClaims)
  let edges = graphEdges(nodes)
  const shown = new Set(nodes.map(n => n.id))
  const parent = all.find(n => n.id === opts.selectedId)?.parent_id
  const anchor = shown.has(opts.selectedId) ? opts.selectedId : (parent && shown.has(parent) ? parent : null)
  if (!anchor) {
    return { nodes, edges, anchor, down: new Set(), up: new Set(), lit: shown }
  }
  const { down, up } = focusClosure(edges, anchor)
  const lit = new Set([anchor, ...down, ...up])
  if (opts.mode === 'focus') {
    nodes = nodes.filter(n => lit.has(n.id))
    edges = edges.filter(e => lit.has(e.from) && lit.has(e.to))
  }
  return { nodes, edges, anchor, down, up, lit }
}

/** Lit edges stay inside one cone: both ends in anchor ∪ down, or both in anchor ∪ up. */
export function edgeLit(model: Pick<GraphModel, 'anchor' | 'down' | 'up'>, e: GraphEdge): boolean {
  const { anchor, down, up } = model
  if (!anchor) {
    return false
  }
  const inDown = (id: string) => id === anchor || down.has(id)
  const inUp = (id: string) => id === anchor || up.has(id)
  return (inDown(e.from) && inDown(e.to)) || (inUp(e.from) && inUp(e.to))
}

/**
 * Layer of each node, 0 = top. Results that rest on the most sit on top: layer = maxHeight − height, height =
 * 1 + max height of what the node uses (or contains). Then two pull-ups, so the drawing doesn't end in one very
 * wide row: claims sit one layer under their parent (or whatever else uses them, the lowest of those), and leaves
 * (nothing below them, e.g. definitions) tuck up to one layer under their lowest user. Orphans (no edges at all)
 * stay on the bottom layer. Every edge goes strictly downward except the few that close a cycle, which are
 * left out of the constraints and listed in `back`.
 */
export function graphRanks(nodes: Pick<ProofNode, 'id' | 'kind'>[], edges: GraphEdge[]): { ranks: Map<string, number>, back: Set<GraphEdge> } {
  const out = new Map<string, GraphEdge[]>()
  for (const e of edges) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e)
  }
  const height = new Map<string, number>()
  const onStack = new Set<string>()
  const back = new Set<GraphEdge>()
  const visit = (id: string): number => {
    const known = height.get(id)
    if (known !== undefined) {
      return known
    }
    onStack.add(id)
    let h = 0
    for (const e of out.get(id) ?? []) {
      if (onStack.has(e.to)) {
        back.add(e)
      } else {
        h = Math.max(h, visit(e.to) + 1)
      }
    }
    onStack.delete(id)
    height.set(id, h)
    return h
  }
  for (const n of nodes) {
    visit(n.id)
  }
  const top = Math.max(0, ...height.values())
  const ranks = new Map(nodes.map(n => [n.id, top - height.get(n.id)!]))
  // Pull claims up, top to bottom so their users are already final; moving up never breaks an edge below.
  const inc = new Map<string, string[]>()
  for (const e of edges) {
    if (!back.has(e)) {
      (inc.get(e.to) ?? inc.set(e.to, []).get(e.to)!).push(e.from)
    }
  }
  const pullUp = (list: Pick<ProofNode, 'id'>[]) => {
    for (const n of [...list].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!)) {
      const users = inc.get(n.id) ?? []
      if (users.length) {
        ranks.set(n.id, Math.max(...users.map(u => ranks.get(u)!)) + 1)
      }
    }
  }
  // Claims first (their users are statements or earlier claims), then leaves, whose users are all final by then.
  pullUp(nodes.filter(n => n.kind === 'claim'))
  pullUp(nodes.filter(n => n.kind !== 'claim' && height.get(n.id) === 0))
  return { ranks, back }
}

// --- card sizing ----------------------------------------------------------------
// A card reads, top to bottom: the small label line, the headline (what the node proves; may hold inline $…$),
// and the muted role line (what it does for the results that use it). Without a headline the semantic name
// stands in and there is no role line. Sizes are estimated from a conservative word wrap (no DOM, so tests and
// dagre agree) and fed to dagre: a slightly roomy card beats one whose last line spills out.
export const CARD_W = 272
const CARD_TEXT_W = CARD_W - 28 // px-2.5 + borders + slack
const HEAD = { charW: 6.8, lineH: 15 } // 12px medium
const ROLE = { charW: 5.9, lineH: 14 } // 11px regular
const CARD_CHROME = 16 + 3 + 10 + 4 + 4 // py-2, borders, label line, gap, slack
const ROLE_GAP = 3

/**
 * Text a reader sees, for width estimates: inside `$…$`, operators like `\log` keep their name, other commands
 * collapse to one glyph (`\tilde`, `\mathrm` and friends to none) and braces/scripts vanish.
 */
export function visibleText(s: string): string {
  return s.replace(/\$([^$]*)\$/g, (_, tex: string) => tex
    .replace(/\\(?:tilde|hat|bar|widetilde|widehat|overline|mathrm|mathbb|mathcal|mathsf|mathbf|operatorname|text|left|right|big|Big)\b/g, '')
    .replace(/\\(log|ln|exp|max|min|sup|inf|lim|deg|det|dim|ker|gcd|Pr)\b/g, '$1')
    .replace(/\\[a-zA-Z]+/g, 'x')
    .replace(/[{}^_\\ ]/g, ''))
}

/** Greedy word wrap at `widthPx` with an average glyph width; long words break on their own line. */
export function textLines(text: string, charW = HEAD.charW, widthPx = CARD_TEXT_W): number {
  const max = Math.max(1, Math.floor(widthPx / charW))
  let lines = 1
  let used = 0
  for (const word of visibleText(text).trim().split(/\s+/)) {
    const len = word.length
    if (used === 0) {
      used = len
    } else if (used + 1 + len <= max) {
      used += 1 + len
    } else {
      lines++
      used = len
    }
    while (used > max) {
      lines++
      used -= max
    }
  }
  return lines
}

/** What a card shows: the headline (falling back to the name) and the role line, if any. */
export function cardText(n: Pick<ProofNode, 'name' | 'headline' | 'role'>): { head: string, role?: string } {
  const head = n.headline?.trim()
  return head ? { head, role: n.role?.trim() || undefined } : { head: n.name }
}

export function cardSize(n: Pick<ProofNode, 'name' | 'headline' | 'role'>): { w: number, h: number } {
  const { head, role } = cardText(n)
  const h = CARD_CHROME + HEAD.lineH * textLines(head, HEAD.charW) + (role ? ROLE_GAP + ROLE.lineH * textLines(role, ROLE.charW) : 0)
  return { w: CARD_W, h: Math.ceil(h) }
}

/**
 * Next node for arrow-key navigation from `id`: up = a result it feeds into, down = something that feeds into it, left/right =
 * the neighbour in the same row. Among several, the one closest horizontally. null when there is none.
 */
export function stepTarget(
  dir: 'up' | 'down' | 'left' | 'right',
  id: string,
  pos: Map<string, { x: number, y: number, w: number, h: number }>,
  edges: Pick<GraphEdge, 'from' | 'to'>[]
): string | null {
  const here = pos.get(id)
  if (!here) {
    return null
  }
  const cx = (p: { x: number, w: number }) => p.x + p.w / 2
  const cy = (p: { y: number, h: number }) => p.y + p.h / 2
  let cands: string[]
  if (dir === 'up' || dir === 'down') {
    cands = edges.filter(e => dir === 'up' ? e.to === id : e.from === id).map(e => dir === 'up' ? e.from : e.to)
  } else {
    const sign = dir === 'left' ? -1 : 1
    cands = [...pos.entries()]
      .filter(([k, p]) => k !== id && Math.abs(cy(p) - cy(here)) < 1 && sign * (cx(p) - cx(here)) > 0)
      .map(([k]) => k)
  }
  let best: string | null = null
  let bestD = Infinity
  for (const c of new Set(cands)) {
    const p = pos.get(c)
    const d = p ? Math.abs(cx(p) - cx(here)) : Infinity
    if (d < bestD) {
      best = c
      bestD = d
    }
  }
  return best
}

/** Uniform B-spline through dagre's edge points (d3's curveBasis), as an SVG path. */
export function basisPath(points: { x: number, y: number }[]): string {
  if (points.length === 0) {
    return ''
  }
  const f = (n: number) => Math.round(n * 10) / 10
  const [p0] = points
  if (points.length < 3) {
    return points.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)},${f(p.y)}`).join(' ')
  }
  const last = points[points.length - 1]!
  const pts = [...points, last]
  let d = `M${f(p0!.x)},${f(p0!.y)}`
  for (let i = 2; i < pts.length; i++) {
    const a = pts[i - 2]!, b = pts[i - 1]!, c = pts[i]!
    if (i === 2) {
      d += ` L${f((5 * a.x + b.x) / 6)},${f((5 * a.y + b.y) / 6)}`
    }
    d += ` C${f((2 * a.x + b.x) / 3)},${f((2 * a.y + b.y) / 3)} ${f((a.x + 2 * b.x) / 3)},${f((a.y + 2 * b.y) / 3)} ${f((a.x + 4 * b.x + c.x) / 6)},${f((a.y + 4 * b.y + c.y) / 6)}`
  }
  return `${d} L${f(last.x)},${f(last.y)}`
}
