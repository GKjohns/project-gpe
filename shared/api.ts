// Response shapes for the read routes the app pages consume. Additive to the plan's contracts (Sprint 5).
import type { PaperDigest, Profile, RunStage, RunStatus, StructureMethod } from './types'

/** `GET /api/papers/:slug` (and the dev-only `/api/papers/toy`). `paper.id` is null for the toy fixture. */
export interface PaperResponse {
  paper: {
    id: string | null
    slug: string
    title: string
    authors: string[]
    sourceKind: PaperDigest['source']['kind']
    sourceRef: string
    tier: string | null
    latestRunId: string | null
  }
  digest: PaperDigest | null
}

/** `POST /api/papers/:slug/chat`: usage attached to each assistant message's metadata on finish (Sprint 7). */
export interface ChatTurnMetadata {
  model: string
  tokensIn: number
  tokensOut: number
  tokensCached: number
  costUsd: number
  costSource: 'gateway' | 'price_table'
  ms: number
}

/** One card on the library page: a paper joined with its latest run. */
export interface PaperListItem {
  id: string | null
  slug: string
  title: string
  authors: string[]
  sourceKind: PaperDigest['source']['kind']
  sourceRef: string
  tier: string | null
  createdAt: string | null
  /** Present when papers.digest is set. */
  counts: { nodes: number, sections: number, novel: number, friction: number } | null
  run: {
    id: string
    status: RunStatus
    stage: RunStage | null
    profile: Profile
    structureMethod: StructureMethod
    costUsd: number
    startedAt: string
    finishedAt: string | null
    error: string | null
    /** Per-stage counters from runs.progress (numbers only). */
    progress: Record<string, number>
    /** From runs.metrics once finalized. */
    metrics: { cost_usd: number, wallclock_ms: number, calls: number } | null
  } | null
  /** True for the dev-only toy fixture entry (no DB row). */
  fixture?: boolean
}

// --- Chat tools (post-sprint): outputs of the tools `POST /api/papers/:slug/chat` exposes to the model. ---

/** A node as the chat tools name it. */
export interface ChatToolNode { id: string, kind: string, name: string, headline?: string }

/** `read_node`: the verbatim statement, the proof text from the stored sources, and the node's neighbourhood. */
export interface ReadNodeOutput {
  id: string
  kind: string
  name: string
  label?: string
  headline?: string
  role?: string
  section: string
  location?: string // 'file:start-end' of the statement
  parent?: ChatToolNode
  claims?: ChatToolNode[]
  uses: (ChatToolNode & { inferred?: boolean })[]
  used_by: ChatToolNode[]
  statement: string
  proof: { location: string, text: string, source: 'chunk' | 'outline' | 'scan' } | null
  proof_note?: string
  equations: { label: string, number?: string, latex: string }[]
  truncated?: string
}

export interface SearchPaperHit {
  file: string
  line: number
  section?: string // '§6.2 Title'
  node?: string // node id whose statement / proof / claim span contains the line
  part?: 'statement' | 'proof' | 'claim'
  context: string // ±2 lines, numbered, comments stripped
}

/** `search_paper`: case-insensitive search over the stored LaTeX (or the digest's statements when there is none). */
export interface SearchPaperOutput {
  query: string
  scope: 'sources' | 'digest'
  total: number
  hits: SearchPaperHit[]
  note?: string
}

/** `trace`: shortest "feeds into" paths from a supporting node to a result. */
export interface TraceOutput {
  from: string
  to: string
  found: boolean
  steps: number
  paths: { nodes: ChatToolNode[], links: ('cited' | 'inferred' | 'claim of')[] }[]
  note?: string
}

/** `ancestors`: the transitive closure in one direction, by distance. */
/** `view_figure`: one figure's caption, the vision model's description and what it supports (the image goes to the model separately). */
export interface ViewFigureOutput {
  id: string
  /** What to cite: `\ref{cite}` renders as the figure chip. The LaTeX label, or the figure id when it has none. */
  cite: string
  number?: string
  kind: string
  page?: number
  section: string
  caption: string
  description: string
  data_summary?: string
  supports: ChatToolNode[]
  /** Whether the rasterized image was attached for the model to look at. */
  image: boolean
}

export interface AncestorsOutput {
  id: string
  direction: 'supports' | 'supported_by'
  depth: number
  total: number
  levels: { depth: number, nodes: ChatToolNode[] }[]
  truncated?: boolean
}
