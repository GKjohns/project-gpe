// Graph card labels (headline + role): one call per paper over every annotated node, run at the end of annotate
// because a node's role depends on what uses it. Also the backfill for older digests
// (POST /api/papers/:slug/labels). Pure prompt/apply helpers, then the call.
import { graphLabelsSchema } from '#shared/schemas'
import type { ProofNode } from '#shared/types'
import { callObject } from './llm'
import GRAPH_LABELS_INSTRUCTIONS from './prompts/graph-labels.md'

export interface GraphLabel { id: string, headline: string, role: string }

export const HEADLINE_MAX = 80
export const ROLE_MAX = 60
/** Nodes labeled per call; every call still sees the whole paper. Keeps one answer well under output limits. */
export const LABEL_BATCH = 100

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Users of each node: deps (mechanical ∪ inferred) reversed, plus parent → claim. */
function usersOf(nodes: ProofNode[]): Map<string, string[]> {
  const users = new Map<string, string[]>()
  const add = (to: string, from: string) => {
    const list = users.get(to) ?? users.set(to, []).get(to)!
    if (!list.includes(from)) {
      list.push(from)
    }
  }
  for (const n of nodes) {
    for (const d of new Set([...n.deps_paper, ...n.deps_inferred])) {
      if (d !== n.id) {
        add(d, n.id)
      }
    }
    if (n.parent_id) {
      add(n.id, n.parent_id)
    }
  }
  return users
}

/** Every node in document order (id, kind, label, name, plain statement, why, uses, used by); `only` = the ids to label. */
export function graphLabelsPrompt(nodes: ProofNode[], title: string, only?: string[]): string {
  const users = usersOf(nodes)
  const ids = new Set(nodes.map(n => n.id))
  const blocks = nodes.map((n) => {
    const uses = [...new Set([...n.deps_paper, ...n.deps_inferred])].filter(d => ids.has(d) && d !== n.id)
    const usedBy = (users.get(n.id) ?? []).filter(u => ids.has(u))
    return [
      `## ${n.id} · ${n.kind}${n.paper_ref.label ? ` · ${n.paper_ref.label}` : ''}${n.parent_id ? ` · claim inside the proof of ${n.parent_id}` : ''}`,
      `name: ${n.name}`,
      `statement: ${oneLine(n.statement_plain)}`,
      `why: ${oneLine(n.explanation)}`,
      `uses: ${uses.join(', ') || 'nothing in the paper'}`,
      `used by: ${usedBy.join(', ') || 'nothing (top-level result, side result, or unused definition)'}`
    ].join('\n')
  })
  const ask = only && only.length < nodes.length
    ? `Return labels for exactly these ${only.length} ids (the other nodes are context): ${only.join(', ')}`
    : `${nodes.length} nodes; return one label for each id below.`
  // The ask goes last so batches of one paper share a cacheable prefix.
  return [`Paper: ${title}`, ...blocks, ask].join('\n\n')
}

/** Writes headline/role onto the nodes it has labels for; reports skipped ids and over-long lines. */
export function applyGraphLabels(nodes: ProofNode[], labels: GraphLabel[]): { labeled: number, missing: string[], long: string[] } {
  const byId = new Map(labels.map(l => [l.id.trim(), l]))
  const missing: string[] = []
  const long: string[] = []
  let labeled = 0
  for (const n of nodes) {
    const l = byId.get(n.id)
    const headline = l ? oneLine(l.headline).replace(/\.$/, '') : ''
    if (!l || !headline) {
      missing.push(n.id)
      continue
    }
    n.headline = headline
    const role = oneLine(l.role ?? '').replace(/\.$/, '')
    if (role) {
      n.role = role
    } else {
      delete n.role
    }
    // LaTeX source counts toward the soft limits, so only flag lines well past them.
    if (headline.length > HEADLINE_MAX + 20 || role.length > ROLE_MAX + 20) {
      long.push(n.id)
    }
    labeled++
  }
  return { labeled, missing, long }
}

/** Labels every node in place: one call per LABEL_BATCH nodes, each with the whole paper as context. */
export async function runGraphLabels(nodes: ProofNode[], opts: { title: string, model: string, runId?: string }) {
  const labels: GraphLabel[] = []
  let cost = 0
  let calls = 0
  for (let i = 0; i < nodes.length; i += LABEL_BATCH) {
    const only = nodes.length > LABEL_BATCH ? nodes.slice(i, i + LABEL_BATCH).map(n => n.id) : undefined
    const { object, usage } = await callObject({
      model: opts.model,
      schema: graphLabelsSchema,
      instructions: GRAPH_LABELS_INSTRUCTIONS,
      prompt: graphLabelsPrompt(nodes, opts.title, only),
      cache: !!only,
      runId: opts.runId,
      stage: 'annotate'
    })
    labels.push(...object.labels)
    cost += usage.cost_usd
    calls++
  }
  return { ...applyGraphLabels(nodes, labels), cost_usd: cost, calls }
}
