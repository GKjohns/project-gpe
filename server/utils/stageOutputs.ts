// Stage outputs are what "retry from stage" reuses; no memoization lives in the runner.
import type { RunStage } from '#shared/types'
import { RUN_STAGES } from '#shared/pipeline'
import type { Json } from '#supabase/database'
import { must, useSupabase } from './supabase'

async function get<T>(runId: string, stage: RunStage): Promise<T | null> {
  const row = must(await useSupabase().from('stage_outputs').select('payload').eq('run_id', runId).eq('stage', stage).maybeSingle())
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
  must(await useSupabase().from('stage_outputs')
    .upsert({ run_id: runId, stage, payload: jsonbSafe(payload) as Json, created_at: new Date().toISOString() }, { onConflict: 'run_id,stage' }))
}

/** Copies the parent's outputs for every stage strictly before `beforeStage`. Returns the stages copied. */
async function copyForward(parentRunId: string, runId: string, beforeStage: RunStage): Promise<RunStage[]> {
  const stages = RUN_STAGES.slice(0, RUN_STAGES.indexOf(beforeStage))
  if (!stages.length) {
    return []
  }
  const supa = useSupabase()
  const rows = must(await supa.from('stage_outputs').select('stage, payload').eq('run_id', parentRunId).in('stage', [...stages]))
  if (rows.length) {
    must(await supa.from('stage_outputs')
      .upsert(rows.map(r => ({ run_id: runId, stage: r.stage, payload: r.payload })), { onConflict: 'run_id,stage', ignoreDuplicates: true }))
  }
  return rows.map(r => r.stage as RunStage)
}

// A namespace object so Nitro's auto-import doesn't put bare `get` / `put` in global scope.
export const stageOutputs = { get, put, copyForward }
