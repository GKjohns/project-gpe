// Contract: docs/20261029_digest_v1/implementation_plan.md § DB schema. Change the plan first.
import { sql } from 'drizzle-orm'
import { bigserial, customType, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow()
})

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

export type PaperRow = typeof papers.$inferSelect
export type RunRow = typeof runs.$inferSelect
export type RunEventRow = typeof runEvents.$inferSelect
export type ReviewItemRow = typeof reviewItems.$inferSelect
