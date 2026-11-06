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

const SYMBOL: Record<string, string> = {
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', to: '→', infty: '∞', in: '∈', times: '×', cdot: '·',
  approx: '≈', sim: '~', pm: '±', ldots: '…', cdots: '…', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  epsilon: 'ε', varepsilon: 'ε', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω',
  Omega: 'Ω', Theta: 'Θ', Delta: 'Δ'
}
const BB: Record<string, string> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', F: '𝔽' }

/**
 * Text with inline `$…$` math as plain Unicode, for places nothing renders TeX (link previews, <title>):
 * `$2^{O(\sqrt{\log n})}$` → `2^(O(√(log n)))`. Approximate by design; unknown commands keep their name.
 */
export function plainMath(text: string): string {
  return text.replace(/\$((?:\\\$|[^$])+?)\$/g, (_, tex: string) => {
    let s = tex
      .replace(/\\(?:mathbb|mathbf)\{([A-Z])\}/g, (m, c: string) => BB[c] ?? c)
      .replace(/\\(?:left|right|big|Big|quad)\b|\\[,;!]/g, '')
      .replace(/\\(?:mathrm|mathcal|mathsf|mathbf|operatorname|text|tilde|hat|bar|widetilde|overline)\b/g, '')
      .replace(/\\sqrt\b/g, '√')
      .replace(/\\([a-zA-Z]+)\s*/g, (m, cmd: string) => ` ${SYMBOL[cmd] ?? cmd} `)
    // Innermost groups first: a multi-character script or root keeps parentheses, any other group just loses braces.
    for (let i = 0; i < 8 && s.includes('{'); i++) {
      s = s.replace(/([\^_√]?)\s*\{([^{}]*)\}/g, (m, op: string, body: string) => {
        const b = body.trim()
        return op ? `${op}${b.length > 1 ? `(${b})` : b}` : b
      })
    }
    return s.replace(/\s+/g, ' ').replace(/ ([)/^_,])/g, '$1').replace(/([(/^_√]) /g, '$1').replace(/(\w|[α-ωΑ-Ω]) \(/g, '$1(').trim()
  })
}

/**
 * Plain text for a meta description (search engines show about 160 characters). Longer text is cut at the last space
 * outside parentheses, so a formula is never split mid-expression.
 */
export function metaDescription(text: string, max = 160): string {
  const s = plainMath(text).replace(/\\([#$%&_{}])/g, '$1').replace(/\s+/g, ' ').trim()
  if (s.length <= max) {
    return s
  }
  let cut = 0
  let depth = 0
  for (let i = 0; i < max - 1; i++) {
    const c = s[i]
    depth += c === '(' ? 1 : c === ')' ? -1 : 0
    if (c === ' ' && depth <= 0) {
      cut = i
    }
  }
  return `${s.slice(0, cut || max - 1).replace(/[\s,;:.]+$/, '')}…`
}
