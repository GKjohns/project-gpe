import { describe, expect, it } from 'vitest'
import type { PaperDigest, ProofNode } from '#shared/types'
import { toyDigest } from '../server/fixtures/toy-digest'
import type { CardLookup } from '../app/utils/nodeCard'
import { nodeProvenance, nodeShortRef, nodeTitle, provenanceLine, takeSome, usedByOf, usesOf } from '../app/utils/nodeCard'

function lookupFor(digest: PaperDigest): CardLookup {
  const byId = new Map(digest.nodes.map(n => [n.id, n]))
  const children: Record<string, ProofNode[]> = {}
  for (const n of digest.nodes) {
    if (n.parent_id) {
      (children[n.parent_id] ??= []).push(n)
    }
  }
  for (const list of Object.values(children)) {
    list.sort((a, b) => a.paper_ref.line - b.paper_ref.line)
  }
  const sections = new Map(digest.sections.map(s => [s.id, s]))
  const sectionOf = Object.fromEntries(digest.nodes.map(n => [n.id, sections.get(n.paper_ref.section)]))
  return { digest, byId, children, sectionOf }
}

function toy() {
  const d = structuredClone(toyDigest)
  d.labels = { 'lem:hash': { kind: 'statement', number: '2.3', target: 'lem-hash' } }
  // A second claim in the same proof, so the first claim gets a line span.
  const first = d.nodes.find(n => n.id === 'claim-lem-hash-1')!
  d.nodes.push({ ...structuredClone(first), id: 'claim-lem-hash-2', name: 'Some base works', paper_ref: { ...first.paper_ref, line: 74 } })
  return d
}

describe('node card text', () => {
  it('names statements by kind and display number, claims by position and parent', () => {
    const d = toy()
    const l = lookupFor(d)
    expect(nodeTitle(l.byId.get('lem-hash')!, l)).toBe('Lemma 2.3')
    expect(nodeTitle(l.byId.get('def-sparse')!, l)).toBe('Definition')
    expect(nodeShortRef(l.byId.get('def-sparse')!, l)).toBe('Sparse polynomial')
    expect(nodeTitle(l.byId.get('claim-lem-hash-2')!, l)).toBe('Claim 2')
    expect(nodeShortRef(l.byId.get('claim-lem-hash-1')!, l)).toBe('Claim 1 in Lemma 2.3')
  })

  it('describes provenance: labeled statement vs. claim inside a proof, with the claim line span', () => {
    const d = toy()
    const l = lookupFor(d)
    const lemma = nodeProvenance(l.byId.get('lem-hash')!, l)
    expect(lemma).toMatchObject({ section: '§2 Reduction', page: 2, file: 'toy.tex', lines: '58', label: 'lem:hash' })
    expect(lemma.origin).toMatch(/^Labeled lemma in the source/)
    expect(provenanceLine(lemma)).toBe('§2 Reduction · p. 2 · toy.tex:58')

    const claim = nodeProvenance(l.byId.get('claim-lem-hash-1')!, l)
    expect(claim.lines).toBe('66–73')
    expect(claim.parentId).toBe('lem-hash')
    expect(claim.origin).toMatch(/inside the proof of Lemma 2\.3 \(1 of 2\)/)
    // The last claim has no successor to bound it.
    expect(nodeProvenance(l.byId.get('claim-lem-hash-2')!, l).lines).toBe('74')
  })

  it('lists uses with inferred-only edges marked, used-by inferred when only the model drew it', () => {
    const d = toy()
    const l = lookupFor(d)
    const node = { ...l.byId.get('lem-hash')!, deps_paper: ['def-sparse'], deps_inferred: ['def-sparse', 'lem-restrict'] }
    expect(usesOf(node)).toEqual([{ id: 'def-sparse', inferred: false }, { id: 'lem-restrict', inferred: true }])
    l.byId.set('thm-x', { ...node, id: 'thm-x', deps_paper: [], deps_inferred: ['lem-hash'] })
    expect(usedByOf(l.byId.get('lem-hash')!, ['thm-main', 'thm-x'], l.byId).map(d => d.inferred)).toEqual([false, true])
    expect(takeSome([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], more: 2 })
  })
})
