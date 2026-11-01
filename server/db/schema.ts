// Contract: docs/20261029_digest_v1/implementation_plan.md § DB schema; the catalog tables (families, manuscripts,
// catalog_meta, papers.manuscript_dir) are docs/20261101_openai_explorer/implementation_plan.md § Data model.
// Change the plan first.
import { sql } from 'drizzle-orm'
import { bigserial, boolean, customType, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { PaperDigest, Profile, RunMetrics, RunStage, RunStatus, StructureMethod } from '#shared/types'
import type { RunProgress } from '#shared/pipeline'
import type { ReviewItemPayload } from '#shared/runs'

const tstz = (name: string) => timestamp(name, { withTimezone: true })

export const papers = pgTable('papers', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  authors: text('authors').array().notNull().default(sql`'{}'::text[]`),
  sourceKind: text('source_kind').$type<PaperDigest['source']['kind']>().notNull(),
  sourceRef: text('source_ref').notNull(),
  tier: text('tier'),
  digest: jsonb('digest').$type<PaperDigest>(),
  latestRunId: uuid('latest_run_id'),
  // Listed and queryable on the public agent API (/llms.txt, /api/v1, /api/mcp). Flip with `npm run paper:public`.
  public: boolean('public').notNull().default(false),
  // openai/math manuscript this paper digests. Soft link (no FK) so catalog sync and data import can run in any order;
  // set from source_ref by the sync.
  manuscriptDir: text('manuscript_dir'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow()
}, t => [index('papers_manuscript_idx').on(t.manuscriptDir)])

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  paperId: uuid('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  content: text('content').notNull(),
  bytes: integer('bytes').notNull()
})

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  paperId: uuid('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  parentRunId: uuid('parent_run_id'),
  status: text('status').$type<RunStatus>().notNull().default('queued'),
  stage: text('stage').$type<RunStage>(),
  profile: text('profile').$type<Profile>().notNull(),
  structureMethod: text('structure_method').$type<StructureMethod>().notNull(),
  progress: jsonb('progress').$type<RunProgress>().notNull().default({}),
  metrics: jsonb('metrics').$type<RunMetrics>(),
  budgetUsd: numeric('budget_usd', { mode: 'number' }).notNull(),
  costUsd: numeric('cost_usd', { mode: 'number' }).notNull().default(0),
  error: text('error'),
  agentToken: text('agent_token'),
  // Set at insert; the runner overwrites it when a queued run actually starts.
  startedAt: tstz('started_at').notNull().defaultNow(),
  finishedAt: tstz('finished_at')
})

export const runEvents = pgTable('run_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  ts: tstz('ts').notNull().defaultNow(),
  // A RunStage, or 'run' for lifecycle events outside any stage.
  stage: text('stage').notNull(),
  level: text('level').$type<'info' | 'warn' | 'error'>().notNull(),
  message: text('message').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>()
})

export const stageOutputs = pgTable('stage_outputs', {
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  stage: text('stage').$type<RunStage>().notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow()
}, t => [primaryKey({ columns: [t.runId, t.stage] })])

export const reviewItems = pgTable('review_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  payload: jsonb('payload').$type<ReviewItemPayload>().notNull(),
  decision: text('decision').$type<'accept' | 'reject'>(),
  decidedAt: tstz('decided_at')
})

// --- Binary storage (Oct 29, paper reader) ---

/** bytea: PGlite hands back a Uint8Array, postgres.js a Buffer (also a Uint8Array). */
const bytea = customType<{ data: Uint8Array, driverData: Uint8Array }>({ dataType: () => 'bytea' })

/**
 * Content-addressed bytes (sha256 hex): rendered PDFs, SyncTeX files, figure PNGs, a paper's binary source assets.
 * Immutable, so retries and re-renders dedupe for free and URLs (/api/blobs/<sha>) cache forever.
 */
export const blobs = pgTable('blobs', {
  sha: text('sha').primaryKey(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  data: bytea('data').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow()
})

/** Files a paper needs to compile but the pipeline never reads as text (figures' images, .bst, data tables). */
export const sourceAssets = pgTable('source_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  paperId: uuid('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  blobSha: text('blob_sha').notNull().references(() => blobs.sha),
  bytes: integer('bytes').notNull()
}, t => [index('source_assets_paper_idx').on(t.paperId)])

// --- Agent API request log (Oct 29) ---

export type AgentSurface = 'llms' | 'v1' | 'mcp'

/** One row per agent API request (one per tools/call over MCP). Written fire-and-forget; read by `npm run agent:stats`. */
export const agentRequests = pgTable('agent_requests', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: tstz('at').notNull().defaultNow(),
  surface: text('surface').$type<AgentSurface>().notNull(),
  tool: text('tool'),
  paper: text('paper'),
  status: integer('status').notNull(),
  ms: integer('ms').notNull(),
  // A family from the user-agent (Claude-User, curl, …), or the MCP client's own name/version when it sends one.
  client: text('client').notNull(),
  userAgent: text('user_agent'),
  // sha256 of ip + AGENT_LOG_SALT; the raw IP is never stored.
  ipHash: text('ip_hash'),
  // The ?ref= query param, for attributing links (?ref=blog).
  ref: text('ref')
}, t => [index('agent_requests_at_idx').on(t.at)])

// --- openai/math catalog (Nov 1): built from the repo index by server/catalog/sync.ts, zero model calls ---

/** A result family: CONTENTS.md's bold entry. `number` 49 displays as '049'. */
export const families = pgTable('families', {
  number: integer('number').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  discipline: text('discipline').notNull(),
  disciplineSlug: text('discipline_slug').notNull(),
  position: integer('position').notNull(),
  memberCount: integer('member_count').notNull(),
  hasLean: boolean('has_lean').notNull().default(false),
  reasoningTrace: text('reasoning_trace') // 'reasoning_traces/<file>.pdf'
}, t => [index('families_discipline_idx').on(t.disciplineSlug)])

/** One manuscript under preprints/<dir>/. */
export const manuscripts = pgTable('manuscripts', {
  dir: text('dir').primaryKey(),
  familyNumber: integer('family_number').notNull().references(() => families.number),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  abstract: text('abstract').notNull(),
  pdfFile: text('pdf_file').notNull(),
  publishedOn: date('published_on'), // from the dir's '-October-25-2026' suffix
  hasLean: boolean('has_lean').notNull().default(false)
}, t => [index('manuscripts_family_idx').on(t.familyNumber)])

export const catalogMeta = pgTable('catalog_meta', {
  key: text('key').primaryKey(), // 'openai-math'
  value: jsonb('value').$type<{ sha: string, syncedAt: string, counts: Record<string, number> }>().notNull()
})

export type PaperRow = typeof papers.$inferSelect
export type FamilyRow = typeof families.$inferSelect
export type ManuscriptRow = typeof manuscripts.$inferSelect
export type RunRow = typeof runs.$inferSelect
export type RunEventRow = typeof runEvents.$inferSelect
export type ReviewItemRow = typeof reviewItems.$inferSelect
