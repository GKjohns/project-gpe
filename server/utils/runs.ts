import type { Profile, RunStage, RunStatus, StructureMethod } from '#shared/types'
import type { RunProgress } from '#shared/pipeline'
import type { Json } from '#supabase/database'
import { must, useSupabase } from './supabase'
import { reviewItemRow, runEventRow, runRow } from './rows'
import type { RunEventRow, RunRow, ReviewItemRow } from './rows'

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
  const row = must(await useSupabase().from('runs').insert({
    paper_id: input.paperId,
    profile: input.profile,
    structure_method: input.method,
    budget_usd: input.budgetUsd,
    parent_run_id: input.parentRunId ?? null
  }).select('id').single())
  return row.id
}

export async function getRun(runId: string): Promise<RunRow | undefined> {
  const row = must(await useSupabase().from('runs').select('*').eq('id', runId).maybeSingle())
  return row ? runRow(row) : undefined
}

export async function appendEvent(runId: string, stage: EventStage, level: EventLevel, message: string, data?: Record<string, unknown>) {
  must(await useSupabase().from('run_events').insert({ run_id: runId, stage, level, message, data: (data ?? null) as Json }))
}

/** Many events in one request (outline-agent's trace lines). */
export async function appendEvents(runId: string, events: { stage: EventStage, level: EventLevel, message: string, data?: Record<string, unknown> }[]) {
  if (!events.length) {
    return
  }
  must(await useSupabase().from('run_events').insert(events.map(e => ({ run_id: runId, stage: e.stage, level: e.level, message: e.message, data: (e.data ?? null) as Json }))))
}

export async function setStage(runId: string, stage: RunStage) {
  must(await useSupabase().from('runs').update({ stage }).eq('id', runId))
}

const TERMINAL: RunStatus[] = ['failed', 'cancelled', 'complete', 'structure_partial']

export async function setStatus(runId: string, status: RunStatus, error?: string) {
  must(await useSupabase().from('runs').update({
    status,
    ...(error !== undefined ? { error } : {}),
    ...(TERMINAL.includes(status) ? { finished_at: new Date().toISOString() } : {})
  }).eq('id', runId))
}

// RPC (db_migrations/0003) so parallel fan-out steps cannot lose increments.
export async function addCost(runId: string, usd: number) {
  if (!usd) {
    return
  }
  must(await useSupabase().rpc('add_run_cost', { p_run_id: runId, p_usd: usd }))
}

/** Shallow-merges into runs.progress (jsonb || in an RPC), so concurrent writers of different keys don't clobber each other. */
export async function patchProgress(runId: string, patch: RunProgress) {
  must(await useSupabase().rpc('patch_run_progress', { p_run_id: runId, p_patch: patch as Json }))
}

/** Atomically adds to a numeric counter in runs.progress. */
export async function bumpProgress(runId: string, key: string, by = 1) {
  must(await useSupabase().rpc('bump_run_progress', { p_run_id: runId, p_key: key, p_by: by }))
}

export async function getRunView(runId: string): Promise<RunView | null> {
  const run = await getRun(runId)
  if (!run) {
    return null
  }
  const supa = useSupabase()
  const latest = must(await supa.from('run_events').select('*').eq('run_id', runId).order('id', { ascending: false }).limit(200))
  const pending = must(await supa.from('review_items').select('*').eq('run_id', runId).is('decision', null).order('id'))
  return { run, events: latest.map(runEventRow).reverse(), reviewItems: pending.map(reviewItemRow) }
}
