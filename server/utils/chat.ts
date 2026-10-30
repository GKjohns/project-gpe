// Chat over one paper's digest (Sprint 7): the digest goes in the instructions, answers cite `[[node-id]]`.
// Post-sprint: tools (server/utils/chatTools.ts) read proofs, search the LaTeX and trace paths when the digest isn't enough.
import type { ModelMessage } from 'ai'
import type { PaperDigest, PaperFigure, ProofNode } from '#shared/types'

/** History ceiling in characters (model messages, after pruning); oldest turns drop first. */
export const CHAT_HISTORY_CHARS = 40_000

export const CHAT_UNAVAILABLE = 'The chat is unavailable right now.'

function sectionText(digest: PaperDigest, id: string) {
  const s = digest.sections.find(x => x.id === id)
  return s ? `§${s.id} ${s.title}` : `§${id}`
}

function nodeBlock(digest: PaperDigest, n: ProofNode, usedBy: string[]) {
  const head = [n.id, n.kind, `"${n.name}"`]
  if (n.paper_ref.label) {
    head.push(`label ${n.paper_ref.label}`)
  }
  head.push(sectionText(digest, n.paper_ref.section))
  if (n.parent_id) {
    head.push(`claim inside ${n.parent_id}`)
  }
  const lines = [`[${head.join(' · ')}]`]
  if (n.headline) {
    lines.push(`headline: ${n.headline}`)
  }
  if (n.role) {
    lines.push(`role: ${n.role}`)
  }
  if (n.statement_plain) {
    lines.push(`plain: ${n.statement_plain}`)
  }
  if (n.explanation) {
    lines.push(`why: ${n.explanation}`)
  }
  lines.push(`class: ${n.classification}${n.classification_cite ? ` (${n.classification_cite})` : ''}`)
  const inferred = n.deps_inferred.filter(id => !n.deps_paper.includes(id))
  if (n.deps_paper.length || inferred.length) {
    lines.push(`uses: ${[...n.deps_paper, ...inferred.map(id => `${id} (inferred)`)].join(', ')}`)
  }
  if (usedBy.length) {
    lines.push(`used by: ${usedBy.join(', ')}`)
  }
  return lines.join('\n')
}

/** Equations in the instructions at most; the rest are a search_paper / read_node away. */
export const CHAT_EQUATIONS = 100
const EQ_CHARS = 160

/** `label (number): LaTeX`, whitespace collapsed and capped, in source order. */
export function equationLines(digest: PaperDigest, cap = CHAT_EQUATIONS) {
  const entries = Object.entries(digest.equations ?? {})
    .sort(([, a], [, b]) => a.file.localeCompare(b.file) || a.line - b.line)
  const lines = entries.slice(0, cap).map(([label, e]) => {
    const tex = e.latex.replace(/\s+/g, ' ').trim()
    return `${label}${e.number ? ` (${e.number})` : ''}: ${tex.length > EQ_CHARS ? `${tex.slice(0, EQ_CHARS)}…` : tex}`
  })
  if (entries.length > cap) {
    lines.push(`… ${entries.length - cap} more (search_paper finds them)`)
  }
  return lines
}

/** Figures in the instructions: one line each, capped in total; view_figure has the rest. */
export const CHAT_FIGURE_CHARS = 8_000
const FIG_DESC_CHARS = 300

/** What the model writes to cite a figure: `\ref{…}` of its LaTeX label, or of its id when it has none (refs.ts resolves both). */
export const figureCite = (f: PaperFigure) => f.label ?? f.id

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** `Figure 2 · \ref{fig:x} · plot · p. 4 · §3 · description… · supports [[a]], [[b]]`. */
export function figureLine(f: PaperFigure) {
  const desc = oneLine(f.description || f.caption)
  const parts = [
    f.number ? `Figure ${f.number}` : 'Figure (unnumbered)',
    `\\ref{${figureCite(f)}}`,
    f.kind,
    ...(f.page ? [`p. ${f.page}`] : []),
    `§${f.section}`,
    desc.length > FIG_DESC_CHARS ? `${desc.slice(0, FIG_DESC_CHARS).replace(/\s+\S*$/, '')}…` : desc
  ]
  if (f.node_ids.length) {
    parts.push(`supports ${f.node_ids.map(id => `[[${id}]]`).join(', ')}`)
  }
  return parts.join(' · ')
}

export function figureLines(digest: PaperDigest, cap = CHAT_FIGURE_CHARS) {
  const figs = digest.figures ?? []
  const lines: string[] = []
  let used = 0
  for (const f of figs) {
    const line = figureLine(f)
    if (used + line.length > cap) {
      break
    }
    lines.push(line)
    used += line.length + 1
  }
  if (lines.length < figs.length) {
    lines.push(`… ${figs.length - lines.length} more figures (view_figure by number)`)
  }
  return lines
}

/** The whole digest as compact text: sections, then one block per node in source order, then equations. */
export function serializeDigest(digest: PaperDigest) {
  const usedBy: Record<string, string[]> = {}
  for (const n of digest.nodes) {
    for (const dep of new Set([...n.deps_paper, ...n.deps_inferred])) {
      (usedBy[dep] ??= []).push(n.id)
    }
  }
  const sections = [...digest.sections]
    .sort((a, b) => a.order - b.order)
    .map(s => `${'  '.repeat(s.level - 1)}§${s.id} ${s.title}`)
  const nodes = digest.nodes.map(n => nodeBlock(digest, n, usedBy[n.id] ?? []))
  const eqs = equationLines(digest)
  const figs = figureLines(digest)
  return [
    `Paper: ${digest.title}${digest.authors?.length ? ` by ${digest.authors.join(', ')}` : ''}`,
    `Main result: ${digest.root_ids.join(', ')}`,
    '',
    'Sections:',
    ...sections,
    '',
    `Nodes (${digest.nodes.length}):`,
    nodes.join('\n\n'),
    ...(eqs.length ? ['', 'Equations (label (number): LaTeX):', ...eqs] : []),
    ...(figs.length ? ['', 'Figures (number · cite as · kind · page · section · description · supports):', ...figs] : [])
  ].join('\n')
}

export function chatInstructions(digest: PaperDigest) {
  const example = digest.root_ids[0] ?? digest.nodes[0]?.id ?? 'node-id'
  const fig = digest.figures?.[0]
  const figureRule = fig
    ? `- Cite figures as \\ref{…} with the exact key from the "cite as" column (for example \\ref{${figureCite(fig)}}, written outside $…$); it renders as a figure chip reading "Figure N" that the reader can open, so the chip is the figure's name: write "\\ref{${figureCite(fig)}} shows …", never "Figure N (\\ref{…})" or "Figure \\ref{…}". Refer only to figures listed below, never invent a figure number, and state only what the figure's description, data summary or the image you were shown contains; do not read off values that are not there.`
    : '- This paper has no figures in the digest; if asked about one, say so.'
  return `You answer questions about one mathematics paper. Below is its digest: every statement (definitions, lemmas, theorems, …) and the major claims inside long proofs, each with a headline, its role, a plain-English statement, why it is in the paper, how it is classified, and what it uses and is used by; then the numbered equations and the figures.

Tools (use them only when the digest is not enough; most questions need none):
- read_node: the verbatim LaTeX statement and proof text of one node, with line numbers. Use it to quote a proof or check an exact step or constant.
- search_paper: search the paper's LaTeX source. Use it to locate where something is defined, chosen or used ("where is … set").
- trace: shortest dependency paths from a supporting node to a result. Always call it for chain questions ("how does X lead to Y", "why does Y need X"): the digest lists only direct uses, so a chain assembled by hand can skip or invent a link. Then explain the path it returns. ancestors: everything a node rests on, or everything resting on it.
- view_figure: one figure's caption, full description, data summary and the figure image itself. Use it when a question is about what a figure shows, reads values off it, or needs more than its one-line summary below.
You have at most 4 tool rounds, then you must answer. Prefer one or two well-aimed calls.

Rules:
- Answer only from the digest and what the tools return. Never assert a fact, bound, proof step or reference they do not contain, and do not fill gaps from general knowledge of the field.
- If neither covers the question, say so in one or two sentences ("The digest doesn't cover …") and, if something nearby is covered, point to it. Do not guess.
- Cite the nodes you rely on inline as [[node-id]], using the exact ids in square brackets in the digest (for example [[${example}]]). Cite every node you mention by name; the reader clicks citations to open the node. Never invent an id or cite one that is not in the digest. Do not wrap citations in backticks or bold. When quoting the source, give the file and line.
${figureRule}
- Math goes in $…$ (inline) using the paper's own notation.
- Keep answers under 200 words, plus any short quotation. Plain paragraphs or a short list; no headings.

Digest:

${serializeDigest(digest)}`
}

function messageChars(m: ModelMessage) {
  if (typeof m.content === 'string') {
    return m.content.length
  }
  let n = 0
  for (const part of m.content) {
    if ('text' in part && typeof part.text === 'string') {
      n += part.text.length
    } else {
      n += JSON.stringify(part).length
    }
  }
  return n
}

/**
 * Drops the oldest turns until the history fits `limit` characters. Cuts only at user messages so an
 * assistant reply never loses the question it answers; the last user turn is always kept.
 */
export function trimHistory(messages: ModelMessage[], limit = CHAT_HISTORY_CHARS) {
  let total = messages.reduce((sum, m) => sum + messageChars(m), 0)
  let start = 0
  while (total > limit) {
    const next = messages.findIndex((m, i) => i > start && m.role === 'user')
    if (next === -1) {
      break
    }
    for (let i = start; i < next; i++) {
      total -= messageChars(messages[i]!)
    }
    start = next
  }
  return messages.slice(start)
}

/** `[[id]]` citations in a text, in order, deduplicated. */
export function citedIds(text: string) {
  return [...new Set([...text.matchAll(/\[\[([^\]\s]+)\]\]/g)].map(m => m[1]!))]
}
