// Pure helpers shared by outline, extract and resolve (no Nitro imports, so tests can use them).
import type { NodeKind } from '#shared/types'
import type { Skeleton } from '#shared/pipeline'
import type { SourceFile } from './sources/main'

type Statement = Skeleton['statements'][number]

/** 'lem:sparsify' → 'lem-sparsify'. */
export function slugifyLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node'
}

/** Statement label → node id, in skeleton order; collisions get '-2', '-3'. */
export function statementIds(statements: Pick<Statement, 'label'>[]): Map<string, string> {
  const ids = new Map<string, string>()
  const used = new Set<string>()
  for (const s of statements) {
    const base = slugifyLabel(s.label)
    let id = base
    for (let n = 2; used.has(id); n++) {
      id = `${base}-${n}`
    }
    used.add(id)
    ids.set(s.label, id)
  }
  return ids
}

export const claimId = (parentId: string, n: number) => `claim-${parentId}-${n}`

const KINDS: [RegExp, NodeKind][] = [
  [/^(theorem|thm|theo)/, 'theorem'],
  [/^(lemma|lem|fact|observation|obs)/, 'lemma'],
  [/^(proposition|prop|conjecture|conj)/, 'proposition'],
  [/^(corollary|cor)/, 'corollary'],
  [/^(definition|defn|def)/, 'definition'],
  // A paper's own \begin{claim} is a statement, not an outlined in-proof claim (NodeKind 'claim' means parent_id is set
  // everywhere: tree, graph, recall). Sprint 8: ALWZ's two Claim environments counted as claims and recall read 33/35.
  [/^(claim)/, 'lemma'],
  [/^(remark|rem|note|example)/, 'remark']
]

/** Environment name → NodeKind; `\newtheorem` aliases ('thm', 'lem*') by prefix, unknown → lemma. */
export function envKind(env: string): NodeKind {
  const e = env.toLowerCase().replace(/\*$/, '')
  return KINDS.find(([re]) => re.test(e))?.[1] ?? 'lemma'
}

export type SourceLines = Map<string, string[]>

export function sourceLines(files: SourceFile[]): SourceLines {
  return new Map(files.map(f => [f.path, f.content.split(/\r?\n/)]))
}

/** Lines start..end (1-based, inclusive) of one file; `numbered` prefixes each with 'n| '. */
export function sliceLines(src: SourceLines, file: string, start: number, end: number, numbered = false): string {
  const lines = src.get(file) ?? []
  const from = Math.max(1, start)
  const to = Math.min(lines.length, end)
  const out: string[] = []
  for (let i = from; i <= to; i++) {
    out.push(numbered ? `${i}| ${lines[i - 1]}` : lines[i - 1]!)
  }
  return out.join('\n')
}

/** The innermost section containing file:line (sections are in document order), or undefined. */
export function sectionAt(skeleton: Skeleton, file: string, line: number) {
  let found: Skeleton['sections'][number] | undefined
  for (const s of skeleton.sections) {
    if (s.file === file && s.line <= line) {
      found = s
    }
  }
  return found
}

/** Up to `max` lines after a statement, stopping at the next statement or proof in the same file. */
export function textAfter(skeleton: Skeleton, src: SourceLines, st: Statement, max = 20): string {
  let end = st.endLine + max
  for (const other of skeleton.statements) {
    if (other.file === st.file && other.startLine > st.endLine) {
      end = Math.min(end, other.startLine - 1)
    }
  }
  const text = sliceLines(src, st.file, st.endLine + 1, end)
  const proofAt = text.search(/\\begin\{proof\}/)
  return proofAt >= 0 ? text.slice(0, proofAt) : text
}

/** Promise.all with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
