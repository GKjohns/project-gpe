import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createDb, setDb } from '../server/db'
import { papers } from '../server/db/schema'
import { toyDigest } from '../server/fixtures/toy-digest'
import { chunkLatex } from '../server/pipeline/latex/chunk'
import { callObject } from '../server/pipeline/llm'
import { cleanVision, FIGURE_INSTRUCTIONS, figurePrompt, figuresStage, figureVisionSchema } from '../server/pipeline/stages/figures'
import type { FiguresOutput } from '../server/pipeline/stages/figures'
import type { RenderFigure, RenderOutput } from '../server/pipeline/stages/render'
import { readerParts } from '../server/pipeline/stages/finalize'
import { blobStore } from '../server/utils/blobs'
import { createRun } from '../server/utils/runs'
import { stageOutputs } from '../server/utils/stageOutputs'
import { readFixtureDir } from './fixtures/fetch-fixtures'

vi.mock('../server/pipeline/llm', () => ({ callObject: vi.fn() }))
const mockCall = vi.mocked(callObject)
const usage = { model: 'm', tokens_in: 1, tokens_out: 1, tokens_cached: 0, cost_usd: 0.03, cost_source: 'gateway' as const, ms: 1, retried: false }

const nodes = structuredClone(toyDigest.nodes)
const ids = new Set(nodes.map(n => n.id))

function fig(id: string, extra: Partial<RenderFigure> = {}): RenderFigure {
  return {
    id, env: 'figure', labels: [`fig:${id}`], label: `fig:${id}`, number: '1', caption: 'Error against $n$.', subcaptions: [],
    section: '1', file: 'main.tex', line: 10, spans: [{ file: 'main.tex', start: 10, end: 14 }], graphics: [{ ref: 'plot', path: 'plot.png' }],
    tikz: false, body: '\\includegraphics{plot}', context: 'As Figure 1 shows, the error decays.', cited_by: ['lem-hash'], ...extra
  }
}

describe('figureVisionSchema', () => {
  it('takes an answer with null data_summary and rejects out-of-range confidence or unknown kinds', () => {
    const ok = { kind: 'plot', readable_text: ['n', 'error', 'unreadable'], description: 'A line.', data_summary: null, node_ids: [], confidence: 0.7 }
    expect(figureVisionSchema.safeParse(ok).success).toBe(true)
    expect(figureVisionSchema.safeParse({ ...ok, confidence: 1.5 }).success).toBe(false)
    expect(figureVisionSchema.safeParse({ ...ok, kind: 'chart' }).success).toBe(false)
  })

  it('cleanVision drops invented node ids and keeps data_summary for plots only', () => {
    const v = { kind: 'diagram' as const, readable_text: [], description: 'd', data_summary: 'x from 0 to 10', node_ids: ['lem-hash', 'lem-made-up', 'lem-hash'], confidence: 0.9 }
    expect(cleanVision(v, ids)).toMatchObject({ node_ids: ['lem-hash'], data_summary: null })
    expect(cleanVision({ ...v, kind: 'plot' }, ids).data_summary).toBe('x from 0 to 10')
  })

  it('tells the model to say "unreadable" rather than guess, and puts citing nodes first', () => {
    expect(FIGURE_INSTRUCTIONS).toContain('"unreadable"')
    expect(FIGURE_INSTRUCTIONS).toMatch(/Never fill in a number from the caption/)
    const p = figurePrompt({ title: 'Toy', figure: fig('a'), nodes, numbers: new Map([['lem-hash', '2.1']]) })
    expect(p.indexOf('cites or contains the figure')).toBeLessThan(p.indexOf('All nodes:'))
    expect(p).toContain('- lem-hash · lemma 2.1 ·')
    expect(p.split('All nodes:')[1]).not.toContain('- lem-hash ')
  })
})

describe('figuresStage (mocked vision)', () => {
  let runId = ''
  let paperId = ''
  beforeAll(async () => {
    const { db } = await createDb({ memory: true })
    setDb(db)
    const [paper] = await db.insert(papers).values({ slug: 'fig-test', title: 'Toy', sourceKind: 'upload', sourceRef: 'toy.tex' }).returning({ id: papers.id })
    paperId = paper!.id
    runId = await createRun({ paperId, profile: 'standard', method: 'pipeline', budgetUsd: 5 })
    const sha = await blobStore.put(new Uint8Array([137, 80, 78, 71, 1, 2, 3]), 'image/png')
    const render: RenderOutput = {
      status: 'compiled', engine: 'pdflatex', anchors: {}, ms: 1, rendered_at: '2026-10-29T00:00:00Z',
      pdf: { sha, bytes: 7, pages: 3 },
      figures: [fig('a', { image: { sha, width: 800, height: 400, source: 'pdf' }, page: 2, rect: { page: 2, x: 1, y: 2, w: 3, h: 4 } }), fig('b', { cited_by: [] })]
    }
    await stageOutputs.put(runId, 'render', render)
    await stageOutputs.put(runId, 'classify', { nodes })
    await stageOutputs.put(runId, 'chunk', chunkLatex(readFixtureDir('toy')).skeleton)
    mockCall.mockResolvedValue({ object: { kind: 'plot', readable_text: ['n', 'unreadable'], description: 'Error falls with $n$.', data_summary: 'x: n; y: error; values unreadable', node_ids: ['lem-hash', 'nope'], confidence: 0.6 }, usage })
  })

  it('describes figures with an image (one call each, image attached) and leaves the rest caption-only', async () => {
    expect(await figuresStage({ runId, paperId, profile: 'standard', method: 'pipeline', budgetUsd: 5 })).toBe(2)
    expect(mockCall).toHaveBeenCalledTimes(1)
    const call = mockCall.mock.calls[0]![0]
    expect(call.images).toHaveLength(1)
    expect(call.images![0]!.mediaType).toBe('image/png')
    expect(call.model).toBe('anthropic/claude-opus-5.5')
    const out = (await stageOutputs.get<FiguresOutput>(runId, 'figures'))!
    const [a, b] = out.figures
    expect(a).toMatchObject({ id: 'a', kind: 'plot', description: 'Error falls with $n$.', node_ids: ['lem-hash'], confidence: 0.6, page: 2, width: 800, image_source: 'pdf' })
    expect(a!.image_url).toMatch(/^\/api\/blobs\/[0-9a-f]{64}$/)
    expect(b).toMatchObject({ id: 'b', kind: 'other', description: '', confidence: 0, node_ids: [] })
    expect(b!.image_url).toBeUndefined()
  })

  it('skips the work on a retry (stage output present)', async () => {
    mockCall.mockClear()
    await figuresStage({ runId, paperId, profile: 'standard', method: 'pipeline', budgetUsd: 5 })
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('finalize turns render + figures into the digest\'s render and figures', async () => {
    const parts = readerParts((await stageOutputs.get<RenderOutput>(runId, 'render'))!, await stageOutputs.get<FiguresOutput>(runId, 'figures'))
    expect(parts.render).toMatchObject({ status: 'compiled', engine: 'pdflatex', pages: 3, synctex: false })
    expect(parts.render!.pdf_url).toMatch(/^\/api\/blobs\//)
    expect(parts.figures).toHaveLength(2)
    expect(readerParts(null, null)).toEqual({})
  })
})
