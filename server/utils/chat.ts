// Chat over one paper's digest (Sprint 7): the digest goes in the instructions, answers cite `[[node-id]]`.
import type { ModelMessage } from 'ai'
import type { PaperDigest, ProofNode } from '#shared/types'

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

/** The whole digest as compact text: sections, then one block per node in source order. */
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
  return [
    `Paper: ${digest.title}${digest.authors?.length ? ` by ${digest.authors.join(', ')}` : ''}`,
    `Main result: ${digest.root_ids.join(', ')}`,
    '',
    'Sections:',
    ...sections,
    '',
    `Nodes (${digest.nodes.length}):`,
    nodes.join('\n\n')
  ].join('\n')
}

export function chatInstructions(digest: PaperDigest) {
  return `You answer questions about one mathematics paper, using only the digest of it below. The digest lists every statement (definitions, lemmas, theorems, …) and the major claims inside long proofs, each with a plain-English statement, why it is in the paper, how it is classified, and what it uses and is used by.

Rules:
- Answer only from the digest. Never assert a fact, bound, proof step or reference that the digest does not contain, and do not fill gaps from general knowledge of the field.
- If the digest does not cover the question, say so in one or two sentences ("The digest doesn't cover …") and, if something nearby is covered, point to it. Do not guess.
- Cite the nodes you rely on inline as [[node-id]], using the exact ids in square brackets in the digest (for example [[${digest.root_ids[0] ?? digest.nodes[0]?.id ?? 'node-id'}]]). Cite every node you mention by name; the reader clicks citations to open the node. Never invent an id or cite one that is not in the digest. Do not wrap citations in backticks or bold.
- Math goes in $…$ (inline) using the paper's own notation, as the digest writes it.
- Keep answers under 200 words. Plain paragraphs or a short list; no headings.

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
