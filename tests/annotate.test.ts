import { describe, expect, it } from 'vitest'
import type { ProofNode } from '#shared/types'
import { toyDigest } from '../server/fixtures/toy-digest'
import { CycleError, hasCycle, prerequisites, topoLevels } from '../server/pipeline/dag'
import { annotatePrompt } from '../server/pipeline/stages/annotate'
import { applyFix } from '../server/pipeline/stages/critique'
import { enforceCites } from '../server/pipeline/stages/classify'

const toy = () => structuredClone(toyDigest.nodes)
const byId = (nodes: ProofNode[]) => new Map(nodes.map(n => [n.id, n]))

describe('topoLevels', () => {
  it('levels the toy DAG deps-first, with claims before their parent', () => {
    expect(topoLevels(toy())).toEqual([
      ['def-sparse', 'lem-schwartz-zippel', 'claim-lem-hash-1'],
      ['lem-restrict', 'lem-hash', 'lem-univariate', 'thm-lower'],
      ['thm-main']
    ])
  })

  it('treats parent → claim as a dependency', () => {
    expect(prerequisites(toy()).get('lem-hash')).toEqual(new Set(['def-sparse', 'claim-lem-hash-1']))
  })

  it('every node sits above all of its prerequisites', () => {
    const nodes = toy()
    const level = new Map(topoLevels(nodes).flatMap((ids, i) => ids.map(id => [id, i] as const)))
    for (const [id, deps] of prerequisites(nodes)) {
      for (const d of deps) {
        expect(level.get(d)!).toBeLessThan(level.get(id)!)
      }
    }
  })

  it('throws on a cycle, or flattens it into a last level', () => {
    const nodes = toy()
    byId(nodes).get('def-sparse')!.deps_paper.push('thm-main')
    expect(() => topoLevels(nodes)).toThrow(CycleError)
    expect(hasCycle(nodes)).toBe(true)
    const flat = topoLevels(nodes, { onCycle: 'flatten' })
    expect(flat.flat().sort()).toEqual(nodes.map(n => n.id).sort())
    expect(flat.at(-1)).toContain('def-sparse')
  })

  it('a claim that uses its own parent is a cycle (containment counts)', () => {
    const nodes = toy()
    byId(nodes).get('claim-lem-hash-1')!.deps_inferred.push('lem-hash')
    expect(() => topoLevels(nodes)).toThrow(CycleError)
  })
})

describe('annotatePrompt', () => {
  it('includes explained deps, the claims inside the proof, and users', () => {
    const nodes = toy()
    const ctx = { title: 'Toy', byId: byId(nodes), usedBy: new Map([['lem-hash', ['thm-main']]]), numbers: new Map(), sectionTitles: new Map([['2', 'Reduction']]) }
    const p = annotatePrompt(byId(nodes).get('lem-hash')!, ctx)
    expect(p).toContain('Uses (already explained):')
    expect(p).toContain('def-sparse')
    expect(p).toContain('Claims inside its proof')
    expect(p).toContain('claim-lem-hash-1')
    expect(p).toContain('Used by (not yet explained):')
    expect(p).toContain('thm-main')
  })
})

describe('critique applyFix', () => {
  it('adds an inferred edge with friction, and refuses one that makes a cycle', () => {
    const add = applyFix(toy(), { kind: 'add_edge', target: ['lem-restrict', 'lem-schwartz-zippel'], note: 'uses SZ', confidence: 0.9 })
    expect(add.ok).toBe(true)
    const n = byId(add.nodes).get('lem-restrict')!
    expect(n.deps_inferred).toContain('lem-schwartz-zippel')
    expect(n.friction.at(-1)!.kind).toBe('inferred_dep')
    const cyc = applyFix(toy(), { kind: 'add_edge', target: ['def-sparse', 'thm-main'], note: 'x', confidence: 0.9 })
    expect(cyc.ok).toBe(false)
    expect(cyc.message).toMatch(/cycle/)
  })

  it('removes inferred edges but never \\ref edges', () => {
    expect(applyFix(toy(), { kind: 'remove_edge', target: ['lem-univariate', 'lem-schwartz-zippel'], note: 'x', confidence: 0.9 }).ok).toBe(true)
    const mech = applyFix(toy(), { kind: 'remove_edge', target: ['thm-main', 'lem-hash'], note: 'x', confidence: 0.9 })
    expect(mech.ok).toBe(false)
  })

  it('drops only claims, and the parent inherits nothing it already has', () => {
    expect(applyFix(toy(), { kind: 'drop', target: ['lem-hash'], note: 'x', confidence: 0.9 }).ok).toBe(false)
    const res = applyFix(toy(), { kind: 'drop', target: ['claim-lem-hash-1'], note: 'restates', confidence: 0.9 })
    expect(res.ok).toBe(true)
    expect(res.nodes.find(n => n.id === 'claim-lem-hash-1')).toBeUndefined()
  })

  it('refuses unknown ids and leaves the input untouched', () => {
    const nodes = toy()
    const res = applyFix(nodes, { kind: 'add_edge', target: ['nope', 'def-sparse'], note: 'x', confidence: 0.9 })
    expect(res.ok).toBe(false)
    expect(res.nodes).toBe(nodes)
  })
})

describe('classify enforceCites', () => {
  it('downgrades novel without a justification to routine', () => {
    const n = { ...toy()[0]!, classification: 'novel' as const, classification_cite: '' }
    expect(enforceCites(n)).toMatch(/routine/)
    expect(n.classification).toBe('routine')
  })
  it('keeps a justified novel', () => {
    const n = { ...toy()[0]!, classification: 'novel' as const, classification_cite: 'No prior result bounds sparse identity tests this way.' }
    expect(enforceCites(n)).toBeNull()
    expect(n.classification).toBe('novel')
  })
})
