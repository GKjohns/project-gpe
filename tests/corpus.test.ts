import { describe, expect, it } from 'vitest'
import type { Golden } from '#shared/corpus'
import { corpusPaperSlugs, goldenDiff, goldenDiffCount } from '#shared/corpus'
import type { Outline } from '#shared/pipeline'
import manifest from '../corpus/manifest.json'
import sensitivityGolden from '../corpus/golden/sensitivity.json'
import toyGolden from '../corpus/golden/toy.json'
import { chunkLatex } from '../server/pipeline/latex/chunk'
import { statementNodes } from '../server/pipeline/stages/extract'
import { addMechanicalEdges, depGraph } from '../server/pipeline/stages/resolve'
import { defaultMethodFor, defaultProfileFor } from '../server/utils/aiModels'
import { corpusEntryForPaper, goldenForPaper } from '../server/utils/corpus'
import { ensureSensitivityFixture, readFixtureDir } from './fixtures/fetch-fixtures'

const empty: Outline = { method: 'pipeline', claims: [], flags: [], stats: { calls: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0, wallclock_ms: 0 } }

/** What chunk → extract → resolve produce with no model calls: statement nodes + \ref edges. */
function mechanicalNodes(files: { path: string, content: string }[]) {
  const { skeleton } = chunkLatex(files)
  const graph = depGraph(statementNodes(skeleton))
  addMechanicalEdges(graph, skeleton, empty)
  return [...graph.index.values()]
}

describe('goldens against the deterministic pipeline', () => {
  it('toy LaTeX fixture: 0 diffs', () => {
    const d = goldenDiff(toyGolden as Golden, mechanicalNodes(readFixtureDir('toy')))
    expect(d).toEqual({ missing: [], extra: [], dep_mismatches: 0, kind_mismatches: 0 })
  })

  it('sensitivity (arXiv 1907.00847): 0 diffs', async () => {
    const d = goldenDiff(sensitivityGolden as Golden, mechanicalNodes(await ensureSensitivityFixture()))
    expect(goldenDiffCount(d)).toBe(0)
  }, 60_000)
})

describe('goldenDiff', () => {
  const golden: Golden = { slug: 'g', source: 's', nodes: [
    { id: 'a', kind: 'theorem', deps_paper: ['b', 'c'] },
    { id: 'b', kind: 'lemma', deps_paper: [] },
    { id: 'c', kind: 'lemma', deps_paper: [] }
  ] }

  it('counts missing, extra, edge and kind mismatches; ignores claims', () => {
    const d = goldenDiff(golden, [
      { id: 'a', kind: 'theorem', deps_paper: ['b', 'x'] },
      { id: 'b', kind: 'proposition', deps_paper: [] },
      { id: 'x', kind: 'lemma', deps_paper: [] },
      { id: 'claim-a-1', kind: 'claim', parent_id: 'a', deps_paper: ['b'] }
    ])
    expect(d).toEqual({ missing: ['c'], extra: ['x'], dep_mismatches: 2, kind_mismatches: 1 })
    expect(goldenDiffCount(d)).toBe(5)
  })
})

describe('manifest', () => {
  it('has unique slugs, sources and goldens that exist', () => {
    const slugs = manifest.entries.map(e => e.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const e of manifest.entries) {
      expect(['simple', 'intermediate', 'whopper']).toContain(e.tier)
      if (e.golden) {
        expect(goldenForPaper(e.slug)).toBeDefined()
      }
    }
    expect(manifest.entries.find(e => e.slug === 'anthropic-1')?.source.kind).toBe('none')
  })

  it('maps paper rows back to entries and methods', () => {
    expect(corpusPaperSlugs({ slug: 'pfr' }, 'agent')).toEqual(['pfr-agent'])
    expect(corpusEntryForPaper('eth-e2e')).toMatchObject({ entry: { slug: 'eth' }, method: 'pipeline' })
    expect(corpusEntryForPaper('sensitivity-agent')).toMatchObject({ entry: { slug: 'sensitivity' }, method: 'agent' })
    expect(goldenForPaper('sensitivity-agent')?.slug).toBe('sensitivity')
    expect(corpusEntryForPaper('eth')).toBeUndefined()
  })
})

describe('defaults', () => {
  it('profile: careful over 30 pages or 100k tokens', () => {
    expect(defaultProfileFor(6_641, 7)).toBe('standard')
    expect(defaultProfileFor(26_943, 33)).toBe('careful')
    expect(defaultProfileFor(133_580)).toBe('careful')
  })

  it('method: pipeline for every size the corpus measured, agent above 200k tokens', () => {
    expect(defaultMethodFor(6_056)).toBe('pipeline')
    expect(defaultMethodFor(133_580)).toBe('pipeline')
    expect(defaultMethodFor(250_000)).toBe('agent')
  })
})
