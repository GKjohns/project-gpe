// Display helpers shared by the tree, node page, chips (and later the graph and chat).
import type { PaperResponse } from '#shared/api'
import type { Classification, Friction, NodeKind, PaperRef, ProofNode } from '#shared/types'

export const KIND_ICON: Record<NodeKind, string> = {
  theorem: 'i-lucide-star',
  corollary: 'i-lucide-star',
  lemma: 'i-lucide-circle',
  proposition: 'i-lucide-circle',
  definition: 'i-lucide-type',
  claim: 'i-lucide-plus',
  remark: 'i-lucide-message-square'
}

export const KIND_SHORT: Record<NodeKind, string> = {
  theorem: 'thm',
  corollary: 'cor',
  lemma: 'lem',
  proposition: 'prop',
  definition: 'def',
  claim: 'claim',
  remark: 'rem'
}

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

export const CLASS_COLOR: Record<Classification, BadgeColor> = {
  novel: 'primary',
  standard: 'success',
  routine: 'neutral',
  unknown: 'warning'
}

export const SEVERITY_COLOR: Record<Friction['severity'], BadgeColor> = {
  high: 'error',
  warn: 'warning',
  info: 'info'
}

const SEVERITY_RANK: Record<Friction['severity'], number> = { info: 1, warn: 2, high: 3 }

export function maxSeverity(node: ProofNode): Friction['severity'] | null {
  let best: Friction['severity'] | null = null
  for (const f of node.friction) {
    if (!best || SEVERITY_RANK[f.severity] > SEVERITY_RANK[best]) {
      best = f.severity
    }
  }
  return best
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Section titles are LaTeX ('Reducing $\\#k$-SAT …'); the tree and breadcrumbs show plain text. */
export function plainTitle(title: string) {
  return title.replace(/\$([^$]*)\$/g, '$1').replace(/\\([#%&_$])/g, '$1').replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}]/g, '').trim()
}

/** "§2 Reduction" when the section id is a number or appendix letter, else just the title. */
export function sectionLabel(id: string, rawTitle?: string) {
  const title = rawTitle && plainTitle(rawTitle)
  const numbered = /^[0-9A-Z][0-9.]*$/.test(id)
  if (!title) {
    return numbered ? `§${id}` : id
  }
  return numbered ? `§${id} ${title}` : title
}

export const SEVERITY_ORDER: Friction['severity'][] = ['high', 'warn', 'info']

/** Where a node lives in the original source: GitHub file at the line, arXiv abstract, or nowhere (uploads). */
export function sourceUrl(paper: PaperResponse['paper'] | null | undefined, ref: PaperRef) {
  if (!paper) {
    return undefined
  }
  if (paper.sourceKind === 'github') {
    const m = paper.sourceRef.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?(.*)$/)
    if (m) {
      const dir = m[4] ? `${m[4].replace(/\/$/, '')}/` : ''
      return `https://github.com/${m[1]}/${m[2]}/blob/${m[3]}/${dir}${ref.file}#L${ref.line}`
    }
  }
  if (paper.sourceKind === 'arxiv') {
    return `https://arxiv.org/abs/${paper.sourceRef}`
  }
  return undefined
}
