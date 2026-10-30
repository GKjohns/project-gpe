// Pure helpers shared by the fetchers, the preview route and the chunker (no Nitro imports, so tests can use them).

/** A source file. Text files (the LaTeX the pipeline reads) carry `content`; binary assets carry `data` and content ''. */
export interface SourceFile { path: string, content: string, data?: Uint8Array }

/** Extensions the pipeline reads as LaTeX text (stored in `sources`). */
export const TEXT_EXTS = ['.tex', '.bib', '.sty', '.cls', '.bbl']
/**
 * Files only the renderer needs (stored as blobs in `source_assets`): \includegraphics targets and what a compile
 * reads besides LaTeX (TikZ/pgfplots inputs and data tables, bibliography styles, class options).
 */
export const ASSET_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.eps', '.ps', '.svg', '.tikz', '.pgf', '.dat', '.csv', '.tsv', '.bst', '.clo', '.def', '.cfg', '.mps', '.pdf_tex', '.eps_tex', '.bbx', '.cbx', '.lbx', '.ist']
/** Per-file and per-paper caps for assets; past them an asset is skipped (the reader falls back, the run goes on). */
export const MAX_ASSET_BYTES = 15 * 1024 * 1024
export const MAX_ASSETS_TOTAL = 60 * 1024 * 1024

export function isTextSource(path: string): boolean {
  const lower = path.toLowerCase()
  return TEXT_EXTS.some(ext => lower.endsWith(ext))
}

export function isAsset(path: string): boolean {
  const lower = path.toLowerCase()
  return !lower.startsWith('__macosx/') && !lower.split('/').pop()!.startsWith('.') && ASSET_EXTS.some(ext => lower.endsWith(ext))
}

export const fileBytes = (f: SourceFile) => f.data ? f.data.byteLength : Buffer.byteLength(f.content, 'utf8')

/** Keeps assets in order until a cap is hit; returns what was kept and what was skipped. */
export function capAssets(assets: SourceFile[]): { kept: SourceFile[], skipped: string[] } {
  const kept: SourceFile[] = []
  const skipped: string[] = []
  let total = 0
  for (const a of assets) {
    const n = fileBytes(a)
    if (n > MAX_ASSET_BYTES || total + n > MAX_ASSETS_TOTAL) {
      skipped.push(a.path)
      continue
    }
    total += n
    kept.push(a)
  }
  return { kept, skipped }
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
  const tex = files.filter(f => !f.data && f.path.toLowerCase().endsWith('.tex'))
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
  const list = files.map(f => ({ path: f.path, bytes: fileBytes(f) }))
  // Size estimates count the LaTeX only; figures don't make a paper longer to read.
  const bytes = files.filter(f => !f.data).reduce((n, f) => n + fileBytes(f), 0)
  return {
    files: list,
    mainFile: detectMainFile(files),
    estTokens: Math.round(bytes / 3.1),
    estPages: Math.max(1, Math.round(bytes / 3000))
  }
}
