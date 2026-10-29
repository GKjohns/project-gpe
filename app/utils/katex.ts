import katex from 'katex'

// Package macros KaTeX lacks that papers lean on; the digest's own \newcommand map wins over these.
const BASE_MACROS: Record<string, string> = { '\\mathds': '\\mathbb', '\\bm': '\\boldsymbol' }
// Equation bookkeeping that means nothing to KaTeX (and renders as red text if left in).
const BOOKKEEPING = /\\label\{[^{}]*\}|\\(?:nonumber|notag)\b/g

/** KaTeX with the paper's macros; unknown macros render as red text rather than throwing. Shared by MathText and chat. */
export function renderTex(tex: string, displayMode: boolean, macros?: Record<string, string>) {
  // KaTeX mutates the macro table on \def; give each span its own copy.
  return katex.renderToString(tex.replace(BOOKKEEPING, ''), {
    displayMode,
    throwOnError: false,
    strict: false,
    macros: { ...BASE_MACROS, ...(macros ?? {}) }
  })
}
