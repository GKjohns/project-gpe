import { renderTex } from './katex'

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * One-line text with inline `$…$` math, as HTML: the prose is escaped, the math goes through KaTeX with the
 * paper's macros. For graph cards (inline, inside a button), where MathText's block wrapper doesn't fit.
 */
export function inlineMathHtml(text: string, macros?: Record<string, string>): string {
  const out: string[] = []
  let last = 0
  for (const m of text.matchAll(/\$((?:\\\$|[^$])+?)\$/g)) {
    out.push(escapeHtml(text.slice(last, m.index)))
    out.push(renderTex(m[1]!, false, macros))
    last = m.index + m[0].length
  }
  out.push(escapeHtml(text.slice(last)))
  return out.join('')
}
