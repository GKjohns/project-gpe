// Prose-level LaTeX that MathText's segmenter can't handle once math is cut out: `\emph{…}` whose body holds math,
// and list environments. Pure string → string, run before the math split.

const STYLED = /\\(emph|textit|textbf)\{/g
const MATH_SPAN = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$(?:\\\$|[^$])+?\$|\\\([\s\S]+?\\\)/g

/** Index of the `}` closing the group that opens at `open` (the index just past `{`), or -1. */
function closeBrace(s: string, open: number) {
  let depth = 1
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      i++
    } else if (c === '{') {
      depth++
    } else if (c === '}' && --depth === 0) {
      return i
    }
  }
  return -1
}

/**
 * `\emph{$(r,\tau)$-design at $t$}` → `$(r,\tau)$\emph{-design at }$t$`: the math leaves the group and each prose
 * piece keeps its style, so the segmenter sees only plain `\emph{prose}` and bare math.
 */
export function liftMathOutOfStyles(text: string): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(STYLED)) {
    if (m.index < last) {
      continue
    }
    const bodyStart = m.index + m[0].length
    const end = closeBrace(text, bodyStart)
    if (end < 0) {
      continue
    }
    const body = text.slice(bodyStart, end)
    if (!MATH_SPAN.test(body)) {
      MATH_SPAN.lastIndex = 0
      continue
    }
    MATH_SPAN.lastIndex = 0
    let rewritten = ''
    let b = 0
    for (const span of body.matchAll(MATH_SPAN)) {
      const prose = body.slice(b, span.index)
      rewritten += (prose ? `\\${m[1]}{${prose}}` : '') + span[0]
      b = span.index + span[0].length
    }
    const tail = body.slice(b)
    rewritten += tail ? `\\${m[1]}{${tail}}` : ''
    out += text.slice(last, m.index) + rewritten
    last = end + 1
  }
  return out + text.slice(last)
}

/** List environments as inline bullets: the begin/end lines go, each `\item` becomes a line break and a bullet. */
export function flattenLists(text: string): string {
  return text
    .replace(/\\(?:begin|end)\{(?:enumerate|itemize|description)\}(?:\[[^\]]*\])?[ \t]*\n?/g, '')
    .replace(/\\item\b(?:\[([^\]]*)\])?[ \t]*/g, (_, label?: string) => `\n\\item{${label ?? ''}}`)
}

export function normalizeTexProse(text: string): string {
  return liftMathOutOfStyles(flattenLists(text))
}
