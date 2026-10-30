import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PaperDigest, ProofNode } from '#shared/types'
import { toolRow } from '../app/utils/chatToolRows'
import { chunkLatex } from '../server/pipeline/latex/chunk'
import { toyDigest } from '../server/fixtures/toy-digest'
import { equationLines, serializeDigest } from '../server/utils/chat'
import { buildChatSources, depClosure, normalizeForSearch, readNode, resolveFigure, searchPaper, traceDeps, viewFigure } from '../server/utils/chatTools'

// The toy LaTeX fixture (main.tex \input's sections/prelim.tex) with a hand-built digest over its three statements.
const dir = new URL('./fixtures/latex/toy/', import.meta.url)
const files = ['main.tex', 'sections/prelim.tex'].map(path => ({ path, content: readFileSync(new URL(path, dir), 'utf8') }))
const { skeleton } = chunkLatex(files, { mainFile: 'main.tex' })

const node = (id: string, kind: ProofNode['kind'], label: string, file: string, line: number, deps: string[], extra: Partial<ProofNode> = {}): ProofNode => ({
  id, kind, name: id, statement_paper: `stmt ${id}`, statement_plain: '', explanation: '', classification: 'unknown',
  paper_ref: { label, section: file === 'main.tex' ? '2' : '1', file, line }, deps_paper: deps, deps_inferred: [], friction: [], ...extra
})
const fixtureDigest: PaperDigest = {
  ...toyDigest,
  slug: 'fixture',
  sections: [
    { id: '1', title: 'Preliminaries', level: 1, order: 0, file: 'main.tex', line: 9 },
    { id: '2', title: 'Main result', level: 1, order: 1, file: 'main.tex', line: 11 }
  ],
  nodes: [
    node('def-poly', 'definition', 'def:poly', 'sections/prelim.tex', 1, []),
    node('lem-roots', 'lemma', 'lem:roots', 'sections/prelim.tex', 4, ['def-poly']),
    node('thm-main', 'theorem', 'thm:main', 'main.tex', 13, ['lem-roots', 'def-poly'])
  ],
  root_ids: ['thm-main'],
  equations: { 'eq:deg': { latex: '\\#\\{x : p(x) = 0\\} \\le d .', number: '1', section: '1', file: 'sections/prelim.tex', line: 6 } }
}
const src = buildChatSources(files, skeleton, null)

describe('read_node', () => {
  it('returns the proof span from the chunk output, numbered, with referenced equations', () => {
    const out = readNode(fixtureDigest, 'lem:roots', src)
    expect(out.id).toBe('lem-roots')
    expect(out.proof?.source).toBe('chunk')
    expect(out.proof?.text).toContain('Induct on $d$')
    expect(out.proof?.text).not.toContain('lem:bogus') // comments stripped
    expect(out.proof?.location).toMatch(/^sections\/prelim\.tex:\d+-\d+$/)
    expect(out.used_by.map(n => n.id)).toEqual(['thm-main'])
    expect(out.uses.map(n => n.id)).toEqual(['def-poly'])
  })

  it('finds the proof by scanning when there is no chunk output', () => {
    const out = readNode(fixtureDigest, 'thm-main', buildChatSources(files, null, null))
    expect(out.proof?.source).toBe('scan')
    expect(out.proof?.text).toContain('\\eqref{eq:deg}')
    expect(out.equations.map(e => e.label)).toEqual(['eq:deg'])
  })

  it('uses its claims\' spans when no proof environment follows the statement', () => {
    const digest = { ...fixtureDigest, nodes: [...fixtureDigest.nodes, node('claim-def-poly-1', 'claim', '', 'sections/prelim.tex', 2, [], { parent_id: 'def-poly' })] }
    const outline = { method: 'pipeline' as const, claims: [{ id: 'claim-def-poly-1', parentLabel: 'def:poly', nameHint: '', span: { file: 'sections/prelim.tex', startLine: 2, endLine: 2 }, restsOn: [], confidence: 1 }], flags: [], stats: { calls: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0, wallclock_ms: 0 } }
    const out = readNode(digest, 'def-poly', buildChatSources(files, skeleton, outline))
    expect(out.proof).toMatchObject({ location: 'sections/prelim.tex:2-2', source: 'outline' })
    expect(out.proof?.text).toContain('finite sum')
    expect(readNode(digest, 'claim-def-poly-1', buildChatSources(files, skeleton, outline)).parent?.id).toBe('def-poly')
  })

  it('falls back to the digest on the toy fixture (no sources), and rejects unknown ids with suggestions', () => {
    const out = readNode(toyDigest, '[[lem-hash]]', null)
    expect(out.statement).toBe(toyDigest.nodes.find(n => n.id === 'lem-hash')!.statement_paper)
    expect(out.proof).toBeNull()
    expect(out.proof_note).toMatch(/not stored/)
    expect(out.headline).toBeTruthy()
    expect(out.claims?.map(c => c.id)).toEqual(['claim-lem-hash-1'])
    expect(() => readNode(toyDigest, 'lem-hashing', null)).toThrow(/Close ids: .*lem-hash/)
  })
})

describe('search_paper', () => {
  it('matches across LaTeX punctuation, reports the containing node and ±2 lines, and skips comments and the preamble', () => {
    const out = searchPaper(fixtureDigest, src, 'induct on d')
    expect(out.total).toBe(1)
    expect(out.hits[0]).toMatchObject({ file: 'sections/prelim.tex', node: 'lem-roots', part: 'proof' })
    expect(out.hits[0]!.context.split('\n').length).toBeGreaterThanOrEqual(3)
    expect(searchPaper(fixtureDigest, src, 'lem:bogus').total).toBe(0)
    expect(searchPaper(fixtureDigest, src, 'newcommand').total).toBe(0)
    expect(normalizeForSearch('\\sqrt{\\log n}')).toBe(normalizeForSearch('√log n'))
  })

  it('falls back to all-words matching, caps hits, and searches the digest when there are no sources', () => {
    expect(searchPaper(fixtureDigest, src, 'nonzero roots').hits[0]?.node).toBe('thm-main')
    expect(searchPaper(fixtureDigest, src, 'd', 1).hits).toHaveLength(1)
    const toy = searchPaper(toyDigest, null, 'polynomial')
    expect(toy.scope).toBe('digest')
    expect(toy.total).toBeGreaterThan(0)
  })
})

describe('trace / ancestors on the toy DAG', () => {
  it('follows "feeds into" arrows from the supporting node to the result', () => {
    const out = traceDeps(toyDigest, 'def-sparse', 'thm-main')
    expect(out.found).toBe(true)
    expect(out.steps).toBe(2)
    expect(out.paths.length).toBeGreaterThan(1)
    expect(out.paths.length).toBeLessThanOrEqual(3)
    for (const p of out.paths) {
      expect(p.nodes[0]!.id).toBe('def-sparse')
      expect(p.nodes.at(-1)!.id).toBe('thm-main')
    }
  })

  it('counts claim → parent and inferred links, and reports a missing or reversed path', () => {
    expect(traceDeps(toyDigest, 'claim-lem-hash-1', 'thm-main').paths[0]!.links).toEqual(['claim of', 'cited'])
    expect(traceDeps(toyDigest, 'lem-schwartz-zippel', 'lem-univariate').paths[0]!.links).toEqual(['inferred'])
    const rev = traceDeps(toyDigest, 'thm-main', 'def-sparse')
    expect(rev.found).toBe(false)
    expect(rev.note).toMatch(/reverse/)
    expect(traceDeps(toyDigest, 'thm-lower', 'thm-main')).toMatchObject({ found: false, paths: [] })
  })

  it('collects closures by distance in both directions', () => {
    const down = depClosure(toyDigest, 'thm-main', 'supported_by')
    expect(down.levels[0]!.nodes.map(n => n.id).sort()).toEqual(['lem-hash', 'lem-restrict', 'lem-univariate'])
    expect(down.levels.flatMap(l => l.nodes.map(n => n.id))).toContain('def-sparse')
    const up = depClosure(toyDigest, 'def-sparse', 'supports', 1)
    expect(up.levels).toHaveLength(1)
    expect(up.levels[0]!.nodes.map(n => n.id)).toContain('thm-lower')
  })
})

describe('digest additions and tool rows', () => {
  it('serializes headline, role and a capped equations list', () => {
    const s = serializeDigest(fixtureDigest)
    expect(s).toContain('eq:deg (1): ')
    expect(serializeDigest(toyDigest)).toContain('headline: Defines $s$-sparse')
    expect(equationLines(fixtureDigest, 0)).toEqual(['… 1 more (search_paper finds them)'])
  })

  it('labels running, finished and failed calls', () => {
    expect(toolRow('read_node', { state: 'input-available', input: { id: 'lem-x' } })).toMatchObject({ text: 'Reading lem-x', state: 'running' })
    const search = toolRow('search_paper', { state: 'output-available', input: { query: 'sqrt log n' }, output: { query: 'sqrt log n', scope: 'sources', total: 6, hits: [] } })
    expect(`${search.text} · ${search.suffix}`).toBe('Searched “sqrt log n” · 6 hits')
    expect(toolRow('trace', { state: 'output-available', input: { from: 'a', to: 'b' }, output: { from: 'a', to: 'b', found: true, steps: 4, paths: [] } }).suffix).toBe('4 steps')
    expect(toolRow('read_node', { state: 'input-streaming', input: { id: 'lem' } }, false)).toMatchObject({ state: 'stopped', suffix: 'stopped' })
    expect(toolRow('read_node', { state: 'output-error', input: { id: 'nope' }, errorText: 'No node' })).toMatchObject({ state: 'error', suffix: 'No node' })
  })
})

describe('view_figure', () => {
  const fig = (id: string, number: string | undefined, label?: string) => ({
    id, number, ...(label ? { label } : {}), caption: `cap ${id}`, section: '2', file: 'main.tex', line: 20, page: 3, graphics: [], tikz: false,
    kind: 'plot' as const, description: `desc ${id}`, data_summary: 'x vs y, increasing', node_ids: ['thm-main', 'gone'], confidence: 0.8
  })
  const d: PaperDigest = { ...fixtureDigest, figures: [fig('fig-curve', '1', 'fig:curve'), fig('fig-2', '2'), fig('fig-a1', 'A.1', 'fig:app')] }

  it('resolves a label, \\ref{…}, an id, "Figure N", "Fig. N" and a bare number', () => {
    expect(resolveFigure(d, 'fig:curve').id).toBe('fig-curve')
    expect(resolveFigure(d, '\\ref{fig:curve}').id).toBe('fig-curve')
    expect(resolveFigure(d, 'fig-2').id).toBe('fig-2')
    expect(resolveFigure(d, 'Figure 2').id).toBe('fig-2')
    expect(resolveFigure(d, 'fig. 2').id).toBe('fig-2')
    expect(resolveFigure(d, ' 2 ').id).toBe('fig-2')
    expect(resolveFigure(d, 'Figure A.1').id).toBe('fig-a1')
    expect(resolveFigure(d, 'FIG:CURVE').id).toBe('fig-curve')
  })

  it('throws listing the figures when nothing matches', () => {
    expect(() => resolveFigure(d, 'Figure 7')).toThrow(/No figure "Figure 7".*Figure 1 \(fig:curve\), Figure 2 \(fig-2\)/)
    expect(() => resolveFigure(fixtureDigest, '1')).toThrow(/no figures/)
  })

  it('returns caption, description, data summary, section and the supported nodes that exist', () => {
    const out = viewFigure(d, '2', true)
    expect(out).toMatchObject({ id: 'fig-2', cite: 'fig-2', number: '2', page: 3, section: '§2 Main result', caption: 'cap fig-2', description: 'desc fig-2', data_summary: 'x vs y, increasing', image: true })
    expect(out.supports.map(n => n.id)).toEqual(['thm-main'])
    expect(viewFigure(d, 'fig:curve').cite).toBe('fig:curve')
  })

  it('renders as "Viewed Figure 2"', () => {
    expect(toolRow('view_figure', { state: 'output-available', input: { ref: 'fig-2' }, output: viewFigure(d, 'fig-2') })).toMatchObject({ text: 'Viewed Figure 2', suffix: 'p. 3', state: 'done' })
    expect(toolRow('view_figure', { state: 'input-available', input: { ref: '2' } }).text).toBe('Viewing Figure 2')
  })
})
