// Deterministic LaTeX → labeled equations and a label index, so the UI can render \eqref{eq:x} as "(1.2)" with the
// equation in a popover, and \ref to a section or statement as a link. No model calls; runs at finalize from the
// stored sources, so a finalize-only retry backfills older digests.
import type { PaperDigest, PaperEquation, PaperLabel } from '#shared/types'
import type { Skeleton } from '#shared/pipeline'
import { findEnd, flatten, locator, parseTheoremEnvs, readGroup, skipSpace } from './chunk'
import { detectMainFile } from '../sources/main'
import type { SourceFile } from '../sources/main'
import { statementIds } from '../nodes'

// Numbered display environments → the KaTeX wrapper that renders their body (`&` and `\\` need one).
const MATH_ENVS: Record<string, { wrap: string, rows: boolean }> = {
  equation: { wrap: '', rows: false },
  multline: { wrap: 'gathered', rows: false },
  align: { wrap: 'aligned', rows: true },
  flalign: { wrap: 'aligned', rows: true },
  alignat: { wrap: 'alignedat', rows: true },
  gather: { wrap: 'gathered', rows: true },
  eqnarray: { wrap: 'array', rows: true }
}
const LEVEL: Record<string, 1 | 2 | 3> = { section: 1, subsection: 2, subsubsection: 3 }

/** Splits an environment body at top-level `\\` (not inside braces or a nested \begin…\end). */
export function splitRows(body: string): string[] {
  const rows: string[] = []
  let depth = 0
  let last = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
    } else if (c === '\\') {
      const rest = body.slice(i, i + 7)
      if (rest.startsWith('\\begin')) {
        depth++
      } else if (rest.startsWith('\\end')) {
        depth--
      } else if (body[i + 1] === '\\' && depth === 0) {
        rows.push(body.slice(last, i))
        last = i + 2
      }
      i++
    }
  }
  rows.push(body.slice(last))
  return rows
}

const LABEL_G = /\\label\s*\{([^{}]*)\}/g
const TAG = /\\tag\*?\s*\{([^{}]*)\}/
const NONUMBER = /\\(?:nonumber|notag)(?![A-Za-z])/

/** Body as KaTeX input: bookkeeping stripped, wrapped so alignment and row breaks render. */
function renderable(env: string, body: string, arg?: string): string {
  const clean = body.replace(LABEL_G, '').replace(/\\tag\*?\s*\{[^{}]*\}/g, '').replace(/\\(?:nonumber|notag)(?![A-Za-z])/g, '')
    .replace(/\\intertext\s*\{([^{}]*)\}/g, '\\text{$1}').trim()
  const { wrap } = MATH_ENVS[env]!
  if (!wrap) {
    return clean
  }
  if (wrap === 'array') {
    return `\\begin{array}{rcl}${clean}\\end{array}`
  }
  return wrap === 'alignedat' ? `\\begin{alignedat}{${arg ?? '1'}}${clean}\\end{alignedat}` : `\\begin{${wrap}}${clean}\\end{${wrap}}`
}

/** How the paper numbers equations: per section (\numberwithin), per subsection, or globally. */
function equationWithin(preamble: string): 0 | 1 | 2 | 3 {
  const m = /\\(?:numberwithin|counterwithin)\s*\{equation\}\s*\{(section|subsection|subsubsection)\}/.exec(preamble)
    ?? /\\renewcommand\s*\{?\\theequation\}?\s*\{[^]*?\\the(section|subsection|subsubsection)\b/.exec(preamble)
  return m ? LEVEL[m[1]!]! : 0
}

export interface PaperLabels {
  equations: NonNullable<PaperDigest['equations']>
  labels: NonNullable<PaperDigest['labels']>
}

/**
 * Every \label in the paper body, classified, plus each labeled display equation with its display number
 * (best effort: amsmath rows, \tag, \nonumber, starred envs, subequations, \numberwithin, theorems sharing the
 * equation counter). Section ids match `skeleton.sections` (matched by order, as the chunker emits them).
 */
export function extractLabels(files: SourceFile[], skeleton: Pick<Skeleton, 'mainFile' | 'sections' | 'statements'>): PaperLabels {
  const equations: Record<string, PaperEquation> = {}
  const labels: Record<string, PaperLabel> = {}
  const mainFile = skeleton.mainFile || detectMainFile(files)
  const flat = flatten(files, mainFile, [])
  const at = locator(flat)
  const { text } = flat

  const docBegin = /\\begin\s*\{document\}/.exec(text)
  const preamble = docBegin ? text.slice(0, docBegin.index) : text
  const bodyStart = docBegin ? docBegin.index + docBegin[0].length : 0
  const docEnd = text.indexOf('\\end{document}', bodyStart)
  const bodyEnd = docEnd === -1 ? text.length : docEnd

  const within = equationWithin(preamble)
  const { envs: theoremEnvs } = parseTheoremEnvs(preamble)
  const ids = statementIds(skeleton.statements)
  for (const s of skeleton.statements) {
    if (!s.label.startsWith('unlabeled-')) {
      labels[s.label] = { kind: 'statement', target: ids.get(s.label), ...(s.number ? { number: s.number } : {}) }
    }
  }

  let sectionIdx = 0
  const current: (string | undefined)[] = [undefined, undefined, undefined] // section ids by level
  const numbered: (string | undefined)[] = [undefined, undefined, undefined] // last numbered section id by level
  let counter = 0
  let sub: { parent: string, n: number, end: number, label?: string, latex: string[] } | null = null

  const sectionId = () => current[2] ?? current[1] ?? current[0] ?? 'front'
  const nextNumber = (): string => {
    if (sub) {
      sub.n++
      return `${sub.parent}${String.fromCharCode(96 + sub.n)}`
    }
    counter++
    const prefix = within ? numbered[within - 1] : undefined
    return prefix ? `${prefix}.${counter}` : String(counter)
  }
  const closeSub = () => {
    if (sub?.label) {
      const loc = equations[sub.label]
      if (loc) {
        loc.latex = sub.latex.length > 1 ? `\\begin{gathered}${sub.latex.join('\\\\')}\\end{gathered}` : sub.latex[0] ?? ''
      }
    }
    sub = null
  }

  const token = /\\(section|subsection|subsubsection)(\*?)(?![A-Za-z])|\\begin\s*\{([^}]+)\}|\\label\s*\{([^}]*)\}/g
  token.lastIndex = bodyStart
  for (let m = token.exec(text); m && m.index < bodyEnd; m = token.exec(text)) {
    if (sub && m.index >= sub.end) {
      closeSub()
    }
    if (m[1]) {
      const short = readGroup(text, m.index + m[0].length, '[')
      const title = readGroup(text, short ? short.end : m.index + m[0].length, '{')
      if (!title) {
        continue
      }
      const section = skeleton.sections[sectionIdx++]
      const level = LEVEL[m[1]]!
      current[level - 1] = section?.id
      for (let k = level; k < 3; k++) {
        current[k] = undefined
      }
      if (m[2] !== '*') {
        numbered[level - 1] = section?.id
        for (let k = level; k < 3; k++) {
          numbered[k] = undefined
        }
        if (within && level <= within) {
          counter = 0
        }
      }
      token.lastIndex = title.end
      // \section{…}\label{sec:a}\label{sec:b}: every label right after the title names the section.
      for (let after = skipSpace(text, title.end); section;) {
        const lab = /^\\label\s*\{([^}]*)\}/.exec(text.slice(after, after + 200))
        if (!lab) {
          break
        }
        labels[lab[1]!.trim()] = { kind: 'section', target: section.id }
        token.lastIndex = after + lab[0].length
        after = skipSpace(text, token.lastIndex)
      }
      continue
    }
    if (m[4] !== undefined) {
      const label = m[4].trim()
      if (labels[label]) {
        continue
      }
      if (sub && !sub.label) {
        // \begin{subequations}\label{eq:all}: the group's own number.
        const loc = at(m.index)
        sub.label = label
        equations[label] = { latex: '', number: sub.parent, section: sectionId(), file: loc.file, line: loc.line }
        labels[label] = { kind: 'equation' }
      } else {
        labels[label] = { kind: 'other' }
      }
      continue
    }
    const rawEnv = m[3]!.trim()
    const afterBegin = m.index + m[0].length
    if (rawEnv === 'subequations') {
      const close = findEnd(text, afterBegin, 'subequations')
      closeSub()
      counter++
      const prefix = within ? numbered[within - 1] : undefined
      sub = { parent: prefix ? `${prefix}.${counter}` : String(counter), n: 0, end: close?.end ?? bodyEnd, latex: [] }
      continue
    }
    if (theoremEnvs.get(rawEnv)?.counter === 'equation') {
      // \newtheorem{theorem}[equation]: the chunker numbers its own counters; this one is shared with equations.
      const loc = at(m.index)
      const number = nextNumber()
      const st = skeleton.statements.find(s => s.env === rawEnv && s.file === loc.file && s.startLine === loc.line)
      const entry = st && labels[st.label]
      if (entry) {
        entry.number = number
      }
      continue
    }
    const starred = rawEnv.endsWith('*')
    const env = rawEnv.replace(/\*$/, '')
    if (!MATH_ENVS[env]) {
      continue
    }
    const close = findEnd(text, afterBegin, rawEnv)
    if (!close) {
      continue
    }
    const arg = env === 'alignat' ? readGroup(text, afterBegin, '{') : null
    const body = text.slice(arg ? arg.end : afterBegin, close.start)
    const loc = at(m.index)
    const latex = renderable(env, body, arg?.inner)
    if (sub) {
      sub.latex.push(latex)
    }
    const rows = MATH_ENVS[env]!.rows ? splitRows(body) : [body]
    for (const row of rows) {
      const tag = TAG.exec(row)?.[1]?.trim()
      const blank = !row.replace(LABEL_G, '').trim()
      let number: string | undefined
      if (tag !== undefined) {
        number = tag
      } else if (!starred && !NONUMBER.test(row) && !(blank && rows.length > 1)) {
        number = nextNumber()
      }
      for (const lm of row.matchAll(LABEL_G)) {
        const label = lm[1]!.trim()
        equations[label] = { latex, ...(number ? { number } : {}), section: sectionId(), file: loc.file, line: loc.line }
        labels[label] = { kind: 'equation' }
      }
    }
    token.lastIndex = close.end
  }
  closeSub()
  return { equations, labels }
}
