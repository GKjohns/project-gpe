// The one Supabase client every server read and write goes through (contract:
// docs/20261101_supabase_native/implementation_plan.md § Contracts). Service role: RLS is on for every table with no
// policies, so only this key reads or writes; visibility (papers.public, the operator cookie) stays in app code.
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '#supabase/database'

export type Supa = ReturnType<typeof serverSupabaseServiceRole<Database>>
type ModuleEvent = Parameters<typeof serverSupabaseServiceRole>[0]

/** Private Storage bucket holding blob bytes; object key = sha256 hex (db_migrations/0002). */
export const BLOB_BUCKET = 'blobs'

/** PostgREST's row cap per request (the project's default `max_rows`). */
const PAGE = 1000

let client: Supa | null = null

/**
 * Process-wide service-role client. Inngest steps, the LocalRunner and Nitro plugins have no H3 event, so the module
 * gets a stub one: serverSupabaseServiceRole uses the event only for useRuntimeConfig(event) (which reads and fills
 * `event.context.nitro`) and to cache the client on `event.context` (@nuxtjs/supabase 2.1.x,
 * dist/runtime/server/services/serverSupabaseServiceRole.js; re-check on a module upgrade). The service-role client
 * carries no cookies or user, so one instance is safe to share across requests.
 */
export function useSupabase(): Supa {
  if (!client) {
    client = serverSupabaseServiceRole<Database>({ context: { nitro: {} } } as unknown as ModuleEvent)
  }
  return client
}

/** Test seam (tests/helpers/fakeSupabase.ts): swap in a fake; `null` goes back to the real client. */
export function setSupabase(next: Supa | null) {
  client = next
}

interface SupaError { message: string, code?: string, details?: string | null, hint?: string | null }
type OkData<R extends { data: unknown }> = [Extract<R, { error: null }>] extends [never] ? R['data'] : Extract<R, { error: null }>['data']

/** Unwraps a `{ data, error }` result; an error throws with PostgREST's message and code up front (short, loggable). */
export function must<R extends { data: unknown, error: SupaError | null }>(res: R): OkData<R> {
  const { error } = res
  if (error) {
    const extra = [error.details, error.hint].filter(Boolean).join(' · ')
    const err = new Error(`${error.message}${error.code ? ` (${error.code})` : ''}${extra ? `: ${extra}` : ''}`)
    Object.assign(err, { code: error.code })
    throw err
  }
  return res.data as OkData<R>
}

/**
 * Every row of a select past PostgREST's 1000-row cap: `build(from, to)` returns the query with `.range(from, to)`
 * applied, and must order by a unique key so pages don't overlap.
 */
export async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null, error: SupaError | null }>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const page = must(await build(from, from + PAGE - 1)) ?? []
    rows.push(...page)
    if (page.length < PAGE) {
      return rows
    }
  }
}
