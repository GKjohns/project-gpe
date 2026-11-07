import katex from 'katex'

// Package macros KaTeX lacks that papers lean on; the digest's own \newcommand map wins over these.
const BASE_MACROS: Record<string, string> = { '\\mathds': '\\mathbb', '\\bm': '\\boldsymbol' }
// Equation bookkeeping that means nothing to KaTeX (and renders as red text if left in).
const BOOKKEEPING = /\\label\{[^{}]*\}|\\(?:nonumber|notag)\b/g

// A model that writes `$\\bar x$` inside a JSON string without doubling the backslash hands the parser `\b`, and the
// digest stores a backspace followed by "ar". None of these control characters belong in TeX, so each one is read
// back as the escape it came from; a newline or return is restored only where the letters after it complete a command.
const CONTROL: Record<string, string> = { '\b': '\\b', '\f': '\\f', '\v': '\\v', '\t': '\\t', '\u0007': '\\a' }
const NEWLINE_CMD = /\n(?=(?:u|e|eq|abla|ot|otin|mid|eg|geq|leq|subseteq|supseteq|exists)(?![a-zA-Z]))/g
const RETURN_CMD = /\r(?=(?:ho|ight|angle|ceil|floor|vert|Vert|brace|lbrace|rbrace)(?![a-zA-Z]))/g

/** Restore TeX commands whose backslash was eaten as a string escape (see CONTROL). */
export function repairTexEscapes(text: string) {
  // eslint-disable-next-line no-control-regex -- the control characters are the point
  return text.replace(/[\b\f\v\t\u0007]/g, c => CONTROL[c]!).replace(NEWLINE_CMD, '\\n').replace(RETURN_CMD, '\\r')
}

/** KaTeX with the paper's macros; unknown macros render as red text rather than throwing. Shared by MathText and chat. */
export function renderTex(tex: string, displayMode: boolean, macros?: Record<string, string>) {
  // KaTeX mutates the macro table on \def; give each span its own copy.
  return katex.renderToString(repairTexEscapes(tex).replace(BOOKKEEPING, ''), {
    displayMode,
    throwOnError: false,
    strict: false,
    macros: { ...BASE_MACROS, ...(macros ?? {}) }
  })
}
