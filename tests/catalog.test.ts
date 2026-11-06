// The openai/math catalog: parsing the index (fixtures are excerpts of the real files: families 017, 049, 113), the
// sync (into the Supabase fake), the read-side queries, and the two list rules (public papers only; the site's own fetches unlogged).
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as h3 from 'h3' // the root h3 is pinned to Nitro's v1 (package.json)
import { familyCode, disciplineSlug } from '../shared/catalog'
import { FLAGSHIP } from '../shared/flagship'
import { normalizeIndexText, parseContents, parseLeanDirs, parseOverview, parseReasoningTraces, publishedOnFromDir, validateCatalog } from '../server/catalog/parse'
import { catalogStats, disciplineList, familyDetail, queryFamilies } from '../server/catalog/query'
import { CatalogInvalidError, syncCatalog } from '../server/catalog/sync'
import { toyDigest } from '../server/fixtures/toy-digest'
import { invalidateCatalog, listPublicPaperItems, loadCatalog } from '../server/utils/agentApi'
import type { AgentRequestEntry } from '../server/utils/agentLog'
import { logAgentRequest, setAgentLogSink } from '../server/utils/agentLog'
import { setSupabase } from '../server/utils/supabase'
import { createFakeSupabase } from './helpers/fakeSupabase'

const FIX = new URL('./fixtures/catalog/', import.meta.url)
const file = (name: string) => readFileSync(new URL(name, FIX), 'utf8')
const SHA = 'a'.repeat(40)
const NONCOORD = 'A-stable-coordinate-that-is-not-a-coordinate-in-four-variables-October-5-2026'

function fakeFetch(files: Record<string, string> = {}) {
  const served: Record<string, string> = { 'CONTENTS.md': file('CONTENTS.md'), 'overview.tex': file('overview.tex'), 'lean/formalization.yaml': file('formalization.yaml'), 'README.md': file('README.md'), ...files }
  return async (url: string) => {
    if (url.startsWith('https://api.github.com/')) {
      return new Response(SHA)
    }
    const path = url.split(`/${SHA}/`)[1] ?? ''
    return path in served ? new Response(served[path]) : new Response('not found', { status: 404 })
  }
}

describe('parsing the index', () => {
  const contents = parseContents(file('CONTENTS.md'))
  const overview = parseOverview(file('overview.tex'))

  it('reads families, members and disciplines', () => {
    expect(contents.errors).toEqual([])
    expect(contents.families.map(f => [f.number, f.members.length])).toEqual([[17, 1], [49, 2], [113, 2]])
    expect(contents.families[1]!.title).toBe('A stable-coordinate counterexample in four variables')
    expect(contents.families[1]!.members[0]).toMatchObject({ dir: NONCOORD, pdfFile: 'stable-coordinate-four-variables.pdf' })
    expect(overview.map(e => [e.number, e.discipline, e.dirs.length])).toEqual([
      [17, 'Number theory', 1],
      [49, 'Algebraic and complex geometry', 2],
      [113, 'Theoretical computer science', 2]
    ])
    expect(validateCatalog(contents, overview)).toEqual({ ok: true, problems: [] })
  })

  it('normalizes index text to $…$ math without HTML, keeping paragraphs', () => {
    expect(normalizeIndexText('over $`\\overline{\\mathbb Q}`$ at <i>p</i>, x<sub>n</sub> y<sup>2</sup> &amp; &lt; &#8211;\n  wrapped\n\nnext')).toBe('over $\\overline{\\mathbb Q}$ at p, x$_{n}$ y$^{2}$ & < –\u0020wrapped\n\nnext')
    expect(normalizeIndexText('time. ([Lean](lean/docs/378.md)) [x](https://eccc.weizmann.ac.il/r/)')).toBe('time. ([Lean](https://github.com/openai/math/blob/main/lean/docs/378.md)) [x](https://eccc.weizmann.ac.il/r/)')
    const abstracts = contents.families.flatMap(f => f.members.map(m => m.abstract))
    expect(abstracts.some(a => a.includes('\n\n'))).toBe(true)
    expect(abstracts.join(' ')).not.toMatch(/<\/?(i|sub|sup)>|\$`|&emsp;/)
  })

  it('reads Lean only from sources:, and the reasoning traces', () => {
    const lean = parseLeanDirs(file('formalization.yaml'))
    expect(lean.size).toBe(3)
    expect(lean.has('The-irrationality-exponent-of-pi-is-2-September-24-2026')).toBe(false)
    expect(parseReasoningTraces(file('README.md')).get(17)).toBe('reasoning_traces/irrationality-exponent-of-pi.pdf')
  })

  it('derives dates and codes', () => {
    expect(publishedOnFromDir(NONCOORD)).toBe('2026-10-05')
    expect(publishedOnFromDir('no-date-here')).toBeNull()
    expect(familyCode(49)).toBe('049')
    expect(disciplineSlug('Algebraic and complex geometry')).toBe('algebraic-and-complex-geometry')
  })

  it('fails validation when a family\'s members differ, or a cell is unrecognized', () => {
    const dropped = parseOverview(file('overview.tex').replace(/\\enspace\\textperiodcentered\\enspace\\href\{[^}]+\}\{[^}]*\}/, ''))
    expect(validateCatalog(contents, dropped).problems).toEqual([expect.stringContaining('members differ')])
    const junk = parseContents(file('CONTENTS.md').replace('<td>', '<td>\nnot a family\n</td><td>'))
    expect(validateCatalog(junk, overview).ok).toBe(false)
  })

  it('flagship numbers are unique', () => {
    expect(new Set(FLAGSHIP.map(f => f.number)).size).toBe(FLAGSHIP.length)
  })
})

describe('sync', () => {
  let fake: ReturnType<typeof createFakeSupabase>
  beforeAll(() => {
    // Seed rows skip the fake's column defaults, so they carry id, timestamps and manuscript_dir themselves.
    const row = (slug: string, isPublic: boolean, sourceRef: string, digest = true) => ({
      id: randomUUID(), slug, title: slug, authors: [], source_kind: 'github', source_ref: sourceRef, public: isPublic, manuscript_dir: null,
      digest: digest ? { ...toyDigest, slug } : null, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    })
    const ref = `https://github.com/openai/math/tree/main/preprints/${NONCOORD}/build`
    fake = createFakeSupabase({
      papers: [
        row('noncoordinate', true, ref),
        row('noncoordinate-agent', false, ref),
        row('pfr', false, 'arxiv:2311.05762'),
        row('undigested', true, `https://github.com/openai/math/tree/main/preprints/Entropy-and-Face-Dimension-of-the-Perfect-Matching-Polytope-September-23-2026/build`, false)
      ]
    })
    setSupabase(fake.client)
  })

  it('writes the catalog, links papers by source_ref, and a second sync changes nothing', async () => {
    const first = await syncCatalog({ fetchImpl: fakeFetch() })
    expect(first).toMatchObject({ sha: SHA, families: 3, manuscripts: 5, disciplines: 3, lean: 2, leanManuscripts: 3, written: { families: 3, manuscripts: 5 } })
    expect(first.linked).toEqual(['noncoordinate', 'noncoordinate-agent', 'undigested'])
    expect(fake.tables.papers!.find(p => p.slug === 'noncoordinate')!.manuscript_dir).toBe(NONCOORD)
    expect(fake.tables.families).toHaveLength(3)
    expect(fake.tables.manuscripts).toHaveLength(5)
    expect(fake.tables.catalog_meta![0]).toMatchObject({ key: 'openai-math', value: { sha: SHA, counts: { families: 3, manuscripts: 5 } } })

    const second = await syncCatalog({ fetchImpl: fakeFetch() })
    expect(second).toMatchObject({ written: { families: 0, manuscripts: 0 }, linked: [], stale: { families: [], manuscripts: [] } })
  })

  it('refuses an index that fails validation unless forced, and keeps families that leave it', async () => {
    const tex = file('overview.tex').split('\n').filter(l => !l.startsWith('\\resultentry{017}')).join('\n')
    await expect(syncCatalog({ fetchImpl: fakeFetch({ 'overview.tex': tex }) })).rejects.toBeInstanceOf(CatalogInvalidError)
    const contents = file('CONTENTS.md').replace(/<tbody><tr>\n<td>\n\n\*\*017\.[\s\S]*?(?=<tbody><tr>\n<td>\n\n\*\*049\.)/, '')
    const forced = await syncCatalog({ force: true, fetchImpl: fakeFetch({ 'CONTENTS.md': contents, 'overview.tex': tex }) })
    expect(forced.families).toBe(2)
    expect(forced.stale.families).toEqual([17])
    expect(familyDetail(await (invalidateCatalog(), loadCatalog()), 17)).not.toBeNull()
    await syncCatalog({ fetchImpl: fakeFetch() })
  })

  it('queries: digested counts public papers only; filters, search, sort and paging', async () => {
    invalidateCatalog()
    const c = await loadCatalog()
    expect(catalogStats(c)).toMatchObject({ families: 3, manuscripts: 5, disciplines: 3, digested: 1, lean: 2, sha: SHA })
    expect(queryFamilies(c, { digested: '1' }).families.map(f => f.code)).toEqual(['049'])
    expect(queryFamilies(c, { digested: '0' }).total).toBe(2)
    expect(queryFamilies(c, { lean: '1' }).families.map(f => f.number)).toEqual([49, 113])
    expect(queryFamilies(c, { discipline: 'number-theory' }).families.map(f => f.number)).toEqual([17])
    expect(queryFamilies(c, { q: 'PERFECT MATCHING' }).families.map(f => f.number)).toEqual([113])
    // Flagship rank: 049 is #5, 017 is #6, 113 is #22.
    expect(queryFamilies(c).families.map(f => f.number)).toEqual([49, 17, 113])
    expect(queryFamilies(c, { sort: 'number' }).families.map(f => f.number)).toEqual([17, 49, 113])
    expect(queryFamilies(c, { sort: 'members', limit: 1, offset: 1 })).toMatchObject({ total: 3, offset: 1, limit: 1, families: [{ number: 113 }] })

    const f = familyDetail(c, 49)!
    expect(f).toMatchObject({ code: '049', flagship: { rank: 5 }, digested: [{ slug: 'noncoordinate', dir: NONCOORD }] })
    expect(f.manuscripts[0]).toMatchObject({
      pdfUrl: `https://github.com/openai/math/blob/main/preprints/${NONCOORD}/stable-coordinate-four-variables.pdf`,
      sourceUrl: `https://github.com/openai/math/tree/main/preprints/${NONCOORD}/build`,
      publishedOn: '2026-10-05',
      hasLean: true,
      digest: { slug: 'noncoordinate' }
    })
    expect(f.manuscripts[1]!.digest).toBeUndefined()
    expect(familyDetail(c, 17)!.reasoningTrace).toBe('https://github.com/openai/math/blob/main/reasoning_traces/irrationality-exponent-of-pi.pdf')
    expect(disciplineList(c).map(d => [d.slug, d.families, d.digested])).toEqual([
      ['number-theory', 1, 0],
      ['algebraic-and-complex-geometry', 1, 1],
      ['theoretical-computer-science', 1, 0]
    ])
  })

  it('GET /api/papers lists public digests only, with their family', async () => {
    const items = await listPublicPaperItems()
    expect(items.map(p => p.slug)).toEqual(['noncoordinate'])
    expect(items[0]).toMatchObject({ family: { number: 49, code: '049', disciplineSlug: 'algebraic-and-complex-geometry' }, hasLean: true, counts: { nodes: toyDigest.nodes.length } })
    expect(items[0]).not.toHaveProperty('run')
  })
})

describe('agent log skips the site\'s own fetches', () => {
  it('same-origin and x-proofmap-site requests write no row; a plain one does', async () => {
    for (const name of ['getRequestHeader', 'getRequestIP', 'getQuery'] as const) {
      vi.stubGlobal(name, h3[name])
    }
    const rows: AgentRequestEntry[] = []
    const prev = setAgentLogSink(async (e) => {
      rows.push(...e)
    })
    const app = h3.createApp().use(h3.eventHandler((event) => {
      logAgentRequest(event, { surface: 'v1', tool: 'list_families', status: 200, ms: 1 })
      return 'ok'
    }))
    const web = h3.toWebHandler(app)
    const get = (headers: Record<string, string>) => web(new Request('http://localhost/api/v1/families', { headers }))
    await get({ 'sec-fetch-site': 'same-origin' })
    await get({ 'x-proofmap-site': '1' })
    expect(rows).toHaveLength(0)
    await get({ 'user-agent': 'curl/8.7.1' })
    await vi.waitFor(() => expect(rows).toHaveLength(1))
    expect(rows[0]).toMatchObject({ tool: 'list_families', client: 'curl' })
    setAgentLogSink(prev)
    vi.unstubAllGlobals()
  })
})
