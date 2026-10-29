// Pure DAG helpers for critique, annotate, classify and finalize (no Nitro imports, so tests can use them).
import type { PaperSection, ProofNode } from '#shared/types'

export class CycleError extends Error {
  constructor(public ids: string[]) {
    super(`dependency cycle among ${ids.length} nodes: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ', …' : ''}`)
    this.name = 'CycleError'
  }
}

/**
 * What each node must wait for: deps_paper ∪ deps_inferred, plus its own claims
 * (a parent depends on the claims inside its proof, matching resolve's cycle rule). Unknown ids are ignored.
 */
export function prerequisites(nodes: ProofNode[]): Map<string, Set<string>> {
  const ids = new Set(nodes.map(n => n.id))
  const pre = new Map<string, Set<string>>(nodes.map(n => [n.id, new Set<string>()]))
  for (const n of nodes) {
    for (const d of [...n.deps_paper, ...n.deps_inferred]) {
      if (d !== n.id && ids.has(d)) {
        pre.get(n.id)!.add(d)
      }
    }
    if (n.parent_id && ids.has(n.parent_id) && n.parent_id !== n.id) {
      pre.get(n.parent_id)!.add(n.id)
    }
  }
  return pre
}

/**
 * Kahn's algorithm in levels: level 0 has no prerequisites, level k only needs levels < k.
 * Ids within a level keep input order. On a cycle, `throw` raises CycleError; `flatten` puts
 * every node stuck on the cycle into one last level so a run can still finish.
 */
export function topoLevels(nodes: ProofNode[], opts: { onCycle?: 'throw' | 'flatten' } = {}): string[][] {
  const pre = prerequisites(nodes)
  const remaining = new Map([...pre].map(([id, deps]) => [id, deps.size]))
  const users = new Map<string, string[]>()
  for (const [id, deps] of pre) {
    for (const d of deps) {
      users.set(d, [...(users.get(d) ?? []), id])
    }
  }
  const levels: string[][] = []
  let frontier = nodes.map(n => n.id).filter(id => remaining.get(id) === 0)
  const placed = new Set<string>()
  while (frontier.length) {
    levels.push(frontier)
    frontier.forEach(id => placed.add(id))
    const next = new Set<string>()
    for (const id of frontier) {
      for (const u of users.get(id) ?? []) {
        const left = remaining.get(u)! - 1
        remaining.set(u, left)
        if (left === 0) {
          next.add(u)
        }
      }
    }
    frontier = nodes.map(n => n.id).filter(id => next.has(id))
  }
  const stuck = nodes.map(n => n.id).filter(id => !placed.has(id))
  if (stuck.length) {
    if (opts.onCycle !== 'flatten') {
      throw new CycleError(stuck)
    }
    levels.push(stuck)
  }
  return levels
}

export function hasCycle(nodes: ProofNode[]): boolean {
  try {
    topoLevels(nodes)
    return false
  } catch (err) {
    if (err instanceof CycleError) {
      return true
    }
    throw err
  }
}

/** Reverse edges over deps_paper ∪ deps_inferred (containment not included). */
export function usedByMap(nodes: ProofNode[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const n of nodes) {
    for (const d of new Set([...n.deps_paper, ...n.deps_inferred])) {
      out.set(d, [...(out.get(d) ?? []), n.id])
    }
  }
  return out
}

// Using a theorem in a corollary or a remark doesn't make it any less a top-level result.
const CONSUMER_KINDS_THAT_KEEP_ROOT = new Set(['corollary', 'remark'])

/** Section order, then line; sections missing from the list sort last. */
function documentOrder(nodes: ProofNode[], sections: PaperSection[]) {
  const order = new Map(sections.map((s, i) => [s.id, s.order ?? i]))
  return (a: ProofNode, b: ProofNode) => {
    const sa = order.get(a.paper_ref.section) ?? Number.MAX_SAFE_INTEGER
    const sb = order.get(b.paper_ref.section) ?? Number.MAX_SAFE_INTEGER
    return sa - sb || a.paper_ref.line - b.paper_ref.line || nodes.indexOf(a) - nodes.indexOf(b)
  }
}

/**
 * root_ids: theorems nothing else builds on (uses by corollaries/remarks don't count), main theorem first.
 * "Main" = a label/id/name saying main, else the first such theorem in document order.
 * No theorems → statements with no users at all, in document order.
 */
export function rootIds(nodes: ProofNode[], sections: PaperSection[]): string[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const usedBy = usedByMap(nodes)
  const sort = documentOrder(nodes, sections)
  // A claim counts as its parent: a step inside a corollary's proof is still the corollary using it.
  const consumerKind = (id: string) => {
    const u = byId.get(id)
    return u?.kind === 'claim' && u.parent_id ? byId.get(u.parent_id)?.kind ?? 'claim' : u?.kind ?? ''
  }
  const builtOn = (id: string) => (usedBy.get(id) ?? []).some(u => !CONSUMER_KINDS_THAT_KEEP_ROOT.has(consumerKind(u)))
  let roots = nodes.filter(n => n.kind === 'theorem' && !builtOn(n.id))
  if (!roots.length) {
    roots = nodes.filter(n => n.kind !== 'claim' && !(usedBy.get(n.id)?.length))
  }
  roots.sort(sort)
  const isMain = (n: ProofNode) => /(^|[^a-z])main([^a-z]|$)/i.test(`${n.paper_ref.label ?? ''} ${n.id}`) || /\bmain (theorem|result)\b/i.test(n.name)
  const main = roots.find(isMain)
  return main ? [main.id, ...roots.filter(r => r !== main).map(r => r.id)] : roots.map(r => r.id)
}
