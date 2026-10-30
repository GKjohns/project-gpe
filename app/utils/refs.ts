// Cross-references in paper LaTeX (\ref, \eqref, \cref, …) → what the reader sees: "(1.2)", "Lemma 6.3", "§3.2".
// Shared by MathText (prose and math), chat Comark and chat math. Pure over the digest, so it also works in tests.
import type { PaperDigest, PaperEquation, PaperFigure, PaperSection, ProofNode } from '#shared/types'
import { plainTitle } from './nodes'

/** One \ref-family command; group 2 may hold several comma-separated labels (\cref{a,b}). */
export const REF_RE = /\\(eqref|ref|cref|Cref|autoref|labelcref|nameref)\*?\s*\{([^{}]*)\}/g
export const CITE_RE = /\\cite[a-zA-Z]*\*?((?:\[[^\]]*\])*)\{([^{}]*)\}/g

// "Lemma~", "Lemmas~\ref{a} and~", "Section ", "Eq.~": the paper already names the kind, so the chip shows only the number.
const PREFIX_RE = /\b(?:lemma|theorem|thm|proposition|prop|corollary|cor|definition|defn?|claim|remark|conjecture|fact|observation|section|sec|subsection|appendix|appendices|chapter|eqs?|equation|item|step|case|part|figure|fig|table)s?\.?[\s~]*(?:(?:\\[a-zA-Z]*ref\*?\{[^{}]*\}|and|or|to|,|--?)[\s~]*)*$/i

export function isPrefixed(before: string) {
  return PREFIX_RE.test(before.slice(-120))
}

/** 'eq:solution-count' → 'solution count'. */
export function humanizeLabel(label: string) {
  return label.replace(/^[A-Za-z]+:/, '').replace(/[-_.:]+/g, ' ').trim() || label
}

export type ResolvedRef
  = | { kind: 'equation', label: string, text: string, equation?: PaperEquation }
    | { kind: 'statement', label: string, text: string, node: ProofNode, number?: string }
    | { kind: 'section', label: string, text: string, section: PaperSection, nodeId?: string }
    | { kind: 'figure', label: string, text: string, figure: PaperFigure }
    | { kind: 'unknown', label: string, text: string }

interface Lookup {
  byLabel: Map<string, ProofNode>
  byId: Map<string, ProofNode>
  sections: Map<string, PaperSection>
  firstNode: Map<string, string>
}

const cache = new WeakMap<PaperDigest, Lookup>()

function lookup(digest: PaperDigest): Lookup {
  let l = cache.get(digest)
  if (!l) {
    l = { byLabel: new Map(), byId: new Map(), sections: new Map(digest.sections.map(s => [s.id, s])), firstNode: new Map() }
    for (const n of digest.nodes) {
      l.byId.set(n.id, n)
      if (n.paper_ref.label && !n.parent_id) {
        l.byLabel.set(n.paper_ref.label, n)
      }
    }
    // First statement in each section or its subsections, in digest order.
    for (const n of digest.nodes) {
      if (n.parent_id) {
        continue
      }
      for (let id: string | undefined = n.paper_ref.section; id; id = l.sections.get(id)?.parent_id) {
        if (!l.firstNode.has(id)) {
          l.firstNode.set(id, n.id)
        }
      }
    }
    cache.set(digest, l)
  }
  return l
}

const KIND_NAME: Record<string, string> = { theorem: 'Theorem', lemma: 'Lemma', proposition: 'Proposition', corollary: 'Corollary', definition: 'Definition', claim: 'Claim', remark: 'Remark' }

/** Resolves one label. `prefixed`: the prose right before already names the kind ("Lemma~\ref{…}"). */
export function resolveRef(digest: PaperDigest | null | undefined, label: string, cmd = 'ref', prefixed = false): ResolvedRef {
  const human = humanizeLabel(label)
  if (!digest) {
    return { kind: 'unknown', label, text: human }
  }
  const l = lookup(digest)
  const meta = digest.labels?.[label]
  const equation = digest.equations?.[label]
  if (equation || meta?.kind === 'equation') {
    const n = equation?.number
    const text = !n ? `(${human})` : cmd === 'ref' || cmd === 'nameref' || (prefixed && cmd !== 'eqref') ? n : `(${n})`
    return { kind: 'equation', label, text, ...(equation ? { equation } : {}) }
  }
  // A figure without a \label is cited by its id (`\ref{fig-2}`), which the chat's view_figure hands the model.
  const figureById = !meta ? digest.figures?.find(f => f.id === label) : undefined
  if (meta?.kind === 'figure' || figureById) {
    const figure = figureById ?? digest.figures?.find(f => f.id === meta!.target)
    const n = meta?.number ?? figure?.number
    const text = n ? (prefixed ? n : `Figure ${n}`) : 'Figure'
    if (figure) {
      return { kind: 'figure', label, text, figure }
    }
    return { kind: 'unknown', label, text }
  }
  const node = (meta?.kind === 'statement' && meta.target ? l.byId.get(meta.target) : undefined) ?? l.byLabel.get(label)
  if (node) {
    const number = meta?.number
    const text = cmd === 'nameref' || !number ? node.name : prefixed ? number : `${KIND_NAME[node.kind] ?? 'Statement'} ${number}`
    return { kind: 'statement', label, text, node, ...(number ? { number } : {}) }
  }
  const section = meta?.kind === 'section' && meta.target ? l.sections.get(meta.target) : undefined
  if (section) {
    const numbered = /^[0-9A-Z][0-9.]*$/.test(section.id)
    const text = cmd === 'nameref' || !numbered ? plainTitle(section.title) : prefixed ? section.id : `§${section.id}`
    const nodeId = l.firstNode.get(section.id)
    return { kind: 'section', label, text, section, ...(nodeId ? { nodeId } : {}) }
  }
  // Old digests carry no equation index; an eq: label still reads as an equation.
  return { kind: 'unknown', label, text: /^eqn?:/i.test(label) ? `(${human})` : human }
}

export function splitLabels(labels: string) {
  return labels.split(',').map(s => s.trim()).filter(Boolean)
}

const TEX_ESCAPE = /[#$%&_{}]/g

/** \eqref etc. inside a math span → \text{(1.2)}, so KaTeX shows the number instead of red source. */
export function texWithRefs(tex: string, digest: PaperDigest | null | undefined) {
  return tex.replace(REF_RE, (all, cmd: string, labels: string, offset: number) => {
    const prefixed = isPrefixed(tex.slice(0, offset))
    const text = splitLabels(labels).map(label => resolveRef(digest, label, cmd, prefixed).text).join(', ')
    return `\\text{${text.replace(/[\\^~]/g, '').replace(TEX_ESCAPE, m => `\\${m}`)}}`
  })
}

/** `\cite[Thm 2]{IP01,IPZ}` → "[IP01, IPZ, Thm 2]": bibliography keys aren't in the digest, so the key is the best name. */
export function citeText(opts: string, keys: string) {
  const notes = [...opts.matchAll(/\[([^\]]*)\]/g)].map(m => m[1]!.trim()).filter(Boolean)
  return `[${[...splitLabels(keys), ...notes].join(', ')}]`
}
