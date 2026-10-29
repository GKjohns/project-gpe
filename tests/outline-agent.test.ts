import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Skeleton } from '#shared/pipeline'
import { createDb, setDb } from '../server/db'
import { papers } from '../server/db/schema'
import { finishRun } from '../server/pipeline/runner'
import { callbackUrl, claudeCodeModel, ingestTrace, parseAgentOutline } from '../server/pipeline/stages/outline-agent'
import type { TraceEntry } from '../server/pipeline/stages/outline-agent'
import { createRun, getRun, getRunView, patchProgress, setStatus } from '../server/utils/runs'

let paperId: string

beforeAll(async () => {
  const { db } = await createDb({ memory: true })
  setDb(db)
  const [row] = await db.insert(papers).values({ slug: 'agent', title: 'Agent', sourceKind: 'upload', sourceRef: 'x.tex' }).returning()
  paperId = row!.id
})

const entry = (seq: number, cost: number, extra: Partial<TraceEntry> = {}): TraceEntry => ({
  seq, ts: new Date().toISOString(), turn: seq, kind: 'tool', tool: 'Read', summary: `src/main.tex:${seq}`, calls: seq, cost_usd: cost, tokens_in: 0, tokens_out: 0, ...extra
})

describe('outline-agent helpers', () => {
  it('maps gateway model ids to the Claude Code endpoint ids', () => {
    expect(claudeCodeModel('anthropic/claude-opus-5.5')).toBe('claude-opus-5-5')
    expect(claudeCodeModel('anthropic/claude-haiku-5.5')).toBe('claude-haiku-5-5')
  })

  it('only uses the callback for a public https app URL', () => {
    expect(callbackUrl('http://localhost:3120', 'r1')).toBeNull()
    expect(callbackUrl('http://127.0.0.1:3120', 'r1')).toBeNull()
    expect(callbackUrl('http://digest.example.com', 'r1')).toBeNull()
    expect(callbackUrl(undefined, 'r1')).toBeNull()
    expect(callbackUrl('https://digest.vercel.app/', 'r1')).toBe('https://digest.vercel.app/api/runs/r1/events')
  })

  it('keeps the well-formed entries of a partly malformed outline', () => {
    const good = { id: 'c1', parentLabel: 'lem:a', nameHint: 'A bound', span: { file: 'm.tex', startLine: 1, endLine: 5 }, restsOn: [], confidence: 0.8 }
    const out = parseAgentOutline({ claims: [good, { id: 'c2' }], flags: [{ kind: 'other', note: 'x' }, { kind: 'nope' }] })
    expect(out?.outline.claims).toHaveLength(1)
    expect(out?.outline.flags).toHaveLength(1)
    expect(out?.rejected).toBe(2)
    expect(parseAgentOutline(null)).toBeNull()
  })
})

describe('ingestTrace', () => {
  it('logs each line once and moves only the cost delta into runs.cost_usd', async () => {
    const runId = await createRun({ paperId, profile: 'quick', method: 'agent', budgetUsd: 5 })
    expect(await ingestTrace(runId, [entry(1, 0.1), entry(2, 0.25)])).toBe(2)
    // Polling re-reads the whole file; the callback may have delivered line 3 already.
    expect(await ingestTrace(runId, [entry(3, 0.3)])).toBe(1)
    expect(await ingestTrace(runId, [entry(1, 0.1), entry(2, 0.25), entry(3, 0.3), entry(4, 0.5, { kind: 'validate', tool: undefined, summary: 'OK: 3 claims' })])).toBe(1)
    const run = await getRun(runId)
    expect(run!.costUsd).toBeCloseTo(0.5, 6)
    expect(run!.progress.agent_trace_seq).toBe(4)
    expect(run!.progress.agent_turn).toBe(4)
    expect(run!.progress.agent_last_tool).toBe('validate')
    const view = await getRunView(runId)
    const trace = view!.events.filter(e => (e.data as { trace?: boolean } | null)?.trace)
    expect(trace.map(e => e.message)).toEqual([
      'agent · turn 1 · Read src/main.tex:1',
      'agent · turn 2 · Read src/main.tex:2',
      'agent · turn 3 · Read src/main.tex:3',
      'agent · turn 4 · validate · OK: 3 claims'
    ])
  })
})

describe('structure_partial', () => {
  it('finishRun ends a partial agent run as structure_partial, others as complete', async () => {
    const a = await createRun({ paperId, profile: 'quick', method: 'agent', budgetUsd: 5 })
    await setStatus(a, 'running')
    await patchProgress(a, { structure_partial: true })
    await finishRun(a)
    const ra = await getRun(a)
    expect(ra!.status).toBe('structure_partial')
    expect(ra!.finishedAt).not.toBeNull()
    const b = await createRun({ paperId, profile: 'quick', method: 'agent', budgetUsd: 5 })
    await setStatus(b, 'running')
    await finishRun(b)
    expect((await getRun(b))!.status).toBe('complete')
  })
})

describe('validate_outline.mjs', () => {
  const script = fileURLToPath(new URL('../server/pipeline/sandbox/validate_outline.mjs', import.meta.url))
  const skeleton: Skeleton = {
    files: [{ path: 'main.tex', lines: 400 }, { path: 'app.tex', lines: 100 }],
    mainFile: 'main.tex',
    macros: {},
    sections: [],
    statements: [
      { label: 'lem:long', env: 'lemma', sectionId: '1', file: 'main.tex', startLine: 10, endLine: 12, body: '', proof: { file: 'main.tex', startLine: 13, endLine: 112, lines: 100 } },
      { label: 'lem:short', env: 'lemma', sectionId: '1', file: 'main.tex', startLine: 120, endLine: 122, body: '', proof: { file: 'main.tex', startLine: 123, endLine: 140, lines: 18 } },
      { label: 'thm:main', env: 'theorem', sectionId: '2', file: 'main.tex', startLine: 200, endLine: 202, body: '' }
    ],
    refs: [],
    unresolved: []
  }
  const run = (outline: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), 'validate-'))
    writeFileSync(join(dir, 'skeleton.json'), JSON.stringify(skeleton))
    writeFileSync(join(dir, 'outline.json'), JSON.stringify(outline))
    try {
      return { code: 0, out: execFileSync('node', [script, 'outline.json'], { cwd: dir, encoding: 'utf8' }) }
    } catch (err) {
      const e = err as { status: number, stdout: string }
      return { code: e.status, out: e.stdout }
    }
  }
  const claim = (id: string, parentLabel: string, startLine: number, endLine: number, restsOn: string[] = [], file = 'main.tex') =>
    ({ id, parentLabel, nameHint: `Claim about ${id}`, span: { file, startLine, endLine }, restsOn, confidence: 0.8 })

  it('accepts a good outline, warning about an argument outside the recorded proof', () => {
    const r = run({ claims: [claim('c1', 'lem:long', 14, 50), claim('c2', 'lem:long', 51, 110, ['c1', 'lem:short']), claim('c3', 'thm:main', 1, 60, ['lem:long'], 'app.tex')], flags: [] })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^OK: 3 claims in 2 proofs/)
    expect(r.out).toMatch(/warning: c3: span app.tex:1-60 is outside thm:main's recorded proof/)
  })

  it('rejects the 60-line rule, overlaps, unknown targets, parent deps and cycles', () => {
    const r = run({
      claims: [
        claim('c1', 'lem:short', 124, 130),
        claim('c2', 'lem:long', 14, 60, ['c3']),
        claim('c3', 'lem:long', 50, 100, ['c2', 'lem:nope', 'lem:long'])
      ],
      flags: [{ kind: 'bogus', note: '' }]
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/^FAIL: /)
    expect(r.out).toMatch(/lem:short's proof is 18 lines/)
    expect(r.out).toMatch(/c2 and c3 \(lem:long\) overlap/)
    expect(r.out).toMatch(/restsOn "lem:nope" is neither/)
    expect(r.out).toMatch(/restsOn contains its own parent lem:long/)
    expect(r.out).toMatch(/cycle among claims: c2 → c3 → c2/)
    expect(r.out).toMatch(/flags\[0\]/)
  })
})
