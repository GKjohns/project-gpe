// Corpus manifest, goldens and the GET /api/corpus row shape (Sprint 8). Additive to the plan's contracts.
import type { NodeKind, Profile, ProofNode, RunMetrics, RunStage, RunStatus, StructureMethod } from './types'

export type CorpusTier = 'simple' | 'intermediate' | 'whopper'
export type LeanKind = 'mathlib' | 'openai-math' | 'blueprint' | 'none'

export interface CorpusEntry {
  slug: string
  tier: CorpusTier
  title: string
  authors: string[]
  /** `none`: no LaTeX source yet (the Anthropic slot). */
  source: { kind: 'github', url: string } | { kind: 'arxiv', id: string } | { kind: 'none' }
  /** Real page count of the PDF. */
  pages: number | null
  /** From POST /api/papers/preview (bytes / 3.1); drives the default method and profile. */
  estTokens: number | null
  lean: { kind: LeanKind, ref?: string }
  expectedStatements?: number
  golden?: string
  /** The profile Sprint 8 ran it on. */
  profile: Profile
  why: string
  /** Paper rows that hold this entry's runs, per method, replacing the default slug; new runs go to the first (ETH's pipeline runs live on Sprint 4's `eth-e2e`). */
  papers?: Partial<Record<StructureMethod, string[]>>
}

export interface CorpusManifest { version: 1, entries: CorpusEntry[] }

/** Hand-written statement list of a paper: ids, kinds and \ref dependencies only. */
export interface Golden {
  slug: string
  source: string
  notes?: string
  nodes: { id: string, kind: NodeKind, deps_paper: string[] }[]
}

export type GoldenDiff = NonNullable<RunMetrics['golden_diff']>

/**
 * Statement nodes against a golden. Claims are model-made and not in goldens, so they are ignored.
 * dep_mismatches counts edges in the symmetric difference of deps_paper over nodes present in both;
 * kind_mismatches (additive) counts matched nodes whose kind differs.
 */
export function goldenDiff(golden: Golden, nodes: Pick<ProofNode, 'id' | 'kind' | 'deps_paper' | 'parent_id'>[]): GoldenDiff {
  const got = new Map(nodes.filter(n => !n.parent_id).map(n => [n.id, n]))
  const want = new Map(golden.nodes.map(n => [n.id, n]))
  const missing = [...want.keys()].filter(id => !got.has(id))
  const extra = [...got.keys()].filter(id => !want.has(id))
  let depMismatches = 0
  let kindMismatches = 0
  for (const [id, w] of want) {
    const g = got.get(id)
    if (!g) {
      continue
    }
    if (g.kind !== w.kind) {
      kindMismatches++
    }
    const a = new Set(g.deps_paper)
    const b = new Set(w.deps_paper)
    depMismatches += [...a].filter(x => !b.has(x)).length + [...b].filter(x => !a.has(x)).length
  }
  return { missing, extra, dep_mismatches: depMismatches, kind_mismatches: kindMismatches }
}

export const goldenDiffCount = (d: GoldenDiff) => d.missing.length + d.extra.length + d.dep_mismatches + (d.kind_mismatches ?? 0)

/** Paper rows of a corpus entry per method: `papers[method]` from the manifest, else the entry slug (pipeline) or `<slug>-agent`. New runs go to the first. */
export function corpusPaperSlugs(entry: Pick<CorpusEntry, 'slug' | 'papers'>, method: StructureMethod): string[] {
  const listed = entry.papers?.[method]
  if (listed?.length) {
    return listed
  }
  return [method === 'pipeline' ? entry.slug : `${entry.slug}-agent`]
}

/** One method's run of a corpus entry, as GET /api/corpus shows it. */
export interface CorpusRun {
  paperSlug: string
  runId: string
  status: RunStatus
  stage: RunStage | null
  profile: Profile
  costUsd: number
  /** This run plus every ancestor along parent_run_id: what the digest actually cost when stages were reused. */
  lineageCostUsd: number
  startedAt: string
  finishedAt: string | null
  error: string | null
  hasDigest: boolean
  metrics: RunMetrics | null
  /** Agent turns (Method B) from progress. */
  turns: number | null
  progress: Record<string, number>
}

export interface CorpusRow {
  entry: CorpusEntry
  defaultMethod: StructureMethod
  defaultProfile: Profile
  runs: Record<StructureMethod, CorpusRun | null>
}

export interface CorpusResponse {
  rows: CorpusRow[]
  /** Sum of runs.cost_usd over every run on a corpus paper. */
  spendUsd: number
}
