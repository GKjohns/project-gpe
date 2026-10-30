// Contract: docs/20261029_digest_v1/implementation_plan.md § Shared types. Change the plan first.

export type NodeKind = 'definition' | 'lemma' | 'proposition' | 'theorem' | 'corollary' | 'claim' | 'remark'
export type Classification = 'standard' | 'routine' | 'novel' | 'unknown'
export type FrictionKind
  = | 'missing_in_lean' | 'missing_in_paper' | 'statement_mismatch' | 'dep_in_lean_not_paper'
    | 'dep_in_paper_not_lean' | 'weaker_in_lean' | 'unmatched_lean_decl' // Phase 2–3
    | 'inferred_dep' | 'unresolved_ref' | 'structure_uncertain' // v1, paper-internal
export interface Friction { kind: FrictionKind, severity: 'info' | 'warn' | 'high', note: string }
export interface PaperRef { label?: string, section: string, sectionTitle?: string, page?: number, file: string, line: number }
export interface LeanRef { file: string, decl: string, line?: number }

export interface ProofNode {
  id: string // stable slug: label-derived ('lem-sparsify') or 'claim-<parent>-<n>'
  name: string // semantic, model-written
  kind: NodeKind
  parent_id?: string // claims only: the statement whose proof contains them
  statement_paper: string // verbatim LaTeX from the source
  statement_plain: string
  explanation: string
  headline?: string // graph card: what it establishes, ≤ ~80 chars, may hold inline $…$ (annotate's graph-labels pass)
  role?: string // graph card: what it contributes to the results that use it, ≤ ~60 chars
  classification: Classification
  classification_cite?: string // required when classification !== 'unknown'
  paper_ref: PaperRef
  lean_ref?: LeanRef
  deps_paper: string[] // node ids, from \ref (mechanical)
  deps_inferred: string[] // node ids, model-inferred from prose; also mirrored as inferred_dep friction
  deps_lean?: string[]
  friction: Friction[]
}

export interface PaperSection { id: string, title: string, level: 1 | 2 | 3, order: number, parent_id?: string, file: string, line: number }
// Additive (Oct 29): cross-ref index, deterministic from the sources at finalize (server/pipeline/latex/equations.ts).
export interface PaperEquation { latex: string, number?: string, section: string, file: string, line: number } // latex is KaTeX-ready
export interface PaperLabel { kind: 'equation' | 'section' | 'statement' | 'figure' | 'other', target?: string, number?: string } // target: section, node or figure id

// Additive (Oct 29, paper reader): the typeset paper and its figures (render + figures stages).
/** A rectangle on a PDF page in PDF points, origin top-left. */
export interface PageRect { page: number, x: number, y: number, w: number, h: number }
/** Where a node sits in the rendered PDF (from SyncTeX); `approx` anchors are page-only (text search in an arXiv PDF). */
export interface PaperAnchor extends PageRect { part: 'statement' | 'proof', approx?: boolean }
export type FigureKind = 'plot' | 'commutative_diagram' | 'graph' | 'diagram' | 'schematic' | 'illustration' | 'table' | 'photo' | 'other'
export interface PaperFigure {
  id: string // 'fig-<label slug>' or 'fig-<n>'
  label?: string
  number?: string // display number ('3', '2.1')
  caption: string // LaTeX, like statement_paper
  section: string
  file: string
  line: number
  page?: number
  rect?: PageRect // the figure's box in the rendered PDF
  image_url?: string // PNG rasterized from the rendered PDF (or the figure's own graphics when the paper did not compile)
  width?: number
  height?: number
  image_source?: 'pdf' | 'file'
  graphics: string[] // \includegraphics targets as written
  tikz: boolean // drawn in TeX (tikzpicture / pgfplots / xy / tikzcd)
  kind: FigureKind
  description: string // vision model's alt text; '' when there was no image to look at
  data_summary?: string // charts: axes, series, trend, values it can actually read ('unreadable' otherwise)
  node_ids: string[] // nodes the figure supports
  confidence: number // 0–1
  model?: string
}
export interface PaperRender {
  status: 'compiled' | 'arxiv_pdf' | 'unavailable'
  engine?: string // 'pdflatex' | 'xelatex' | 'lualatex'
  pdf_url?: string
  pages?: number
  page_size?: { w: number, h: number }
  synctex: boolean
  anchors?: Record<string, PaperAnchor[]> // node id → boxes
  error?: string // why compiling failed (log excerpt)
  rendered_at: string
}

export interface PaperDigest {
  slug: string
  title: string
  authors?: string[]
  source: { kind: 'github' | 'arxiv' | 'upload', ref: string }
  sections: PaperSection[]
  nodes: ProofNode[]
  root_ids: string[] // theorems with no usedBy, main theorem first
  macros: Record<string, string> // \newcommand map for KaTeX
  equations?: Record<string, PaperEquation> // by \label; absent on digests finalized before Oct 29
  labels?: Record<string, PaperLabel> // every \label in the body, classified
  render?: PaperRender // additive: absent until the paper is rendered
  figures?: PaperFigure[] // additive: figure environments, rasterized and described
  generated_at: string
  run_id: string
  metrics: RunMetrics
}

export type RunStage = 'fetch' | 'chunk' | 'outline' | 'extract' | 'resolve' | 'critique' | 'annotate' | 'classify' | 'render' | 'figures' | 'finalize'
export type RunStatus = 'queued' | 'running' | 'waiting_review' | 'failed' | 'cancelled' | 'complete' | 'structure_partial'
export type Profile = 'careful' | 'standard' | 'quick'
export type StructureMethod = 'pipeline' | 'agent'

export interface RunMetrics {
  statements_in_source: number
  statements_extracted: number // recall = extracted / in_source
  claims: number
  refs_mechanical: number
  refs_inferred: number
  schema_retries: number
  critique_findings: number
  review_items: number
  calls: number
  tokens_in: number
  tokens_out: number
  tokens_cached: number
  cost_usd: number
  wallclock_ms: number
  per_stage: Partial<Record<RunStage, { ms: number, cost_usd: number, calls: number }>>
  golden_diff?: { missing: string[], extra: string[], dep_mismatches: number, kind_mismatches?: number } // kind_mismatches: additive, Sprint 8
}
