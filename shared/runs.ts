// Response shape of GET /api/runs/:id (the run page). Additive to the plan's contracts (Sprint 2).
import type { CritiqueResult, RunProgress } from './pipeline'
import type { PaperDigest, Profile, RunStage, RunStatus, StructureMethod } from './types'

export interface RunEvent {
  id: number
  runId: string
  ts: string
  stage: RunStage | 'run'
  level: 'info' | 'warn' | 'error'
  message: string
  data: Record<string, unknown> | null
}

export interface RunResponse {
  run: {
    id: string
    paperId: string
    parentRunId: string | null
    status: RunStatus
    stage: RunStage | null
    profile: Profile
    structureMethod: StructureMethod
    progress: RunProgress
    budgetUsd: number
    costUsd: number
    error: string | null
    startedAt: string
    finishedAt: string | null
  }
  events: RunEvent[]
  reviewItems: { id: string, kind: string, payload: ReviewItemPayload, decision: string | null }[]
  /** `hasDigest`: papers.digest is set (Sprint 4), so "Open map" has something to open. */
  paper: { slug: string, title: string, sourceKind: PaperDigest['source']['kind'], sourceRef: string, latestRunId: string | null, hasDigest: boolean } | null
}

export const ACTIVE_RUN_STATUSES: RunStatus[] = ['queued', 'running', 'waiting_review']

/** review_items.payload: the critique fix plus enough about its targets for the review queue (Sprint 4). */
export type ReviewItemPayload = CritiqueResult['fixes'][number] & {
  nodes?: { id: string, name: string, kind: string, ref: string }[]
}
