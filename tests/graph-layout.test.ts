import { describe, expect, it } from 'vitest'
import { basisPath, buildGraph, cardSize, cardText, edgeLit, focusClosure, graphEdges, graphNodes, graphRanks, stepTarget, textLines, visibleText } from '../app/utils/graph'
import { toyDigest } from '../server/fixtures/toy-digest'

const all = toyDigest.nodes
const ids = (s: Iterable<string>) => [...s].sort()

describe('graph nodes and edges', () => {
  it('leaves claims out unless asked, and adds them under their parent', () => {
    expect(graphNodes(all, false).map(n => n.id)).not.toContain('claim-lem-hash-1')
    const withClaims = graphNodes(all, true)
    expect(withClaims.map(n => n.id)).toContain('claim-lem-hash-1')
    expect(graphEdges(withClaims)).toContainEqual({ from: 'lem-hash', to: 'claim-lem-hash-1', inferred: false, contains: true })
  })

  it('flags inferred edges and keeps mechanical ones solid', () => {
    const edges = graphEdges(graphNodes(all, false))
    expect(edges.filter(e => e.inferred)).toEqual([{ from: 'lem-univariate', to: 'lem-schwartz-zippel', inferred: true, contains: false }])
    expect(edges).toContainEqual({ from: 'thm-main', to: 'lem-hash', inferred: false, contains: false })
    expect(edges).toHaveLength(8)
  })
})

describe('focus closure', () => {
  const edges = graphEdges(graphNodes(all, false))

  it('mid-level lemma: what it uses below, what uses it above', () => {
    const { down, up } = focusClosure(edges, 'lem-hash')
    expect(ids(down)).toEqual(['def-sparse'])
    expect(ids(up)).toEqual(['thm-main'])
  })

  it('follows inferred edges transitively', () => {
    const { down, up } = focusClosure(edges, 'lem-schwartz-zippel')
    expect(ids(down)).toEqual([])
    expect(ids(up)).toEqual(['lem-univariate', 'thm-lower', 'thm-main'])
  })

  it('root theorem: everything it rests on', () => {
    const { down, up } = focusClosure(edges, 'thm-main')
    expect(ids(down)).toEqual(['def-sparse', 'lem-hash', 'lem-restrict', 'lem-schwartz-zippel', 'lem-univariate'])
    expect(up.size).toBe(0)
  })
})

describe('buildGraph', () => {
  it('focus mode keeps only the lit nodes and the edges among them', () => {
    const g = buildGraph(all, { selectedId: 'lem-hash', mode: 'focus', showClaims: false })
    expect(ids(g.nodes.map(n => n.id))).toEqual(['def-sparse', 'lem-hash', 'thm-main'])
    expect(g.edges.map(e => `${e.from}>${e.to}`).sort()).toEqual(['lem-hash>def-sparse', 'thm-main>lem-hash'])
  })

  it('whole paper keeps every statement and lights only the cones', () => {
    const g = buildGraph(all, { selectedId: 'lem-hash', mode: 'all', showClaims: false })
    expect(g.nodes).toHaveLength(7)
    expect(ids(g.lit)).toEqual(['def-sparse', 'lem-hash', 'thm-main'])
    const lit = g.edges.filter(e => edgeLit(g, e)).map(e => `${e.from}>${e.to}`).sort()
    expect(lit).toEqual(['lem-hash>def-sparse', 'thm-main>lem-hash'])
  })

  it('a claim hidden by the toggle focuses on its parent; shown, it is its own anchor', () => {
    expect(buildGraph(all, { selectedId: 'claim-lem-hash-1', mode: 'all', showClaims: false }).anchor).toBe('lem-hash')
    const g = buildGraph(all, { selectedId: 'claim-lem-hash-1', mode: 'focus', showClaims: true })
    expect(g.anchor).toBe('claim-lem-hash-1')
    expect(ids(g.up)).toEqual(['lem-hash', 'thm-main'])
  })

  it('an id outside the graph lights everything', () => {
    const g = buildGraph(all, { selectedId: 'nope', mode: 'focus', showClaims: false })
    expect(g.anchor).toBeNull()
    expect(g.nodes).toHaveLength(7)
    expect(g.lit.size).toBe(7)
  })
})

describe('graphRanks (most-supported on top, leaves tucked under their lowest user)', () => {
  it('puts the main theorem on top and leaves just under their lowest user', () => {
    const nodes = graphNodes(all, false)
    const { ranks, back } = graphRanks(nodes, graphEdges(nodes))
    expect(back.size).toBe(0)
    expect(ranks.get('thm-main')).toBe(0)
    expect(ranks.get('lem-hash')).toBe(1)
    expect(ranks.get('def-sparse')).toBe(2)
    expect(ranks.get('lem-schwartz-zippel')).toBe(2)
  })

  it('tucks a leaf up when all its users are high, and leaves orphans on the bottom', () => {
    // a → b → c → d (chain), a → leaf; orphan has no edges.
    const k = 'lemma' as const
    const nodes = ['a', 'b', 'c', 'd', 'leaf', 'orphan'].map(id => ({ id, kind: k }))
    const e = (from: string, to: string) => ({ from, to, inferred: false, contains: false })
    const { ranks } = graphRanks(nodes, [e('a', 'b'), e('b', 'c'), e('c', 'd'), e('a', 'leaf')])
    expect(ranks.get('a')).toBe(0)
    expect(ranks.get('leaf')).toBe(1)
    expect(ranks.get('d')).toBe(3)
    expect(ranks.get('orphan')).toBe(3)
  })

  it('every edge points down, and a claim sits one layer under its parent', () => {
    const nodes = graphNodes(all, true)
    const edges = graphEdges(nodes)
    const { ranks } = graphRanks(nodes, edges)
    for (const e of edges) {
      expect(ranks.get(e.to)!).toBeGreaterThan(ranks.get(e.from)!)
    }
    expect(ranks.get('claim-lem-hash-1')).toBe(ranks.get('lem-hash')! + 1)
  })

  it('a cycle is cut at one edge instead of looping', () => {
    const nodes = [{ id: 'a', kind: 'lemma' as const }, { id: 'b', kind: 'lemma' as const }]
    const edges = [{ from: 'a', to: 'b', inferred: false, contains: false }, { from: 'b', to: 'a', inferred: true, contains: false }]
    const { ranks, back } = graphRanks(nodes, edges)
    expect(back.size).toBe(1)
    expect(new Set(ranks.values()).size).toBe(2)
  })
})

describe('card sizing', () => {
  it('wraps text instead of truncating, and grows the card per line', () => {
    expect(textLines('Sparse polynomial')).toBe(1)
    expect(textLines('Greedily appended rows give the true count')).toBe(2)
    expect(cardSize({ name: 'Subexponential deterministic k-CNF model counting counted twice over' }).h)
      .toBeGreaterThan(cardSize({ name: 'Sparse polynomial' }).h)
  })

  it('measures math as rendered, not as LaTeX source', () => {
    expect(visibleText('in $2^{\\tilde O(n/\\sqrt{\\log n})}$ time')).toBe('in 2O(n/xlogn) time')
    expect(textLines('#k-CNF counted deterministically in $2^{\\tilde O(n/\\sqrt{\\log n})}$ time')).toBe(2)
  })

  it('shows headline + role, falling back to the name without a role', () => {
    const named = { name: 'Hashing monomials apart' }
    expect(cardText(named)).toEqual({ head: 'Hashing monomials apart' })
    expect(cardText({ ...named, role: 'orphan role' })).toEqual({ head: 'Hashing monomials apart' })
    const labeled = { ...named, headline: '3n greedy rows make #solutions(A) = #F', role: 'turns counting into zero-counting' }
    expect(cardText(labeled)).toEqual({ head: labeled.headline, role: labeled.role })
    expect(cardSize(labeled).h).toBeGreaterThan(cardSize({ ...labeled, role: undefined }).h)
    expect(cardSize(labeled).w).toBe(272)
  })
})

describe('stepTarget (arrow keys)', () => {
  // b and c (same row) feed into a on top; d below feeds into c. Edges keep the data model's from = user.
  const box = (x: number, y: number) => ({ x, y, w: 100, h: 40 })
  const pos = new Map([['a', box(150, 0)], ['b', box(0, 100)], ['c', box(300, 100)], ['d', box(300, 200)], ['e', box(600, 100)]])
  const edges = [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'c', to: 'd' }]

  it('down goes to what feeds into it, up to the result it feeds into, nearest horizontally', () => {
    expect(stepTarget('down', 'a', pos, edges)).toBe('b')
    expect(stepTarget('down', 'c', pos, edges)).toBe('d')
    expect(stepTarget('up', 'd', pos, edges)).toBe('c')
    expect(stepTarget('up', 'a', pos, edges)).toBeNull()
  })

  it('left/right step along the same row, even to unconnected cards', () => {
    expect(stepTarget('right', 'b', pos, edges)).toBe('c')
    expect(stepTarget('right', 'c', pos, edges)).toBe('e')
    expect(stepTarget('left', 'b', pos, edges)).toBeNull()
    expect(stepTarget('left', 'nope', pos, edges)).toBeNull()
  })
})

describe('basisPath', () => {
  it('starts and ends on the given points', () => {
    const d = basisPath([{ x: 0, y: 0 }, { x: 10, y: 30 }, { x: 20, y: 60 }])
    expect(d.startsWith('M0,0')).toBe(true)
    expect(d.endsWith('L20,60')).toBe(true)
    expect(basisPath([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBe('M0,0 L5,5')
  })
})
