import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Profile, RunStage, RunStatus, StructureMethod } from '#shared/types'
import type { RunProgress } from '#shared/pipeline'
import { useDb } from '../db'
import { reviewItems, runEvents, runs } from '../db/schema'
import type { RunEventRow, RunRow, ReviewItemRow } from '../db/schema'

export type EventLevel = 'info' | 'warn' | 'error'
export type EventStage = RunStage | 'run'

export interface RunView {
  run: RunRow
  events: RunEventRow[]
  reviewItems: ReviewItemRow[]
}

export async function createRun(input: {
  paperId: string
  profile: Profile
  method: StructureMethod
  budgetUsd: number
  parentRunId?: string
}): Promise<string> {
  const db = await useDb()
  const [row] = await db.insert(runs).values({
    paperId: input.paperId,
    profile: input.profile,
    structureMethod: input.method,
    budgetUsd: input.budgetUsd,
    parentRunId: input.parentRunId ?? null
  }).returning({ id: runs.id })
  return row!.id
}

export async function getRun(runId: string): Promise<RunRow | undefined> {
  const db = await useDb()
  const [row] = await db.select().from(runs).where(eq(runs.id, runId))
  return row
}

export async function appendEvent(runId: string, stage: EventStage, level: EventLevel, message: string, data?: Record<string, unknown>) {
  const db = await useDb()
  await db.insert(runEvents).values({ runId, stage, level, message, data: data ?? null })
}

export async function setStage(runId: string, stage: RunStage) {
  const db = await useDb()
  await db.update(runs).set({ stage }).where(eq(runs.id, runId))
}

const TERMINAL: RunStatus[] = ['failed', 'cancelled', 'complete', 'structure_partial']

export async function setStatus(runId: string, status: RunStatus, error?: string) {
  const db = await useDb()
  await db.update(runs).set({
    status,
    ...(error !== undefined ? { error } : {}),
    ...(TERMINAL.includes(status) ? { finishedAt: new Date() } : {})
  }).where(eq(runs.id, runId))
}

// Atomic in SQL so parallel fan-out steps cannot lose increments.
export async function addCost(runId: string, usd: number) {
  if (!usd) {
    return
  }
  const db = await useDb()
  await db.update(runs).set({ costUsd: sql`${runs.costUsd} + ${usd}` }).where(eq(runs.id, runId))
}

/** Shallow-merges into runs.progress (jsonb ||), so concurrent writers of different keys don't clobber each other. */
export async function patchProgress(runId: string, patch: RunProgress) {
  const db = await useDb()
  await db.update(runs).set({ progress: sql`${runs.progress} || ${JSON.stringify(patch)}::jsonb` }).where(eq(runs.id, runId))
}

/** Atomically adds to a numeric counter in runs.progress. */
export async function bumpProgress(runId: string, key: string, by = 1) {
  const db = await useDb()
  await db.update(runs).set({
    progress: sql`jsonb_set(${runs.progress}, ${`{${key}}`}::text[], to_jsonb(coalesce((${runs.progress}->>${key})::numeric, 0) + ${by}))`
  }).where(eq(runs.id, runId))
}

export async function getRunView(runId: string): Promise<RunView | null> {
  const db = await useDb()
  const run = await getRun(runId)
  if (!run) {
    return null
  }
  const latest = await db.select().from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(desc(runEvents.id))
    .limit(200)
  const pending = await db.select().from(reviewItems)
    .where(and(eq(reviewItems.runId, runId), isNull(reviewItems.decision)))
    .orderBy(asc(reviewItems.id))
  return { run, events: latest.reverse(), reviewItems: pending }
}
