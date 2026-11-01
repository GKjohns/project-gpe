import { afterEach, describe, expect, it } from 'vitest'
import { must, selectAll, setSupabase, useSupabase } from '../server/utils/supabase'
import { paperRow, runRow } from '../server/utils/rows'
import { createFakeSupabase } from './helpers/fakeSupabase'

afterEach(() => setSupabase(null))

describe('supabase utils', () => {
  it('never builds the real client in tests', () => {
    expect(() => useSupabase()).toThrow(/setSupabase/)
  })

  it('must unwraps data and throws PostgREST errors with message and code first', () => {
    expect(must({ data: [1], error: null })).toEqual([1])
    expect(() => must({ data: null, error: { message: 'duplicate key', code: '23505' } })).toThrow('duplicate key (23505)')
  })

  it('selectAll pages past 1000 rows', async () => {
    const fake = createFakeSupabase({ families: Array.from({ length: 2345 }, (_, i) => ({ number: i, title: `f${i}` })) })
    setSupabase(fake.client)
    const rows = await selectAll(
      (from, to) => useSupabase().from('families').select('number').order('number').range(from, to)
    )
    expect(rows).toHaveLength(2345)
    expect(rows.at(-1)).toEqual({ number: 2344 })
  })
})

describe('fakeSupabase', () => {
  it('applies defaults, maps rows, enforces unique slug and runs the run RPCs', async () => {
    const { client: sb } = createFakeSupabase()
    const paper = must(await sb.from('papers').insert({ slug: 'p', title: 'P', source_kind: 'upload', source_ref: 'x' }).select().single())
    expect(paperRow(paper)).toMatchObject({ slug: 'p', authors: [], public: false, createdAt: expect.any(Date) })
    const dup = await sb.from('papers').insert({ slug: 'p', title: 'Q', source_kind: 'upload', source_ref: 'y' })
    expect(dup.error?.code).toBe('23505')

    const run = must(await sb.from('runs').insert({ paper_id: paper.id, profile: 'quick', structure_method: 'pipeline', budget_usd: 5 }).select('id').single())
    must(await sb.rpc('add_run_cost', { p_run_id: run.id, p_usd: 0.25 }))
    must(await sb.rpc('add_run_cost', { p_run_id: run.id, p_usd: 0.5 }))
    must(await sb.rpc('patch_run_progress', { p_run_id: run.id, p_patch: { a: 1 } }))
    must(await sb.rpc('patch_run_progress', { p_run_id: run.id, p_patch: { b: 2 } }))
    must(await sb.rpc('bump_run_progress', { p_run_id: run.id, p_key: 'n', p_by: 2 }))
    const first = must(await sb.rpc('claim_agent_trace', { p_run_id: run.id, p_max_seq: 5, p_max_cost: 0.4 }))
    const second = must(await sb.rpc('claim_agent_trace', { p_run_id: run.id, p_max_seq: 3, p_max_cost: 0.9 }))
    expect(first).toEqual([{ seq: 0, cost: 0 }])
    expect(second).toEqual([{ seq: 5, cost: 0.4 }])
    const back = runRow(must(await sb.from('runs').select('*').eq('id', run.id).single()))
    expect(back.costUsd).toBe(0.75)
    expect(back.progress).toEqual({ a: 1, b: 2, n: 2, agent_trace_seq: 5, agent_cost_usd: 0.9 })

    const { count } = await sb.from('runs').select('id', { count: 'exact', head: true }).eq('paper_id', paper.id)
    expect(count).toBe(1)
  })

  it('computes paper_digest_stats and serves Storage objects with Range', async () => {
    const fake = createFakeSupabase({
      papers: [{ id: 'a', slug: 'a', title: 'A', authors: [], source_ref: 'x', public: true, manuscript_dir: null, digest: { nodes: [{ classification: 'novel', friction: [1, 2] }, { classification: 'standard', friction: [] }], sections: [1], render: { pages: 7 }, summary: { headline: 'H' } } }]
    })
    const sb = fake.client
    const stats = must(await sb.from('paper_digest_stats').select('slug, nodes, sections, novel, friction, pages, headline').eq('has_digest', true))
    expect(stats).toEqual([{ slug: 'a', nodes: 2, sections: 1, novel: 1, friction: 2, pages: 7, headline: 'H' }])

    const bytes = new Uint8Array(Array.from({ length: 100 }, (_, i) => i))
    must(await sb.storage.from('blobs').upload('sha1', bytes, { contentType: 'application/pdf' }))
    expect((await sb.storage.from('blobs').upload('sha1', bytes)).error?.message).toMatch(/exists/)
    const { signedUrl } = must(await sb.storage.from('blobs').createSignedUrl('sha1', 60))
    const res = await fake.fetchStub()(signedUrl, { headers: { Range: 'bytes=10-19' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 10-19/100')
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })
})
