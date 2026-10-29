import { describe, expect, it } from 'vitest'
import type { Skeleton } from '#shared/pipeline'
import { RUN_STAGES } from '#shared/pipeline'
import type { ProofNode } from '#shared/types'
import { toyDigest } from '../server/fixtures/toy-digest'
import { rootIds } from '../server/pipeline/dag'
import { buildDigest, computeMetrics, flagFriction } from '../server/pipeline/stages/finalize'
import type { MetricEvent } from '../server/pipeline/stages/finalize'

const toy = () => structuredClone(toyDigest.nodes)

describe('rootIds', () => {
  it('finds the toy roots, main theorem first', () => {
    expect(rootIds(toy(), toyDigest.sections)).toEqual(['thm-main', 'thm-lower'])
  })

  it('a theorem used only by a corollary is still a root', () => {
    const nodes: ProofNode[] = [...toy(), { ...toy()[0]!, id: 'cor-x', kind: 'corollary', deps_paper: ['thm-main'], deps_inferred: [] }]
    expect(rootIds(nodes, toyDigest.sections)[0]).toBe('thm-main')
  })

  it('a use inside a corollary\'s proof (by its claim) keeps the theorem a root', () => {
    const base = toy()
    const cor: ProofNode = { ...base[0]!, id: 'cor-x', kind: 'corollary', deps_paper: [], deps_inferred: [] }
    const claim: ProofNode = { ...base[0]!, id: 'claim-cor-x-1', kind: 'claim', parent_id: 'cor-x', deps_paper: ['thm-main'], deps_inferred: [] }
    expect(rootIds([...base, cor, claim], toyDigest.sections)[0]).toBe('thm-main')
  })

  it('a theorem another theorem builds on is not a root', () => {
    const nodes = toy()
    nodes.find(n => n.id === 'thm-lower')!.deps_paper.push('thm-main')
    expect(rootIds(nodes, toyDigest.sections)).toEqual(['thm-lower'])
  })

  it('without a "main" label, the first theorem in section order leads', () => {
    const nodes = toy().map(n => n.id === 'thm-main' ? { ...n, id: 'thm-upper', paper_ref: { ...n.paper_ref, label: 'thm:upper', section: '3', line: 200 } } : n)
    const lower = nodes.find(n => n.id === 'thm-lower')!
    lower.paper_ref = { ...lower.paper_ref, section: '3', line: 150 }
    expect(rootIds(nodes, toyDigest.sections)).toEqual(['thm-lower', 'thm-upper'])
  })

  it('falls back to unused statements when there are no theorems', () => {
    const nodes = toy().filter(n => n.kind !== 'theorem')
    expect(rootIds(nodes, toyDigest.sections)).toEqual(['lem-restrict', 'lem-hash', 'lem-univariate'])
  })
})

describe('computeMetrics', () => {
  const t0 = new Date('2026-10-29T12:00:00Z')
  const at = (s: number) => new Date(t0.getTime() + s * 1000)
  const events: MetricEvent[] = [
    { stage: 'outline', message: 'outline finished', data: { ms: 1000 }, ts: at(1) },
    { stage: 'outline', message: 'model call anthropic/claude-opus-5.5', data: { cost_usd: 0.5, tokens_in: 100, tokens_out: 10, tokens_cached: 0 }, ts: at(1) },
    { stage: 'critique', message: 'critique finished', data: { ms: 2000 }, ts: at(3) },
    { stage: 'critique', message: 'critique:review finished', data: { ms: 500 }, ts: at(4) },
    { stage: 'annotate', message: 'model call anthropic/claude-sonnet-5.5', data: { cost_usd: 0.01, tokens_in: 50, tokens_out: 5, tokens_cached: 20 }, ts: at(5) },
    { stage: 'annotate', message: 'model call anthropic/claude-sonnet-5.5', data: { cost_usd: 0.02, tokens_in: 50, tokens_out: 5, tokens_cached: 0 }, ts: at(5) },
    { stage: 'finalize', message: 'finalize started', data: null, ts: at(9) }
  ]
  const m = computeMetrics({
    progress: { statements_in_source: 7, statements_extracted: 7, claims: 1, refs_mechanical: 9, claim_refs: 1, refs_inferred: 2, schema_retries: 0, critique_findings: 3, calls: 3 },
    events,
    startedAt: t0,
    now: at(10),
    costUsd: 0.53,
    reviewItems: 1
  })

  it('has every RunMetrics field', () => {
    expect(Object.keys(m).sort()).toEqual([
      'calls', 'claims', 'cost_usd', 'critique_findings', 'per_stage', 'refs_inferred', 'refs_mechanical', 'review_items',
      'schema_retries', 'statements_extracted', 'statements_in_source', 'tokens_cached', 'tokens_in', 'tokens_out', 'wallclock_ms'
    ])
    expect(Object.keys(m.per_stage).every(s => RUN_STAGES.includes(s as never))).toBe(true)
  })

  it('sums per-stage time, cost and calls', () => {
    expect(m.per_stage.outline).toEqual({ ms: 1000, cost_usd: 0.5, calls: 1 })
    expect(m.per_stage.critique).toEqual({ ms: 2500, cost_usd: 0, calls: 0 })
    expect(m.per_stage.annotate).toEqual({ ms: 0, cost_usd: 0.03, calls: 2 })
    expect(m.per_stage.finalize!.ms).toBe(1000)
    expect(m.wallclock_ms).toBe(10_000)
    expect(m.refs_mechanical).toBe(10)
    expect([m.tokens_in, m.tokens_out, m.tokens_cached]).toEqual([200, 20, 20])
    expect(m.review_items).toBe(1)
  })
})

describe('buildDigest', () => {
  it('assembles a PaperDigest with roots and macros', () => {
    const skeleton = { sections: toyDigest.sections, macros: { '\\F': '\\mathbb{F}' } } as unknown as Skeleton
    const d = buildDigest({
      paper: { slug: 'toy', title: 'Toy', authors: [], sourceKind: 'upload', sourceRef: 'toy.tex' },
      skeleton,
      nodes: toy(),
      runId: 'r1',
      generatedAt: '2026-10-29T00:00:00Z',
      metrics: toyDigest.metrics
    })
    expect(d.root_ids[0]).toBe('thm-main')
    expect(d.macros['\\F']).toBe('\\mathbb{F}')
    expect(d.authors).toBeUndefined()
    expect(d.nodes).toHaveLength(8)
  })

  it('turns outline flags into friction on the named node', () => {
    const nodes = toy()
    const skeleton = { statements: [{ label: 'lem:hash' }] } as unknown as Skeleton
    const added = flagFriction(nodes, { method: 'pipeline', claims: [], flags: [{ kind: 'ref_to_nonstatement', label: 'lem:hash', note: 'cites eq. (3)' }], stats: { calls: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0, wallclock_ms: 0 } }, skeleton)
    expect(added).toBe(1)
    expect(nodes.find(n => n.id === 'lem-hash')!.friction.at(-1)).toMatchObject({ kind: 'unresolved_ref', severity: 'warn' })
  })
})
