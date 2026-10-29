// Pure helpers shared by the fetchers, the preview route and the chunker (no Nitro imports, so tests can use them).

export interface SourceFile { path: string, content: string }

/** Extensions a LaTeX source needs; everything else (PDFs, images) is dropped at fetch time. */
export const TEXT_EXTS = ['.tex', '.bib', '.sty', '.cls', '.bbl']

export function isTextSource(path: string): boolean {
  const lower = path.toLowerCase()
  return TEXT_EXTS.some(ext => lower.endsWith(ext))
}

export class SourceError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message)
    this.name = 'SourceError'
  }
}

const stripComments = (s: string) => s.replace(/(^|[^\\])%.*$/gm, '$1')

/** The `.tex` with `\documentclass`; if several, the one with `\begin{document}`; else an error listing candidates. */
export function detectMainFile(files: SourceFile[]): string {
  const tex = files.filter(f => f.path.toLowerCase().endsWith('.tex'))
  if (!tex.length) {
    throw new SourceError('No .tex files found in the source')
  }
  if (tex.length === 1) {
    return tex[0]!.path
  }
  const withClass = tex.filter(f => /\\documentclass\b/.test(stripComments(f.content)))
  if (withClass.length === 1) {
    return withClass[0]!.path
  }
  const pool = withClass.length ? withClass : tex
  const withDoc = pool.filter(f => /\\begin\s*\{document\}/.test(stripComments(f.content)))
  if (withDoc.length === 1) {
    return withDoc[0]!.path
  }
  const candidates = (withDoc.length ? withDoc : pool).map(f => f.path).join(', ')
  throw new SourceError(`Could not pick the main .tex file; candidates: ${candidates}`)
}

export interface SourceSummary {
  files: { path: string, bytes: number }[]
  mainFile: string
  estTokens: number
  estPages: number
}

// ETH: ~264 KB of LaTeX ≈ 85k tokens, so ~3.1 bytes per token; pages per the plan's bytes / 3,000.
export function summarize(files: SourceFile[]): SourceSummary {
  const list = files.map(f => ({ path: f.path, bytes: Buffer.byteLength(f.content, 'utf8') }))
  const bytes = list.reduce((n, f) => n + f.bytes, 0)
  return {
    files: list,
    mainFile: detectMainFile(files),
    estTokens: Math.round(bytes / 3.1),
    estPages: Math.max(1, Math.round(bytes / 3000))
  }
}
