import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Outline, Skeleton } from '#shared/pipeline'
import type { ProofNode } from '#shared/types'
import { createDb, setDb } from '../server/db'
import { papers, sources } from '../server/db/schema'
import { chunkLatex } from '../server/pipeline/latex/chunk'
import { callObject } from '../server/pipeline/llm'
import { statementIds } from '../server/pipeline/nodes'
import type { RunContext } from '../server/pipeline/runner'
import { extractStage, statementNodes } from '../server/pipeline/stages/extract'
import type { ExtractOutput } from '../server/pipeline/stages/extract'
import { normalizeOutline, outlineStage } from '../server/pipeline/stages/outline'
import { depGraph, mentionsUnreffed, resolveStage } from '../server/pipeline/stages/resolve'
import type { ResolveOutput } from '../server/pipeline/stages/resolve'
import { createRun, getRun, getRunView } from '../server/utils/runs'
import { stageOutputs } from '../server/utils/stageOutputs'
import { readFixtureDir } from './fixtures/fetch-fixtures'

vi.mock('../server/pipeline/llm', () => ({ callObject: vi.fn() }))
const mockCall = vi.mocked(callObject)
const usage = { model: 'm', tokens_in: 1, tokens_out: 1, tokens_cached: 0, cost_usd: 0, cost_source: 'gateway' as const, ms: 1, retried: false }

// The toy LaTeX, with one prose mention ("the previous lemma") so resolve has a job.
const files = readFixtureDir('toy').map(f => f.path === 'sections/prelim.tex'
  ? { ...f, content: f.content.replace('the base case is trivial.', 'the base case is the previous lemma.') }
  : f)
const { skeleton } = chunkLatex(files)

// Proofs are short in the toy, so outline claims go straight to extract/resolve (normalizeOutline is tested separately).
const outline: Outline = {
  method: 'pipeline',
  claims: [
    { id: 'claim-thm-main-1', parentLabel: 'thm:main', nameHint: 'Roots bounded by degree', span: { file: 'main.tex', startLine: 17, endLine: 17 }, restsOn: ['unlabeled-2-1'], confidence: 0.9 },
    { id: 'claim-thm-main-2', parentLabel: 'thm:main', nameHint: 'Back to the theorem', span: { file: 'main.tex', startLine: 18, endLine: 18 }, restsOn: ['claim-thm-main-1', 'thm:main'], confidence: 0.6 }
  ],
  flags: [],
  stats: { calls: 1, tokens_in: 0, tokens_out: 0, cost_usd: 0, wallclock_ms: 0 }
}

let paperId: string
const newCtx = async (): Promise<RunContext> => {
  const runId = await createRun({ paperId, profile: 'quick', method: 'pipeline', budgetUsd: 5 })
  await stageOutputs.put(runId, 'chunk', skeleton)
  await stageOutputs.put(runId, 'outline', outline)
  return { runId, paperId, profile: 'quick', method: 'pipeline', budgetUsd: 5 }
}

beforeAll(async () => {
  const { db } = await createDb({ memory: true })
  setDb(db)
  const [row] = await db.insert(papers).values({ slug: 'toy-tex', title: 'Toy', sourceKind: 'upload', sourceRef: 'main.tex' }).returning()
  paperId = row!.id
  await db.insert(sources).values(files.map(f => ({ paperId, path: f.path, content: f.content, bytes: f.content.length })))
})

beforeEach(() => {
  mockCall.mockReset()
})

describe('ids', () => {
  it('derives node ids from labels and de-duplicates collisions', () => {
    const ids = statementIds([{ label: 'lem:sparsify' }, { label: 'thm:main' }, { label: 'thm-main' }, { label: 'unlabeled-4.3-1' }])
    expect([...ids.values()]).toEqual(['lem-sparsify', 'thm-main', 'thm-main-2', 'unlabeled-4-3-1'])
  })

  it('turns every skeleton statement into a node without a model call', () => {
    const nodes = statementNodes(skeleton)
    expect(nodes.map(n => [n.id, n.kind])).toEqual([['def-poly', 'definition'], ['lem-roots', 'lemma'], ['thm-main', 'theorem'], ['unlabeled-2-1', 'theorem']])
    expect(nodes[0]).toMatchObject({ name: 'Polynomial', classification: 'unknown', paper_ref: { label: 'def:poly', section: '1', sectionTitle: 'Preliminaries', file: 'sections/prelim.tex', line: 1 } })
    expect(nodes[3]!.paper_ref.label).toBeUndefined()
  })
})

describe('outline normalization', () => {
  // Pretend thm:main has a 70-line proof so the 60-line rule lets its claims through.
  const long: Skeleton = structuredClone(skeleton)
  long.statements.find(s => s.label === 'thm:main')!.proof = { file: 'main.tex', startLine: 16, endLine: 85, lines: 70 }
  long.files.find(f => f.path === 'main.tex')!.lines = 100

  it('renames claims, maps restsOn, applies the 60-line rule and drops unknown parents', () => {
    const { claims, flags, dropped } = normalizeOutline({
      claims: [
        { id: 'c1', parentLabel: 'thm:main', nameHint: ' First step ', span: { file: 'main.tex', startLine: 30, endLine: 20 }, restsOn: ['lem:roots', 'nope', 'thm:main'], confidence: 1.4 },
        { id: 'c2', parentLabel: 'thm:main', nameHint: 'Second', span: { file: 'main.tex', startLine: 31, endLine: 40 }, restsOn: ['c1', 'c2'], confidence: 0.8 },
        { id: 'c3', parentLabel: 'lem:roots', nameHint: 'Too short', span: { file: 'sections/prelim.tex', startLine: 11, endLine: 12 }, restsOn: [], confidence: 0.9 },
        { id: 'c4', parentLabel: 'lem:ghost', nameHint: 'Ghost', span: { file: 'main.tex', startLine: 1, endLine: 2 }, restsOn: [], confidence: 0.9 },
        { id: 'c5', parentLabel: 'unlabeled-2-1', nameHint: 'Proved elsewhere', span: { file: 'sections/prelim.tex', startLine: 1, endLine: 3 }, restsOn: ['c2'], confidence: 0.5 }
      ],
      flags: [{ kind: 'unused_statement', label: 'def:poly', note: 'never used' }]
    }, long)
    expect(claims.map(c => [c.id, c.parentLabel, c.restsOn])).toEqual([
      ['claim-thm-main-1', 'thm:main', ['lem:roots']],
      ['claim-thm-main-2', 'thm:main', ['claim-thm-main-1']],
      ['claim-unlabeled-2-1-1', 'unlabeled-2-1', ['claim-thm-main-2']]
    ])
    expect(claims[0]).toMatchObject({ nameHint: 'First step', span: { startLine: 20, endLine: 30 }, confidence: 1 })
    expect(dropped).toHaveLength(2)
    expect(dropped.join()).toMatch(/lem:roots's proof is 4 lines/)
    expect(flags.map(f => f.kind)).toEqual(['unused_statement'])
  })

  it('keeps claims in a short first proof when the argument continues in a second proof', () => {
    const { claims, flags, dropped } = normalizeOutline({
      claims: [
        { id: 'a1', parentLabel: 'thm:main', nameHint: 'First bound', span: { file: 'main.tex', startLine: 17, endLine: 17 }, restsOn: [], confidence: 0.9 },
        { id: 'a2', parentLabel: 'thm:main', nameHint: 'Second bound', span: { file: 'main.tex', startLine: 20, endLine: 22 }, restsOn: ['a1'], confidence: 0.9 }
      ],
      flags: []
    }, skeleton)
    expect(dropped).toEqual([])
    expect(claims.map(c => [c.id, c.restsOn])).toEqual([['claim-thm-main-1', []], ['claim-thm-main-2', ['claim-thm-main-1']]])
    expect(flags.map(f => f.kind)).toEqual(['suspect_span'])
  })

  it('reuses a stored outline without calling the model', async () => {
    const ctx = await newCtx()
    expect(await outlineStage(ctx)).toBe(2)
    expect(mockCall).not.toHaveBeenCalled()
    const view = await getRunView(ctx.runId)
    expect(view!.events.map(e => e.message)).toContain('outline · reused stage_outputs.outline (2 claims, pipeline)')
  })
})

describe('extract', () => {
  it('extracts statements directly and one call per claim, parented, with a span-text fallback on failure', async () => {
    mockCall.mockImplementation(async (opts) => {
      if (opts.prompt.includes('"Back to the theorem"')) {
        throw new Error('schema failed twice')
      }
      expect(opts.stage).toBe('extract')
      expect(opts.prompt).toContain('Parent statement: thm:main')
      return { object: { statement_paper: 'A nonzero $p$ has at most $d$ roots.', kind: 'claim' }, usage } as never
    })
    const ctx = await newCtx()
    expect(await extractStage(ctx)).toBe(6)
    expect(mockCall).toHaveBeenCalledTimes(2)

    const { nodes } = (await stageOutputs.get<ExtractOutput>(ctx.runId, 'extract'))!
    const claims = nodes.filter(n => n.kind === 'claim')
    expect(claims.map(c => [c.id, c.parent_id, c.name])).toEqual([
      ['claim-thm-main-1', 'thm-main', 'Roots bounded by degree'],
      ['claim-thm-main-2', 'thm-main', 'Back to the theorem']
    ])
    expect(claims[0]!.statement_paper).toBe('A nonzero $p$ has at most $d$ roots.')
    expect(claims[0]!.paper_ref).toMatchObject({ section: '2', sectionTitle: 'Main result', file: 'main.tex', line: 17 })
    expect(claims[1]!.statement_paper).toContain('See also Section')
    expect(claims[1]!.friction[0]).toMatchObject({ kind: 'structure_uncertain', severity: 'warn' })

    const run = await getRun(ctx.runId)
    expect(run!.progress).toMatchObject({ statements_in_source: 4, statements_extracted: 4, claims: 2, extract_failed: 1 })

    // Skip if the stage's own output exists.
    mockCall.mockClear()
    expect(await extractStage(ctx)).toBe(6)
    expect(mockCall).not.toHaveBeenCalled()
  })
})

describe('resolve', () => {
  it('detects prose mentions only outside \\ref', () => {
    expect(mentionsUnreffed('By Lemma~\\ref{lem:a} we are done.')).toBe(false)
    expect(mentionsUnreffed('By Lemma 4.2 we are done.')).toBe(true)
    expect(mentionsUnreffed('Using the previous lemma, ...')).toBe(true)
    expect(mentionsUnreffed('This follows by the usual argument.')).toBe(true)
  })

  it('rejects inferred edges that would close a cycle, including through a parent and its claims', () => {
    const node = (id: string, deps: string[] = [], parent?: string): ProofNode => ({
      id, name: id, kind: parent ? 'claim' : 'lemma', ...(parent ? { parent_id: parent } : {}), statement_paper: '', statement_plain: '', explanation: '',
      classification: 'unknown', paper_ref: { section: '1', file: 'x.tex', line: 1 }, deps_paper: deps, deps_inferred: [], friction: []
    })
    const g = depGraph([node('a', ['b']), node('b'), node('c'), node('claim-a-1', [], 'a')])
    expect(g.addInferred('b', 'a', 'b uses a')).toBe('cycle')
    expect(g.addInferred('claim-a-1', 'a', 'claim uses its parent')).toBe('cycle')
    expect(g.addInferred('a', 'a', 'self')).toBe('self')
    expect(g.addInferred('a', 'b', 'dup')).toBe('duplicate')
    expect(g.addInferred('claim-a-1', 'c', 'the claim uses c')).toBe('added')
    // a depends on its claim, which depends on c: c → a closes the loop through containment.
    expect(g.addInferred('c', 'a', 'c uses a')).toBe('cycle')
    expect(g.addInferred('c', 'b', 'c uses b')).toBe('added')
    expect(g.index.get('c')!.friction).toEqual([{ kind: 'inferred_dep', severity: 'info', note: 'c uses b' }])
    expect(g.index.get('b')!.deps_inferred).toEqual([])
  })

  it('adds mechanical edges from \\ref, inferred edges from the outline and prose, with friction and cycle rejection', async () => {
    mockCall.mockImplementation(async (opts) => {
      if (opts.stage === 'extract') {
        return { object: { statement_paper: 'claim', kind: 'claim' }, usage } as never
      }
      expect(opts.prompt).toContain('Statement: lem-roots')
      expect(opts.prompt).toContain('- thm-main · theorem 1')
      // thm-main → lem-roots already, so lem-roots → thm-main must be rejected; unlabeled-2-1 is fine.
      return { object: { deps: [{ id: 'thm-main', reason: 'the previous lemma' }, { id: 'unlabeled-2-1', reason: '"the previous lemma" is the unlabeled theorem' }, { id: 'ghost', reason: 'x' }] }, usage } as never
    })
    const ctx = await newCtx()
    await extractStage(ctx)
    expect(await resolveStage(ctx)).toBe(6)
    expect(mockCall.mock.calls.filter(([o]) => o.stage === 'resolve')).toHaveLength(1)

    const { nodes } = (await stageOutputs.get<ResolveOutput>(ctx.runId, 'resolve'))!
    const by = new Map(nodes.map(n => [n.id, n]))
    expect(by.get('lem-roots')!.deps_paper).toEqual(['def-poly'])
    expect(by.get('thm-main')!.deps_paper).toEqual(['lem-roots', 'def-poly'])
    // Refs on line 17 land on the claim whose span covers it.
    expect(by.get('claim-thm-main-1')!.deps_paper).toEqual(['lem-roots', 'def-poly'])
    expect(by.get('claim-thm-main-1')!.deps_inferred).toEqual(['unlabeled-2-1'])
    // restsOn the parent itself is a containment cycle.
    expect(by.get('claim-thm-main-2')!.deps_inferred).toEqual(['claim-thm-main-1'])
    expect(by.get('lem-roots')!.deps_inferred).toEqual(['unlabeled-2-1'])
    expect(by.get('lem-roots')!.friction).toEqual([{ kind: 'inferred_dep', severity: 'info', note: '"the previous lemma" is the unlabeled theorem' }])
    expect(nodes.flatMap(n => n.friction).filter(f => f.kind === 'inferred_dep')).toHaveLength(3)

    const run = await getRun(ctx.runId)
    expect(run!.progress).toMatchObject({ refs_mechanical: 3, claim_refs: 2, refs_inferred: 3, inferred_outline: 2, inferred_prose: 1, inferred_rejected: 2 })
    const messages = (await getRunView(ctx.runId))!.events.map(e => e.message)
    expect(messages).toContain('resolve · rejected inferred lem-roots → thm-main (cycle): the previous lemma')
    expect(messages.some(m => m.startsWith('resolve · rejected inferred claim-thm-main-2 → thm-main (cycle)'))).toBe(true)
  })
})
