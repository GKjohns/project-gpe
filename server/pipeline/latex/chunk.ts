// Deterministic LaTeX → Skeleton. No model calls: the statement list and the \ref graph are facts of the source.
import { posix } from 'node:path'
import type { PaperSection } from '#shared/types'
import type { Skeleton } from '#shared/pipeline'
import { detectMainFile } from '../sources/main'
import type { SourceFile } from '../sources/main'

export const DEFAULT_STATEMENT_ENVS = ['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'claim', 'remark', 'conjecture', 'fact', 'observation']
const REF_RE = /\\(?:ref|cref|Cref|eqref|autoref|labelcref|nameref)\*?\s*\{([^}]*)\}/g
const SECTION_LEVEL: Record<string, 1 | 2 | 3> = { section: 1, subsection: 2, subsubsection: 3 }

export interface ChunkResult {
  skeleton: Skeleton
  warnings: string[]
}

type Statement = Skeleton['statements'][number]
interface Loc { file: string, line: number }

// --- flattening: inline \input/\include, strip comments, keep per-file line numbers ---

/** Drops `%` to end of line, but not `\%`. `\\%` is a line break followed by a comment. */
export function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '\\') {
      i++
    } else if (c === '%') {
      return line.slice(0, i)
    }
  }
  return line
}

interface Flat { text: string, starts: number[], locs: Loc[] }

export function flatten(files: SourceFile[], mainFile: string, warnings: string[]): Flat {
  const byPath = new Map(files.map(f => [posix.normalize(f.path), f]))
  const mainDir = posix.dirname(mainFile)
  const lines: { text: string, loc: Loc }[] = []

  const resolve = (name: string, from: string): SourceFile | undefined => {
    const bases = [posix.join(posix.dirname(from), name), posix.join(mainDir, name), name]
    for (const base of bases) {
      for (const p of [base, `${base}.tex`]) {
        const hit = byPath.get(posix.normalize(p))
        if (hit) {
          return hit
        }
      }
    }
    return undefined
  }

  const visit = (file: SourceFile, stack: string[]) => {
    file.content.split(/\r?\n/).forEach((raw, i) => {
      const loc = { file: file.path, line: i + 1 }
      let rest = stripComment(raw)
      const re = /\\(?:input|include|subfile)\s*\{([^}]+)\}/
      let m = re.exec(rest)
      while (m) {
        const before = rest.slice(0, m.index)
        if (before.trim()) {
          lines.push({ text: before, loc })
        }
        const name = m[1]!.trim()
        const target = resolve(name, file.path)
        if (!target) {
          warnings.push(`\\input{${name}} in ${file.path}:${loc.line} not found in the source`)
        } else if (stack.includes(target.path)) {
          warnings.push(`\\input{${name}} in ${file.path}:${loc.line} is circular; skipped`)
        } else {
          visit(target, [...stack, target.path])
        }
        rest = rest.slice(m.index + m[0].length)
        m = re.exec(rest)
      }
      lines.push({ text: rest, loc })
    })
  }

  const main = byPath.get(posix.normalize(mainFile))
  if (!main) {
    throw new Error(`main file ${mainFile} is not in the source`)
  }
  visit(main, [main.path])

  const starts: number[] = []
  let offset = 0
  for (const l of lines) {
    starts.push(offset)
    offset += l.text.length + 1
  }
  return { text: lines.map(l => l.text).join('\n'), starts, locs: lines.map(l => l.loc) }
}

export function locator(flat: Flat) {
  return (pos: number): Loc => {
    let lo = 0
    let hi = flat.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (flat.starts[mid]! <= pos) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return flat.locs[lo]!
  }
}

// --- small parsing helpers ---

/** Skips spaces and at most one newline (LaTeX's optional-argument lookahead). */
export function skipSpace(text: string, i: number): number {
  let newlines = 0
  while (i < text.length && /\s/.test(text[i]!)) {
    if (text[i] === '\n' && ++newlines > 1) {
      break
    }
    i++
  }
  return i
}

/** Reads a `{…}` or `[…]` group at `i` (after optional whitespace). Brace-aware; `]` inside braces doesn't close. */
export function readGroup(text: string, i: number, open: '{' | '['): { inner: string, end: number } | null {
  const start = skipSpace(text, i)
  if (text[start] !== open) {
    return null
  }
  const close = open === '{' ? '}' : ']'
  let depth = 0
  for (let j = start + 1; j < text.length; j++) {
    const c = text[j]
    if (c === '\\') {
      j++
      continue
    }
    if (c === '{') {
      depth++
    } else if (c === '}') {
      if (depth === 0 && open === '{') {
        return { inner: text.slice(start + 1, j), end: j + 1 }
      }
      depth--
    } else if (c === close && depth === 0) {
      return { inner: text.slice(start + 1, j), end: j + 1 }
    }
  }
  return null
}

/** Position of the `\end{env}` matching a `\begin{env}` whose token ends at `from`; handles same-name nesting. */
export function findEnd(text: string, from: number, env: string): { start: number, end: number } | null {
  const escaped = env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\\\(begin|end)\\s*\\{${escaped}\\}`, 'g')
  re.lastIndex = from
  let depth = 1
  let m = re.exec(text)
  while (m) {
    depth += m[1] === 'begin' ? 1 : -1
    if (depth === 0) {
      return { start: m.index, end: m.index + m[0].length }
    }
    m = re.exec(text)
  }
  return null
}

/** First `\label{}` not inside a nested environment (so an equation label never names its statement). */
function topLevelLabel(body: string): string | undefined {
  const re = /\\(begin|end)\s*\{[^}]*\}|\\label\s*\{([^}]*)\}/g
  let depth = 0
  let m = re.exec(body)
  while (m) {
    if (m[1] === 'begin') {
      depth++
    } else if (m[1] === 'end') {
      depth--
    } else if (depth <= 0) {
      return m[2]!.trim()
    }
    m = re.exec(body)
  }
  return undefined
}

function cleanTitle(raw: string): string {
  let s = raw
  // \texorpdfstring{tex}{pdf} → tex (the UI renders math).
  for (let i = s.indexOf('\\texorpdfstring'); i !== -1; i = s.indexOf('\\texorpdfstring')) {
    const a = readGroup(s, i + '\\texorpdfstring'.length, '{')
    const b = a && readGroup(s, a.end, '{')
    if (!a || !b) {
      break
    }
    s = s.slice(0, i) + a.inner + s.slice(b.end)
  }
  return s.replace(/\s+/g, ' ').trim()
}

const letter = (n: number) => {
  let s = ''
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) {
    s = String.fromCharCode(65 + ((k - 1) % 26)) + s
  }
  return s
}

// --- preamble: macros and theorem environments ---

export function parseMacros(preamble: string): Record<string, string> {
  const macros: Record<string, string> = {}
  const re = /\\(?:(?:re)?newcommand|providecommand)\*?\s*(?:\{\s*(\\[A-Za-z@]+)\s*\}|(\\[A-Za-z@]+))\s*(?:\[\s*\d\s*\])?\s*(?:\[[^\]]*\])?|\\DeclareMathOperator(\*?)\s*\{\s*(\\[A-Za-z@]+)\s*\}|\\def\s*(\\[A-Za-z@]+)\s*(?:#\d)*/g
  let m = re.exec(preamble)
  while (m) {
    const group = readGroup(preamble, m.index + m[0].length, '{')
    if (group) {
      if (m[4]) {
        macros[m[4]] = `\\operatorname${m[3] ? '*' : ''}{${group.inner}}`
      } else {
        macros[(m[1] ?? m[2] ?? m[5])!] = group.inner
      }
      re.lastIndex = group.end
    }
    m = re.exec(preamble)
  }
  return macros
}

interface EnvDef { counter?: string, numbered: boolean }
interface CounterDef { within?: 'section' | 'subsection' | 'subsubsection' }

export function parseTheoremEnvs(preamble: string) {
  const envs = new Map<string, EnvDef>()
  const counters = new Map<string, CounterDef>()
  const re = /\\newtheorem(\*?)\s*\{([^}]+)\}\s*(?:\[([^\]]+)\])?\s*\{[^}]*\}\s*(?:\[([^\]]+)\])?/g
  let m = re.exec(preamble)
  while (m) {
    const [, star, name, shared, within] = m
    if (star) {
      envs.set(name!.trim(), { numbered: false })
    } else if (shared) {
      envs.set(name!.trim(), { counter: shared.trim(), numbered: true })
    } else {
      envs.set(name!.trim(), { counter: name!.trim(), numbered: true })
      counters.set(name!.trim(), { within: within?.trim() as CounterDef['within'] })
    }
    m = re.exec(preamble)
  }
  const nw = /\\numberwithin\s*\{([^}]+)\}\s*\{([^}]+)\}/g
  for (let n = nw.exec(preamble); n; n = nw.exec(preamble)) {
    if (counters.has(n[1]!.trim())) {
      counters.set(n[1]!.trim(), { within: n[2]!.trim() as CounterDef['within'] })
    }
  }
  return { envs, counters }
}

// --- the chunker ---

export function chunkLatex(files: SourceFile[], opts: { mainFile?: string, envs?: string[] } = {}): ChunkResult {
  const warnings: string[] = []
  const mainFile = opts.mainFile ?? detectMainFile(files)
  const flat = flatten(files, mainFile, warnings)
  const at = locator(flat)
  const { text } = flat

  const docBegin = /\\begin\s*\{document\}/.exec(text)
  const preamble = docBegin ? text.slice(0, docBegin.index) : text
  const bodyStart = docBegin ? docBegin.index + docBegin[0].length : 0
  const docEnd = text.indexOf('\\end{document}', bodyStart)
  const bodyEnd = docEnd === -1 ? text.length : docEnd

  const macros = parseMacros(preamble)
  const { envs: declared, counters } = parseTheoremEnvs(preamble)
  const envNames = new Set([...(opts.envs ?? DEFAULT_STATEMENT_ENVS), ...declared.keys()])

  const sections: PaperSection[] = []
  const statements: (Statement & { pos: number, endPos: number })[] = []
  const proofs: { pos: number, innerStart: number, innerEnd: number, endPos: number, target?: string }[] = []
  // Sections titled "Proof of Lemma~\ref{x}" (Sprint 8, Rao's Coding for Sunflowers): the section body is x's proof.
  const proofSections: { pos: number, start: number, level: number, target: string }[] = []
  const sectionStarts: { pos: number, level: number }[] = []

  // Section state for numbering and sectionId.
  const secNums = [0, 0, 0]
  const current: (PaperSection | undefined)[] = [undefined, undefined, undefined]
  let appendix = false
  const counterValues = new Map<string, number>()
  const unlabeledPerSection = new Map<string, number>()

  const resetCounters = (level: 1 | 2 | 3) => {
    const levels = ['section', 'subsection', 'subsubsection'].slice(level - 1)
    for (const [name, def] of counters) {
      if (def.within && levels.includes(def.within)) {
        counterValues.set(name, 0)
      }
    }
  }
  const sectionNumber = (level: number) => {
    const head = appendix ? letter(secNums[0]!) : String(secNums[0])
    return [head, ...secNums.slice(1, level).map(String)].join('.')
  }

  const token = /\\(section|subsection|subsubsection)(\*?)(?![A-Za-z])|\\appendix(?![A-Za-z])|\\begin\s*\{([^}]+)\}/g
  token.lastIndex = bodyStart
  for (let m = token.exec(text); m && m.index < bodyEnd; m = token.exec(text)) {
    if (m[1]) {
      const level = SECTION_LEVEL[m[1]]!
      const starred = m[2] === '*'
      const short = readGroup(text, m.index + m[0].length, '[')
      const title = readGroup(text, short ? short.end : m.index + m[0].length, '{')
      if (!title) {
        continue
      }
      let id: string
      if (starred) {
        id = `s${sections.length + 1}`
      } else {
        secNums[level - 1]!++
        for (let k = level; k < 3; k++) {
          secNums[k] = 0
        }
        resetCounters(level)
        id = sectionNumber(level)
      }
      const loc = at(m.index)
      const parent = level > 1 ? current[level - 2] : undefined
      const section: PaperSection = {
        id,
        title: cleanTitle(title.inner),
        level,
        order: sections.length,
        ...(parent ? { parent_id: parent.id } : {}),
        file: loc.file,
        line: loc.line
      }
      sections.push(section)
      sectionStarts.push({ pos: m.index, level })
      const proofOf = /^\s*proofs?\s+of\b[^]*?\\(?:ref|cref|Cref|autoref)\*?\s*\{([^},]+)/i.exec(title.inner)
      if (proofOf) {
        proofSections.push({ pos: m.index, start: title.end, level, target: proofOf[1]!.trim() })
      }
      current[level - 1] = section
      for (let k = level; k < 3; k++) {
        current[k] = undefined
      }
      token.lastIndex = title.end
      continue
    }
    if (!m[3]) {
      // \appendix: sections restart at A.
      appendix = true
      secNums[0] = 0
      continue
    }

    const env = m[3].trim()
    const afterBegin = m.index + m[0].length
    if (env === 'proof') {
      const opt = readGroup(text, afterBegin, '[')
      const innerStart = opt ? opt.end : afterBegin
      const close = findEnd(text, afterBegin, 'proof')
      if (!close) {
        warnings.push(`unclosed proof at ${at(m.index).file}:${at(m.index).line}`)
        continue
      }
      // "Proof of Theorem~\ref{x}" attaches to x.
      const target = opt ? /\\(?:ref|cref|Cref|autoref)\*?\s*\{([^},]+)/.exec(opt.inner)?.[1]?.trim() : undefined
      proofs.push({ pos: m.index, innerStart, innerEnd: close.start, endPos: close.end, target })
      continue
    }
    if (!envNames.has(env)) {
      continue
    }
    const close = findEnd(text, afterBegin, env)
    if (!close) {
      warnings.push(`unclosed ${env} at ${at(m.index).file}:${at(m.index).line}`)
      continue
    }
    const opt = readGroup(text, afterBegin, '[')
    const body = text.slice(opt ? opt.end : afterBegin, close.start).trim()
    const section = current[2] ?? current[1] ?? current[0]
    const sectionId = section?.id ?? 'front'

    let number: string | undefined
    const def = declared.get(env)
    if (def?.numbered && def.counter) {
      const value = (counterValues.get(def.counter) ?? 0) + 1
      counterValues.set(def.counter, value)
      const within = counters.get(def.counter)?.within
      const level = within ? SECTION_LEVEL[within]! : 0
      number = level && secNums[0] ? `${sectionNumber(level)}.${value}` : String(value)
    }

    let label = topLevelLabel(body)
    if (!label) {
      const n = (unlabeledPerSection.get(sectionId) ?? 0) + 1
      unlabeledPerSection.set(sectionId, n)
      label = `unlabeled-${sectionId}-${n}`
    }
    const start = at(m.index)
    const end = at(close.start)
    statements.push({
      label,
      env,
      ...(opt ? { title: cleanTitle(opt.inner) } : {}),
      ...(number ? { number } : {}),
      sectionId,
      file: start.file,
      startLine: start.line,
      endLine: end.line,
      body,
      pos: m.index,
      endPos: close.end
    })
  }

  // --- proofs → statements ---
  const byLabel = new Map(statements.map(s => [s.label, s]))
  // A "Proof of …" section runs to the next section at the same or a higher level; it attaches like a titled proof.
  for (const ps of proofSections) {
    if (!byLabel.has(ps.target)) {
      continue
    }
    const next = sectionStarts.find(x => x.pos > ps.pos && x.level <= ps.level)
    const endPos = Math.min(next?.pos ?? bodyEnd, bodyEnd)
    proofs.push({ pos: ps.pos, innerStart: ps.start, innerEnd: endPos, endPos, target: ps.target })
  }
  proofs.sort((a, b) => a.pos - b.pos)
  const owner = new Map<number, string>() // proof index → statement label
  proofs.forEach((p, i) => {
    let label: string | undefined
    if (p.target && byLabel.has(p.target)) {
      label = p.target
    } else {
      if (p.target) {
        warnings.push(`proof at ${at(p.pos).file}:${at(p.pos).line} names ${p.target}, which is not a statement; attached by position`)
      }
      // Nearest preceding statement that has no proof yet.
      for (let j = statements.length - 1; j >= 0; j--) {
        const s = statements[j]!
        if (s.endPos <= p.pos && !s.proof) {
          label = s.label
          break
        }
      }
    }
    if (!label) {
      warnings.push(`proof at ${at(p.pos).file}:${at(p.pos).line} has no statement to attach to`)
      return
    }
    owner.set(i, label)
    const s = byLabel.get(label)!
    const start = at(p.pos)
    const end = at(p.endPos - 1)
    if (s.proof) {
      // A second proof of the same statement (e.g. two parts of a theorem proved apart): its refs still count.
      warnings.push(`${label} has a second proof at ${start.file}:${start.line}; keeping the first span`)
    } else {
      s.proof = { file: start.file, startLine: start.line, endLine: end.line, lines: end.line - start.line + 1 }
    }
  })

  // --- refs inside proofs (nested proofs are scanned on their own) ---
  const refs: Skeleton['refs'] = []
  const unresolved: Skeleton['unresolved'] = []
  proofs.forEach((p, i) => {
    const from = owner.get(i)
    if (!from) {
      return
    }
    const nested = proofs.filter(q => q !== p && q.pos > p.innerStart && q.endPos <= p.innerEnd)
    const re = new RegExp(REF_RE.source, 'g')
    re.lastIndex = p.innerStart
    for (let m = re.exec(text); m && m.index < p.innerEnd; m = re.exec(text)) {
      const pos = m.index
      if (nested.some(q => pos >= q.pos && pos < q.endPos)) {
        continue
      }
      const loc = at(pos)
      for (const raw of m[1]!.split(',')) {
        const target = raw.trim()
        if (!target || target === from) {
          continue
        }
        if (byLabel.has(target)) {
          refs.push({ fromLabel: from, toLabel: target, file: loc.file, line: loc.line })
        } else {
          unresolved.push({ fromLabel: from, target })
        }
      }
    }
  })

  const skeleton: Skeleton = {
    files: files.map(f => ({ path: f.path, lines: f.content.split(/\r?\n/).length })),
    mainFile,
    macros,
    sections,
    statements: statements.map(({ pos: _p, endPos: _e, ...s }) => s),
    refs,
    unresolved
  }
  return { skeleton, warnings }
}
