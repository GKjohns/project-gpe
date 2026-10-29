// Assistant text → Comark source. `[[id]]` citations are parsed by the `citations` plugin in components/chat/Comark.ts.
const CITATION = /\[\[([^\]\s]+)\]\]/g
// Inline $…$ (not $$…$$). Comark's math rule skips spans that start with a digit ("$5 and $6"),
// which drops half of a complexity paper's math ($2^{n/\sqrt{\log n}}$); a leading {} keeps them math.
const INLINE_MATH = /\$\$[\s\S]+?\$\$|\$((?:\\\$|[^$\n])+?)\$/g

export function toChatMarkdown(text: string, streaming = false) {
  let out = text
    .replace(/\\\((.+?)\\\)/g, (_, tex: string) => `$${tex}$`)
    .replace(INLINE_MATH, (all, tex: string | undefined) => tex !== undefined && /^\d/.test(tex) ? `\${}${tex}$` : all)
  if (streaming) {
    // Hide a citation that is still arriving ("[[lem-spar") instead of flashing it as text.
    out = out.replace(/\[\[[^\]\s]*\]?$/, '')
  }
  return out
}

/** User text split into plain runs and citations, for the prefilled "Explain [[id]] …" prompts. */
export function splitCitations(text: string): { text?: string, id?: string }[] {
  const out: { text?: string, id?: string }[] = []
  let last = 0
  for (const m of text.matchAll(CITATION)) {
    if (m.index > last) {
      out.push({ text: text.slice(last, m.index) })
    }
    out.push({ id: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    out.push({ text: text.slice(last) })
  }
  return out
}

/**
 * One calm sentence for a failed chat turn. The AI SDK puts the raw HTTP body in `error.message`
 * (in dev that is Nitro's JSON with a stack trace), which must never reach the UI.
 */
export function chatErrorMessage(error: Error | undefined): string {
  const fallback = 'The chat is unavailable right now.'
  if (!error?.message) {
    return fallback
  }
  let body: { statusCode?: number } | undefined
  try {
    body = JSON.parse(error.message)
  } catch {
    // Plain text: the route's own mapped sentence, or a network error.
    return error.message.length <= 160 && !error.message.includes('\n') ? error.message : fallback
  }
  if (body?.statusCode === 404) {
    return 'This paper has no digest to chat with yet.'
  }
  return fallback
}
