// In-memory stand-in for the service-role client (Daylight's makeStub(), generalized once). Covers the PostgREST and
// Storage surface the app uses; anything else should fail loudly rather than pass silently. Inject with
// `setSupabase(createFakeSupabase())`; `#supabase/server` itself resolves to a throwing stub in tests.
import { randomUUID } from 'node:crypto'
import type { Supa } from '../../server/utils/supabase'

type Row = Record<string, unknown>
type Filter = (r: Row) => boolean
interface Err { message: string, code?: string, statusCode?: string }

const now = () => new Date().toISOString()
const KEYS: Record<string, string[]> = {
  papers: ['id'], runs: ['id'], run_events: ['id'], stage_outputs: ['run_id', 'stage'], review_items: ['id'],
  sources: ['id'], source_assets: ['id'], blobs: ['sha'], agent_requests: ['id'], families: ['number'],
  manuscripts: ['dir'], catalog_meta: ['key']
}
const UNIQUE: Record<string, string[][]> = { papers: [['slug']] }
const DEFAULTS: Record<string, (seq: number) => Row> = {
  papers: () => ({ id: randomUUID(), authors: [], tier: null, digest: null, latest_run_id: null, public: false, manuscript_dir: null, created_at: now(), updated_at: now() }),
  runs: () => ({ id: randomUUID(), parent_run_id: null, status: 'queued', stage: null, progress: {}, metrics: null, cost_usd: 0, error: null, agent_token: null, started_at: now(), finished_at: null }),
  run_events: seq => ({ id: seq, ts: now(), data: null }),
  stage_outputs: () => ({ created_at: now() }),
  review_items: () => ({ id: randomUUID(), decision: null, decided_at: null }),
  sources: () => ({ id: randomUUID() }),
  source_assets: () => ({ id: randomUUID() }),
  blobs: () => ({ created_at: now() }),
  agent_requests: seq => ({ id: seq, at: now(), tool: null, paper: null, user_agent: null, ip_hash: null, ref: null }),
  families: () => ({ has_lean: false, reasoning_trace: null }),
  manuscripts: () => ({ has_lean: false, published_on: null })
}

/** paper_digest_stats (db_migrations/0004), computed in JS. */
function digestStats(p: Row): Row {
  const d = p.digest as { nodes?: { classification?: string, friction?: unknown[] }[], sections?: unknown[], render?: { pages?: number }, summary?: { headline?: string } } | null
  const nodes = d?.nodes
  return {
    id: p.id, slug: p.slug, title: p.title, authors: p.authors, source_ref: p.source_ref, public: p.public,
    manuscript_dir: p.manuscript_dir, created_at: p.created_at, updated_at: p.updated_at, has_digest: d != null,
    nodes: nodes ? nodes.length : null, sections: d?.sections ? d.sections.length : null,
    novel: nodes ? nodes.filter(n => n.classification === 'novel').length : null,
    friction: nodes ? nodes.reduce((s, n) => s + (n.friction?.length ?? 0), 0) : null,
    pages: d?.render?.pages ?? null, headline: d?.summary?.headline ?? null
  }
}

function project(row: Row, cols: string): Row {
  if (cols.trim() === '*') {
    return structuredClone(row)
  }
  const out: Row = {}
  for (const part of cols.split(',').map(s => s.trim()).filter(Boolean)) {
    const [alias, col] = part.includes(':') ? part.split(':') as [string, string] : [part, part]
    out[alias] = structuredClone(row[col] ?? null)
  }
  return out
}

export function createFakeSupabase(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([t, rows]) => [t, structuredClone(rows)]))
  const objects = new Map<string, { bytes: Uint8Array, contentType: string }>()
  let seq = 0
  const table = (t: string) => (tables[t] ??= [])
  const keyOf = (t: string, r: Row, cols = KEYS[t] ?? ['id']) => cols.map(c => String(r[c])).join('\u0000')
  const withDefaults = (t: string, r: Row) => ({ ...DEFAULTS[t]?.(++seq), ...structuredClone(r) })

  function conflict(t: string, r: Row, except?: Row): Err | null {
    for (const cols of [KEYS[t] ?? ['id'], ...(UNIQUE[t] ?? [])]) {
      if (table(t).some(x => x !== except && keyOf(t, x, cols) === keyOf(t, r, cols))) {
        return { message: `duplicate key value violates unique constraint "${t}_${cols.join('_')}"`, code: '23505' }
      }
    }
    return null
  }

  function from(t: string) {
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
    let payload: Row[] = []
    let patch: Row = {}
    let upsertOpts: { onConflict?: string, ignoreDuplicates?: boolean } = {}
    let cols: string | null = null
    let countMode = false
    let head = false
    let mode: 'many' | 'single' | 'maybe' = 'many'
    const filters: Filter[] = []
    const orders: [string, boolean][] = []
    let lim: number | null = null
    let rng: [number, number] | null = null

    function run(): { data: unknown, error: Err | null, count?: number | null } {
      const src = t === 'paper_digest_stats' ? table('papers').map(digestStats) : table(t)
      const match = (r: Row) => filters.every(f => f(r))
      let out: Row[] = []
      if (op === 'insert' || op === 'upsert') {
        const conflictCols = upsertOpts.onConflict?.split(',').map(s => s.trim()) ?? KEYS[t] ?? ['id']
        for (const raw of payload) {
          const existing = op === 'upsert' ? table(t).find(x => conflictCols.every(c => x[c] === raw[c])) : undefined
          if (existing) {
            if (!upsertOpts.ignoreDuplicates) {
              Object.assign(existing, structuredClone(raw))
              out.push(existing)
            }
            continue
          }
          const row = withDefaults(t, raw)
          const err = conflict(t, row)
          if (err) {
            return { data: null, error: err }
          }
          table(t).push(row)
          out.push(row)
        }
      } else if (op === 'update') {
        out = src.filter(match)
        for (const r of out) {
          const next = { ...r, ...structuredClone(patch) }
          const err = conflict(t, next, r)
          if (err) {
            return { data: null, error: err }
          }
          Object.assign(r, next)
        }
      } else if (op === 'delete') {
        out = src.filter(match)
        tables[t] = src.filter(r => !match(r))
      } else {
        out = src.filter(match)
      }
      if (op !== 'select' && cols == null) {
        return { data: null, error: null }
      }
      for (const [col, asc] of [...orders].reverse()) {
        out = [...out].sort((a, b) => (a[col] === b[col] ? 0 : (a[col] as never) < (b[col] as never) ? -1 : 1) * (asc ? 1 : -1))
      }
      const count = countMode ? out.length : null
      if (rng) {
        out = out.slice(rng[0], rng[1] + 1)
      }
      if (lim != null) {
        out = out.slice(0, lim)
      }
      const rows = out.map(r => project(r, cols ?? '*'))
      if (head) {
        return { data: null, error: null, count }
      }
      if (mode === 'many') {
        return { data: rows, error: null, count }
      }
      if (rows.length > 1 || (mode === 'single' && !rows.length)) {
        return { data: null, error: { message: `JSON object requested, multiple (or no) rows returned (${rows.length})`, code: 'PGRST116' } }
      }
      return { data: rows[0] ?? null, error: null }
    }

    const q = {
      select(c = '*', o: { count?: string, head?: boolean } = {}) {
        cols = c
        countMode = !!o.count
        head = !!o.head
        return q
      },
      insert(v: Row | Row[]) {
        op = 'insert'
        payload = Array.isArray(v) ? v : [v]
        return q
      },
      upsert(v: Row | Row[], o: { onConflict?: string, ignoreDuplicates?: boolean } = {}) {
        op = 'upsert'
        payload = Array.isArray(v) ? v : [v]
        upsertOpts = o
        return q
      },
      update(v: Row) {
        op = 'update'
        patch = v
        return q
      },
      delete() {
        op = 'delete'
        return q
      },
      eq: (c: string, v: unknown) => (filters.push(r => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push(r => r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filters.push(r => vs.includes(r[c])), q),
      is: (c: string, v: null | boolean) => (filters.push(r => (r[c] ?? null) === v), q),
      not: (c: string, o: string, v: unknown) => {
        if (o !== 'is') {
          throw new Error(`fakeSupabase: not(${o}) unsupported`)
        }
        return (filters.push(r => (r[c] ?? null) !== v), q)
      },
      gt: (c: string, v: never) => (filters.push(r => (r[c] as never) > v), q),
      gte: (c: string, v: never) => (filters.push(r => (r[c] as never) >= v), q),
      lt: (c: string, v: never) => (filters.push(r => (r[c] as never) < v), q),
      lte: (c: string, v: never) => (filters.push(r => (r[c] as never) <= v), q),
      order: (c: string, o: { ascending?: boolean } = {}) => (orders.push([c, o.ascending !== false]), q),
      limit: (n: number) => ((lim = n), q),
      range: (a: number, b: number) => ((rng = [a, b]), q),
      single: () => ((mode = 'single'), q),
      maybeSingle: () => ((mode = 'maybe'), q),
      then: <A, B>(ok?: (v: ReturnType<typeof run>) => A, bad?: (e: unknown) => B) => Promise.resolve().then(run).then(ok, bad)
    }
    return q
  }

  const runById = (id: unknown) => table('runs').find(r => r.id === id)
  const rpcs: Record<string, (a: Row) => unknown> = {
    add_run_cost: (a) => {
      const r = runById(a.p_run_id)
      if (r) r.cost_usd = Number(r.cost_usd) + Number(a.p_usd)
      return null
    },
    patch_run_progress: (a) => {
      const r = runById(a.p_run_id)
      if (r) r.progress = { ...(r.progress as Row), ...structuredClone(a.p_patch as Row) }
      return null
    },
    bump_run_progress: (a) => {
      const r = runById(a.p_run_id)
      const p = (r?.progress ?? {}) as Row
      if (r) r.progress = { ...p, [a.p_key as string]: Number(p[a.p_key as string] ?? 0) + Number(a.p_by ?? 1) }
      return null
    },
    claim_agent_trace: (a) => {
      const r = runById(a.p_run_id)
      if (!r) return []
      const p = r.progress as Row
      const prev = { seq: Number(p.agent_trace_seq ?? 0), cost: Number(p.agent_cost_usd ?? 0) }
      r.progress = { ...p, agent_trace_seq: Math.max(prev.seq, Number(a.p_max_seq)), agent_cost_usd: Math.max(prev.cost, Number(a.p_max_cost)) }
      return [prev]
    },
    applied_migration_count: () => 4
  }

  const url = (bucket: string, path: string) => `https://fake-supabase.test/${bucket}/${path}`
  const storage = {
    from: (bucket: string) => ({
      async upload(path: string, body: Uint8Array | ArrayBuffer, o: { contentType?: string, upsert?: boolean } = {}) {
        const k = `${bucket}/${path}`
        if (objects.has(k) && !o.upsert) {
          return { data: null, error: { message: 'The resource already exists', statusCode: '409' } }
        }
        objects.set(k, { bytes: new Uint8Array(body instanceof ArrayBuffer ? body : body.slice()), contentType: o.contentType ?? 'application/octet-stream' })
        return { data: { path }, error: null }
      },
      async download(path: string) {
        const o = objects.get(`${bucket}/${path}`)
        return o ? { data: new Blob([o.bytes as BlobPart], { type: o.contentType }), error: null } : { data: null, error: { message: 'Object not found', statusCode: '404' } }
      },
      async info(path: string) {
        const o = objects.get(`${bucket}/${path}`)
        return o ? { data: { name: path, size: o.bytes.byteLength, contentType: o.contentType }, error: null } : { data: null, error: { message: 'Object not found', statusCode: '404' } }
      },
      async createSignedUrl(path: string, _ttl: number) {
        return objects.has(`${bucket}/${path}`) ? { data: { signedUrl: url(bucket, path) }, error: null } : { data: null, error: { message: 'Object not found', statusCode: '404' } }
      }
    })
  }

  /** A fetch that serves signed URLs (honouring `Range: bytes=a-b`) and defers everything else to `fallback`. */
  function fetchStub(fallback: typeof fetch = globalThis.fetch): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!href.startsWith('https://fake-supabase.test/')) {
        return fallback(input, init)
      }
      const o = objects.get(href.slice('https://fake-supabase.test/'.length))
      if (!o) {
        return new Response('not found', { status: 404 })
      }
      const range = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d*)$/)
      if (!range) {
        return new Response(o.bytes as BodyInit, { status: 200, headers: { 'content-type': o.contentType } })
      }
      const start = Number(range[1])
      const end = range[2] ? Math.min(Number(range[2]), o.bytes.byteLength - 1) : o.bytes.byteLength - 1
      return new Response(o.bytes.slice(start, end + 1) as BodyInit, { status: 206, headers: { 'content-type': o.contentType, 'content-range': `bytes ${start}-${end}/${o.bytes.byteLength}` } })
    }) as typeof fetch
  }

  const client = {
    from,
    rpc: async (name: string, args: Row = {}) => {
      const fn = rpcs[name]
      return fn ? { data: fn(args), error: null } : { data: null, error: { message: `fakeSupabase: no rpc ${name}`, code: 'PGRST202' } }
    },
    storage
  }
  return { client: client as unknown as Supa, tables, objects, rpcs, fetchStub }
}
