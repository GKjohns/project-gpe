// Stage outputs are what "retry from stage" reuses; no memoization lives in the runner.
import { and, eq, inArray } from 'drizzle-orm'
import type { RunStage } from '#shared/types'
import { RUN_STAGES } from '#shared/pipeline'
import { useDb } from '../db'
import { stageOutputs as table } from '../db/schema'

async function get<T>(runId: string, stage: RunStage): Promise<T | null> {
  const db = await useDb()
  const [row] = await db.select({ payload: table.payload }).from(table)
    .where(and(eq(table.runId, runId), eq(table.stage, stage)))
  return (row?.payload as T | undefined) ?? null
}

/**
 * Postgres jsonb rejects \u0000 and unpaired surrogates, both of which model text can carry; strip them from every
 * string so one odd character can't fail a 100-call stage at its final write (suspected cause of the Sprint 8
 * sunflower-alwz agent failure at classify).
 */
export function jsonbSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) => typeof v === 'string'
    // eslint-disable-next-line no-control-regex
    ? v.replace(/\u0000/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
    : v)) as T
}

async function put(runId: string, stage: RunStage, payload: unknown) {
  payload = jsonbSafe(payload)
  const db = await useDb()
  await db.insert(table).values({ runId, stage, payload })
    .onConflictDoUpdate({ target: [table.runId, table.stage], set: { payload, createdAt: new Date() } })
}

/** Copies the parent's outputs for every stage strictly before `beforeStage`. Returns the stages copied. */
async function copyForward(parentRunId: string, runId: string, beforeStage: RunStage): Promise<RunStage[]> {
  const stages = RUN_STAGES.slice(0, RUN_STAGES.indexOf(beforeStage))
  if (!stages.length) {
    return []
  }
  const db = await useDb()
  const rows = await db.select().from(table)
    .where(and(eq(table.runId, parentRunId), inArray(table.stage, [...stages])))
  if (rows.length) {
    await db.insert(table).values(rows.map(r => ({ runId, stage: r.stage, payload: r.payload })))
      .onConflictDoNothing()
  }
  return rows.map(r => r.stage)
}

// A namespace object so Nitro's auto-import doesn't put bare `get` / `put` in global scope.
export const stageOutputs = { get, put, copyForward }
