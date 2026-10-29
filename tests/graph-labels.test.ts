import { describe, expect, it } from 'vitest'
import { toyDigest } from '../server/fixtures/toy-digest'
import { applyGraphLabels, graphLabelsPrompt } from '../server/pipeline/graphLabels'

const toy = () => structuredClone(toyDigest.nodes)

describe('graphLabelsPrompt', () => {
  it('gives every node its uses and its users, so the role can be written', () => {
    const p = graphLabelsPrompt(toy(), 'Toy')
    const block = p.split('\n\n').find(b => b.startsWith('## lem-hash'))!
    expect(block).toContain('uses: def-sparse')
    expect(block).toContain('used by: thm-main')
    // parent → claim counts as a use of the claim
    expect(p.split('\n\n').find(b => b.startsWith('## claim-lem-hash-1'))).toContain('used by: lem-hash')
    expect(p.split('\n\n').find(b => b.startsWith('## thm-main'))).toContain('used by: nothing')
    expect(p).toContain('8 nodes; return one label for each id')
  })

  it('asks for a subset last, keeping the whole paper as a shared prefix', () => {
    const p = graphLabelsPrompt(toy(), 'Toy', ['thm-main', 'lem-hash'])
    expect(p.trimEnd().split('\n\n').at(-1)).toBe('Return labels for exactly these 2 ids (the other nodes are context): thm-main, lem-hash')
    expect(p.startsWith(graphLabelsPrompt(toy(), 'Toy', ['def-sparse']).split('Return labels')[0]!)).toBe(true)
  })
})

describe('applyGraphLabels', () => {
  it('writes headline and role, trims periods, reports what the model skipped', () => {
    const nodes = toy()
    const r = applyGraphLabels(nodes, [
      { id: 'thm-main', headline: '  Tests sparse polynomials with poly$(s,\\log n)$ queries. ', role: 'the headline result.' },
      { id: 'lem-hash', headline: 'Keeps monomials distinct', role: '' },
      { id: 'nope', headline: 'x', role: 'y' }
    ])
    const byId = new Map(nodes.map(n => [n.id, n]))
    expect(byId.get('thm-main')!.headline).toBe('Tests sparse polynomials with poly$(s,\\log n)$ queries')
    expect(byId.get('thm-main')!.role).toBe('the headline result')
    expect(byId.get('lem-hash')!.role).toBeUndefined()
    expect(r.labeled).toBe(2)
    expect(r.missing).toHaveLength(6)
    expect(r.missing).toContain('def-sparse')
  })
})
