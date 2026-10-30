// Deterministic LaTeX → the paper's figures: every figure environment's label, caption, display number, section,
// \includegraphics targets (resolved against the stored assets, \graphicspath and extensionless refs), whether it is
// drawn in TeX, and the prose around it for the vision prompt. No model calls; pure, no Nitro imports.
import { posix } from 'node:path'
import type { Skeleton } from '#shared/pipeline'
import { findEnd, flatten, locator, readGroup } from './chunk'
import { detectMainFile } from '../sources/main'
import type { SourceFile } from '../sources/main'
import { slugifyLabel } from '../nodes'

export interface FigureSource {
  id: string
  env: string
  label?: string
  labels: string[] // every \label inside, subfigures' included
  number?: string
  caption: string
  subcaptions: string[]
  section: string
  file: string
  line: number
  /** Source lines the environment covers, per file (a figure can \input its body from another file). */
  spans: { file: string, start: number, end: number }[]
  caption_span?: { file: string, start: number, end: number } // the main \caption's lines (left out of the crop)
  graphics: { ref: string, path?: string }[] // as written; path: the stored asset it resolves to
  tikz: boolean
  body: string // the environment's LaTeX, trimmed (for the vision prompt: TikZ source names the labels exactly)
  context: string // prose before the figure and around its first \refs
}

const FIGURE_ENVS = ['figure', 'figure*', 'wrapfigure', 'SCfigure']
const LEVEL: Record<string, 1 | 2 | 3> = { section: 1, subsection: 2, subsubsection: 3 }
// pdfLaTeX's search order for an extensionless \includegraphics, plus what the other engines and our rasterizer take.
const GRAPHIC_EXTS = ['.pdf', '.png', '.jpg', '.mps', '.jpeg', '.eps', '.ps', '.svg', '.gif']
const TIKZ_RE = /\\begin\s*\{(?:tikzpicture|tikzcd|pgfpicture|circuitikz|forest|axis)\}|\\xymatrix|\\begin\s*\{xy\}|\\tikz\b|\\begin\s*\{(?:pspicture|picture)\}/
const BODY_MAX = 3500
const CONTEXT_MAX = 1800

/** `\graphicspath{{figs/}{img/}}` → ['figs/', 'img/']. */
export function graphicsPaths(preamble: string): string[] {
  const m = /\\graphicspath\s*\{((?:\s*\{[^{}]*\})+)\s*\}/.exec(preamble)
  return m ? [...m[1]!.matchAll(/\{([^{}]*)\}/g)].map(g => g[1]!.trim()).filter(Boolean) : []
}

/** Resolves an \includegraphics target to a stored asset path the way TeX would (relative to the main file's dir). */
export function resolveGraphic(ref: string, assets: string[], mainFile: string, paths: string[] = []): string | undefined {
  const name = ref.trim().replace(/^"(.*)"$/, '$1')
  const have = new Set(assets.map(a => posix.normalize(a)))
  const mainDir = posix.dirname(mainFile)
  const dirs = ['', ...paths]
  const hasExt = /\.[a-z0-9]{2,4}$/i.test(posix.basename(name)) && GRAPHIC_EXTS.includes(posix.extname(name).toLowerCase())
  for (const dir of dirs) {
    for (const base of [posix.join(mainDir, dir, name), posix.join(dir, name)]) {
      const candidates = hasExt ? [base] : GRAPHIC_EXTS.map(e => base + e)
      for (const c of candidates) {
        const norm = posix.normalize(c)
        if (have.has(norm)) {
          return norm
        }
      }
    }
  }
  return undefined
}

function figureWithin(preamble: string): 0 | 1 | 2 | 3 {
  const m = /\\(?:numberwithin|counterwithin)\s*\{figure\}\s*\{(section|subsection|subsubsection)\}/.exec(preamble)
    ?? /\\renewcommand\s*\{?\\thefigure\}?\s*\{[^]*?\\the(section|subsection|subsubsection)\b/.exec(preamble)
  return m ? LEVEL[m[1]!]! : 0
}

/** Blanks every `\begin{env}…\end{env}` of the given names, keeping offsets (so a main caption isn't a subfigure's). */
function blankEnvs(body: string, names: string[]): string {
  let out = body
  for (const name of names) {
    const re = new RegExp(`\\\\begin\\s*\\{${name.replace('*', '\\*')}\\}`, 'g')
    for (let m = re.exec(out); m; m = re.exec(out)) {
      const close = findEnd(out, m.index + m[0].length, name)
      const end = close ? close.end : out.length
      out = out.slice(0, m.index) + ' '.repeat(end - m.index) + out.slice(end)
    }
  }
  return out
}

function captions(body: string): { text: string, start: number, end: number }[] {
  const out: { text: string, start: number, end: number }[] = []
  const re = /\\(?:sub)?caption(?:of\s*\{figure\})?\*?(?![A-Za-z])/g
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const short = readGroup(body, m.index + m[0].length, '[')
    const long = readGroup(body, short ? short.end : m.index + m[0].length, '{')
    if (long) {
      out.push({ text: long.inner.replace(/\\label\s*\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim(), start: m.index, end: long.end })
      re.lastIndex = long.end
    }
  }
  return out
}

const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}…` : s
const squash = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

/**
 * Every figure environment in document order. `assets` are the stored asset paths (for resolving graphics);
 * section ids match `skeleton.sections` (matched by order, as the chunker emits them).
 */
export function extractFigures(files: SourceFile[], skeleton: Pick<Skeleton, 'mainFile' | 'sections'>, assets: string[] = []): FigureSource[] {
  const textFiles = files.filter(f => !f.data)
  const mainFile = skeleton.mainFile || detectMainFile(textFiles)
  const flat = flatten(textFiles, mainFile, [])
  const at = locator(flat)
  const { text } = flat
  const docBegin = /\\begin\s*\{document\}/.exec(text)
  const preamble = docBegin ? text.slice(0, docBegin.index) : ''
  const bodyStart = docBegin ? docBegin.index + docBegin[0].length : 0
  const docEnd = text.indexOf('\\end{document}', bodyStart)
  const bodyEnd = docEnd === -1 ? text.length : docEnd
  const within = figureWithin(preamble)
  const gpaths = graphicsPaths(preamble)

  const figures: FigureSource[] = []
  const current: (string | undefined)[] = [undefined, undefined, undefined]
  const numbered: (string | undefined)[] = [undefined, undefined, undefined]
  let sectionIdx = 0
  let counter = 0
  const used = new Set<string>()

  const token = /\\(section|subsection|subsubsection)(\*?)(?![A-Za-z])|\\begin\s*\{(figure\*?|wrapfigure|SCfigure)\}/g
  token.lastIndex = bodyStart
  for (let m = token.exec(text); m && m.index < bodyEnd; m = token.exec(text)) {
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
      continue
    }
    const env = m[3]!
    const open = m.index + m[0].length
    const close = findEnd(text, open, env)
    if (!close || !FIGURE_ENVS.includes(env)) {
      continue
    }
    token.lastIndex = close.end
    const body = text.slice(open, close.start)
    const outer = blankEnvs(body, ['subfigure', 'subfigure*', 'minipage'])
    const mainCaps = captions(outer)
    const allCaps = captions(body)
    const subcaptions = allCaps.filter(c => !mainCaps.some(x => x.start === c.start)).map(c => c.text)
    // \caption inside a minipage still names the whole figure when it is the only one.
    const capHit = mainCaps[mainCaps.length - 1] ?? (allCaps.length === 1 ? allCaps[0]! : undefined)
    const caption = capHit?.text ?? ''
    const capFrom = capHit ? at(open + capHit.start) : undefined
    const capTo = capHit ? at(open + capHit.end - 1) : undefined
    const labels = [...body.matchAll(/\\label\s*\{([^}]*)\}/g)].map(l => l[1]!.trim())
    const outerLabel = [...outer.matchAll(/\\label\s*\{([^}]*)\}/g)].map(l => l[1]!.trim())[0]
    const label = outerLabel ?? labels[0]
    const hasCaption = /\\caption(?:of)?(?![A-Za-z])/.test(body)
    let number: string | undefined
    if (hasCaption) {
      counter++
      const prefix = within ? numbered[within - 1] : undefined
      number = prefix ? `${prefix}.${counter}` : String(counter)
    }
    const graphics = [...body.matchAll(/\\includegraphics\*?\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)].map((g) => {
      const ref = g[1]!.trim()
      const path = resolveGraphic(ref, assets, mainFile, gpaths)
      return path ? { ref, path } : { ref }
    })
    // Source lines covered, per file.
    const spans = new Map<string, { start: number, end: number }>()
    for (let i = 0; i < flat.starts.length; i++) {
      const lineStart = flat.starts[i]!
      const lineEnd = flat.starts[i + 1] ?? text.length
      if (lineEnd <= m.index) {
        continue
      }
      if (lineStart >= close.end) {
        break
      }
      const loc = flat.locs[i]!
      const cur = spans.get(loc.file)
      spans.set(loc.file, cur ? { start: Math.min(cur.start, loc.line), end: Math.max(cur.end, loc.line) } : { start: loc.line, end: loc.line })
    }
    const loc = at(m.index)
    const base = label ? `fig-${slugifyLabel(label.replace(/^fig(?:ure)?[:\-_]/i, ''))}` : `fig-${number ?? figures.length + 1}`
    let id = base
    for (let n = 2; used.has(id); n++) {
      id = `${base}-${n}`
    }
    used.add(id)

    // Context: the prose just before the figure, and around the first two \refs to it.
    const before = squash(text.slice(Math.max(bodyStart, m.index - 700), m.index))
    const around: string[] = []
    for (const l of labels) {
      const re = new RegExp(`\\\\(?:c|C|auto|sub)?ref\\*?\\s*\\{[^}]*\\b${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^}]*\\}`, 'g')
      for (const r of text.matchAll(re)) {
        if (r.index! < m.index || r.index! > close.end) {
          around.push(squash(text.slice(Math.max(bodyStart, r.index! - 450), Math.min(bodyEnd, r.index! + 450))))
        }
        if (around.length >= 2) {
          break
        }
      }
    }
    figures.push({
      id,
      env,
      ...(label ? { label } : {}),
      labels,
      ...(number ? { number } : {}),
      caption,
      subcaptions,
      section: current[2] ?? current[1] ?? current[0] ?? 'front',
      file: loc.file,
      line: loc.line,
      spans: [...spans].map(([file, s]) => ({ file, ...s })),
      ...(capFrom && capTo && capFrom.file === capTo.file ? { caption_span: { file: capFrom.file, start: capFrom.line, end: capTo.line } } : {}),
      graphics,
      tikz: TIKZ_RE.test(body),
      body: clip(squash(body), BODY_MAX),
      context: clip([before, ...around].join('\n…\n'), CONTEXT_MAX)
    })
  }
  return figures
}
