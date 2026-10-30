// Text for the node hover card (NodeHoverCard): how a mathematician names a node ("Lemma 6.3"), where it sits
// in the source, and how it entered the map. Pure over the digest so it's testable without Nuxt.
import type { PaperDigest, PaperSection, ProofNode } from '#shared/types'
import { capitalize, sectionLabel } from './nodes'

export interface CardLookup {
  digest: PaperDigest | null | undefined
  byId: Map<string, ProofNode>
  /** Claims under each statement, in source order. */
  children: Record<string, ProofNode[]>
  sectionOf: Record<string, PaperSection | undefined>
}

/** The paper's display number ("6.3") for a labeled statement, from the digest's label index. */
export function nodeNumber(node: ProofNode, digest: PaperDigest | null | undefined) {
  const label = node.paper_ref.label
  return label ? digest?.labels?.[label]?.number : undefined
}

/** 1-based position of a claim inside its parent's proof, with the sibling count. */
export function claimPosition(node: ProofNode, l: Pick<CardLookup, 'children'>) {
  const siblings = node.parent_id ? l.children[node.parent_id] ?? [] : []
  const i = siblings.findIndex(c => c.id === node.id)
  return i < 0 ? undefined : { n: i + 1, of: siblings.length, next: siblings[i + 1] }
}

/** "Lemma 6.3", "Claim 2", or just "Lemma" when the paper gives no number. */
export function nodeTitle(node: ProofNode, l: Pick<CardLookup, 'digest' | 'children'>) {
  if (node.kind === 'claim') {
    const pos = claimPosition(node, l)
    return pos ? `Claim ${pos.n}` : 'Claim'
  }
  const number = nodeNumber(node, l.digest)
  return number ? `${capitalize(node.kind)} ${number}` : capitalize(node.kind)
}

/** How another node is named in a compact list: "Lemma 6.1", "Claim 4 in Theorem 1.1", else its semantic name. */
export function nodeShortRef(node: ProofNode, l: Pick<CardLookup, 'digest' | 'children' | 'byId'>): string {
  if (node.kind === 'claim') {
    const parent = node.parent_id ? l.byId.get(node.parent_id) : undefined
    return parent ? `${nodeTitle(node, l)} in ${nodeShortRef(parent, l)}` : nodeTitle(node, l)
  }
  if (nodeNumber(node, l.digest)) {
    return nodeTitle(node, l)
  }
  return node.name
}

/** First `limit` items plus how many were left out. */
export function takeSome<T>(items: T[], limit: number) {
  return { shown: items.slice(0, limit), more: Math.max(0, items.length - limit) }
}

export interface DepItem { id: string, inferred: boolean }

/** Uses: \ref'd deps first, then inferred-only ones (marked). */
export function usesOf(node: ProofNode): DepItem[] {
  return [
    ...node.deps_paper.map(id => ({ id, inferred: false })),
    ...node.deps_inferred.filter(id => !node.deps_paper.includes(id)).map(id => ({ id, inferred: true }))
  ]
}

/** Used by: every node listing this one, inferred when only the model drew the edge. */
export function usedByOf(node: ProofNode, usedBy: string[], byId: Map<string, ProofNode>): DepItem[] {
  return usedBy.map((id) => {
    const user = byId.get(id)
    return { id, inferred: !!user && !user.deps_paper.includes(node.id) && user.deps_inferred.includes(node.id) }
  })
}

export interface Provenance {
  /** "§6.2 Greedy hashes", or the section id when the digest doesn't know it. */
  section: string
  page?: number
  file: string
  /** "73", or "18–29" for a claim that runs up to the next claim in the same file. */
  lines: string
  label?: string
  /** How it entered the map, one sentence. */
  origin: string
  /** Claims: the statement whose proof contains it. */
  parentId?: string
}

export function nodeProvenance(node: ProofNode, l: CardLookup): Provenance {
  const s = l.sectionOf[node.id]
  const ref = node.paper_ref
  const section = s ? sectionLabel(s.id, s.title) : sectionLabel(ref.section, ref.sectionTitle)
  let lines = String(ref.line)
  let origin: string
  if (node.parent_id) {
    const parent = l.byId.get(node.parent_id)
    const pos = claimPosition(node, l)
    const where = parent ? nodeShortRef(parent, l) : node.parent_id
    origin = `Claim extracted from inside the proof of ${where}${pos ? ` (${pos.n} of ${pos.of})` : ''}; the paper doesn't state it as a separate result.`
    if (pos?.next && pos.next.paper_ref.file === ref.file && pos.next.paper_ref.line > ref.line + 1) {
      lines = `${ref.line}–${pos.next.paper_ref.line - 1}`
    }
  } else if (ref.label) {
    origin = `Labeled ${node.kind} in the source, read verbatim.`
  } else {
    origin = `Unlabeled ${node.kind} in the source, read verbatim.`
  }
  return {
    section,
    ...(ref.page ? { page: ref.page } : {}),
    file: ref.file,
    lines,
    ...(ref.label ? { label: ref.label } : {}),
    origin,
    ...(node.parent_id ? { parentId: node.parent_id } : {})
  }
}

/** Plain-text one-liner, e.g. for aria labels and tests: "§6 Hashes · p. 12 · hashes.tex:40". */
export function provenanceLine(p: Pick<Provenance, 'section' | 'page' | 'file' | 'lines'>) {
  return [p.section, p.page ? `p. ${p.page}` : undefined, `${p.file}:${p.lines}`].filter(Boolean).join(' · ')
}
