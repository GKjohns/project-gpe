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
