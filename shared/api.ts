// Response shapes for the read routes the app pages consume. Additive to the plan's contracts (Sprint 5).
import type { FamilySummary, ManuscriptItem } from './catalog'
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
  /** The openai/math family and manuscript, when papers.manuscript_dir links one. */
  catalog?: { family: FamilySummary, manuscript: ManuscriptItem } | null
}

/** `GET /api/papers`: one public, digested paper. No run, cost or progress. */
export interface PublicPaperItem {
  slug: string
  title: string
  authors: string[]
  counts: { nodes: number, sections: number, novel: number, friction: number }
  family?: { number: number, code: string, title: string, discipline: string, disciplineSlug: string }
  pages?: number
  hasLean?: boolean
  headline?: string
  updatedAt: string
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

/** `GET /api/admin/papers`: every paper joined with its latest run (operator library). */
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
  public: boolean
  family?: { number: number, code: string }
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
  equations: ReadEquation[]
  truncated?: string
}

/** An equation a span references or defines: its label, display number, KaTeX-ready body, and where it is in the source. */
export interface ReadEquation { label: string, number?: string, latex: string, file: string, line: number }

/** `read_source`: a numbered, comment-stripped line range of one source file (by range or by section), with what lies in it. */
export interface ReadSourceOutput {
  file: string
  from: number // first line returned
  to: number // last line returned (the span's end when it was not cut)
  section?: string // '§6.2 Title' of the section the range starts in
  text: string // 'N| line' per non-blank line, as read_node's proof text
  nodes_in_range: ChatToolNode[] // nodes whose statement, proof or claim span meets the range
  equations: ReadEquation[]
  next_from?: number // set when the range was cut by the line or character cap: continue from here
  file_lines: number // the file's last line number, so `to === file_lines` means end of file
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
