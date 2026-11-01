// App-side row types and the mappers that build them from PostgREST rows (contract:
// docs/20261101_supabase_native/implementation_plan.md § Contracts). Field names and types match the Drizzle-era
// `$inferSelect` field for field (camelCase, timestamps as Date, numeric as number, jsonb typed with #shared types),
// so consumers and API JSON don't change: a Date still serializes via toISOString().
import type { Database } from '#supabase/database'
import type { RunProgress } from '#shared/pipeline'
import type { ReviewItemPayload } from '#shared/runs'
import type { PaperDigest, Profile, RunMetrics, RunStage, RunStatus, StructureMethod } from '#shared/types'

type Tables = Database['public']['Tables']
export type DbRow<N extends keyof Tables> = Tables[N]['Row']
export type DbInsert<N extends keyof Tables> = Tables[N]['Insert']

export type AgentSurface = 'llms' | 'v1' | 'mcp'

export interface PaperRow {
  id: string
  slug: string
  title: string
  authors: string[]
  sourceKind: PaperDigest['source']['kind']
  sourceRef: string
  tier: string | null
  digest: PaperDigest | null
  latestRunId: string | null
  public: boolean
  manuscriptDir: string | null
  createdAt: Date
  updatedAt: Date
}

export interface RunRow {
  id: string
  paperId: string
  parentRunId: string | null
  status: RunStatus
  stage: RunStage | null
  profile: Profile
  structureMethod: StructureMethod
  progress: RunProgress
  metrics: RunMetrics | null
  budgetUsd: number
  costUsd: number
  error: string | null
  agentToken: string | null
  startedAt: Date
  finishedAt: Date | null
}

export interface RunEventRow {
  id: number
  runId: string
  ts: Date
  /** A RunStage, or 'run' for lifecycle events outside any stage. */
  stage: string
  level: 'info' | 'warn' | 'error'
  message: string
  data: Record<string, unknown> | null
}

export interface StageOutputRow {
  runId: string
  stage: RunStage
  payload: unknown
  createdAt: Date
}

export interface ReviewItemRow {
  id: string
  runId: string
  kind: string
  payload: ReviewItemPayload
  decision: 'accept' | 'reject' | null
  decidedAt: Date | null
}

export interface SourceRow {
  id: string
  paperId: string
  path: string
  content: string
  bytes: number
}

export interface SourceAssetRow {
  id: string
  paperId: string
  path: string
  blobSha: string
  bytes: number
}

/** A `blobs` row: metadata only; the bytes are Storage object `blobs/<sha>`. */
export interface BlobMeta {
  sha: string
  contentType: string
  size: number
  createdAt: Date
}

export interface FamilyRow {
  number: number
  title: string
  description: string
  discipline: string
  disciplineSlug: string
  position: number
  memberCount: number
  hasLean: boolean
  /** 'reasoning_traces/<file>.pdf' */
  reasoningTrace: string | null
}

export interface ManuscriptRow {
  dir: string
  familyNumber: number
  position: number
  title: string
  abstract: string
  pdfFile: string
  /** 'YYYY-MM-DD', from the dir's '-October-25-2026' suffix */
  publishedOn: string | null
  hasLean: boolean
}

export interface CatalogMetaRow {
  key: string
  value: { sha: string, syncedAt: string, counts: Record<string, number> }
}

export interface AgentRequestRow {
  id: number
  at: Date
  surface: AgentSurface
  tool: string | null
  paper: string | null
  status: number
  ms: number
  client: string
  userAgent: string | null
  ipHash: string | null
  ref: string | null
}

// --- mappers: snake → camel, ISO string → Date, Number() on numerics ---

const date = (s: string) => new Date(s)
const dateOrNull = (s: string | null) => (s == null ? null : new Date(s))

export const paperRow = (r: DbRow<'papers'>): PaperRow => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  authors: r.authors,
  sourceKind: r.source_kind as PaperRow['sourceKind'],
  sourceRef: r.source_ref,
  tier: r.tier,
  digest: r.digest as unknown as PaperDigest | null,
  latestRunId: r.latest_run_id,
  public: r.public,
  manuscriptDir: r.manuscript_dir,
  createdAt: date(r.created_at),
  updatedAt: date(r.updated_at)
})

export const runRow = (r: DbRow<'runs'>): RunRow => ({
  id: r.id,
  paperId: r.paper_id,
  parentRunId: r.parent_run_id,
  status: r.status as RunStatus,
  stage: r.stage as RunStage | null,
  profile: r.profile as Profile,
  structureMethod: r.structure_method as StructureMethod,
  progress: (r.progress ?? {}) as RunProgress,
  metrics: r.metrics as unknown as RunMetrics | null,
  budgetUsd: Number(r.budget_usd),
  costUsd: Number(r.cost_usd),
  error: r.error,
  agentToken: r.agent_token,
  startedAt: date(r.started_at),
  finishedAt: dateOrNull(r.finished_at)
})

export const runEventRow = (r: DbRow<'run_events'>): RunEventRow => ({
  id: Number(r.id),
  runId: r.run_id,
  ts: date(r.ts),
  stage: r.stage,
  level: r.level as RunEventRow['level'],
  message: r.message,
  data: r.data as Record<string, unknown> | null
})

export const stageOutputRow = (r: DbRow<'stage_outputs'>): StageOutputRow => ({
  runId: r.run_id,
  stage: r.stage as RunStage,
  payload: r.payload,
  createdAt: date(r.created_at)
})

export const reviewItemRow = (r: DbRow<'review_items'>): ReviewItemRow => ({
  id: r.id,
  runId: r.run_id,
  kind: r.kind,
  payload: r.payload as unknown as ReviewItemPayload,
  decision: r.decision as ReviewItemRow['decision'],
  decidedAt: dateOrNull(r.decided_at)
})

export const sourceRow = (r: DbRow<'sources'>): SourceRow => ({
  id: r.id,
  paperId: r.paper_id,
  path: r.path,
  content: r.content,
  bytes: r.bytes
})

export const sourceAssetRow = (r: DbRow<'source_assets'>): SourceAssetRow => ({
  id: r.id,
  paperId: r.paper_id,
  path: r.path,
  blobSha: r.blob_sha,
  bytes: r.bytes
})

export const blobMeta = (r: DbRow<'blobs'>): BlobMeta => ({
  sha: r.sha,
  contentType: r.content_type,
  size: r.size,
  createdAt: date(r.created_at)
})

export const familyRow = (r: DbRow<'families'>): FamilyRow => ({
  number: r.number,
  title: r.title,
  description: r.description,
  discipline: r.discipline,
  disciplineSlug: r.discipline_slug,
  position: r.position,
  memberCount: r.member_count,
  hasLean: r.has_lean,
  reasoningTrace: r.reasoning_trace
})

export const manuscriptRow = (r: DbRow<'manuscripts'>): ManuscriptRow => ({
  dir: r.dir,
  familyNumber: r.family_number,
  position: r.position,
  title: r.title,
  abstract: r.abstract,
  pdfFile: r.pdf_file,
  publishedOn: r.published_on,
  hasLean: r.has_lean
})

export const catalogMetaRow = (r: DbRow<'catalog_meta'>): CatalogMetaRow => ({
  key: r.key,
  value: r.value as unknown as CatalogMetaRow['value']
})

export const agentRequestRow = (r: DbRow<'agent_requests'>): AgentRequestRow => ({
  id: Number(r.id),
  at: date(r.at),
  surface: r.surface as AgentSurface,
  tool: r.tool,
  paper: r.paper,
  status: r.status,
  ms: r.ms,
  client: r.client,
  userAgent: r.user_agent,
  ipHash: r.ip_hash,
  ref: r.ref
})
